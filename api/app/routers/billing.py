"""Quotations, payment orders, treatment plans, insurance classes, billing settings (SPEC 9, 10)."""

import calendar
from datetime import date, datetime, timedelta
from decimal import ROUND_DOWN, Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.crud import master_router, not_found, updater_name
from app.deps import CurrentUser, DbSession, Principal, check_version, require
from app.models import (
    Department,
    Doctor,
    InsuranceClass,
    InsuranceCompany,
    Invoice,
    Patient,
    PaymentOrder,
    PlanInstallment,
    PlanOption,
    PlanSession,
    Quotation,
    Service,
    TreatmentPlan,
    User,
)
from app.schemas_master import _Out
from app.services import documents, numbering
from app.services.documents import (
    BILLING_KEY,
    BillingSettings,
    InsuranceChoice,
    LineIn,
    get_billing,
)
from app.services.scheduling import local
from app.services.settings import save_setting

Money = Annotated[Decimal, PlainSerializer(lambda v: f"{v:.2f}", return_type=str)]
MoneyIn = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]

router = APIRouter(tags=["billing"])
QView = Depends(require("quotation.view"))
QEdit = Depends(require("quotation.edit"))
PView = Depends(require("plan.view"))
PEdit = Depends(require("plan.edit"))


def _err(code: str, http: int = status.HTTP_422_UNPROCESSABLE_CONTENT, **extra) -> HTTPException:
    return HTTPException(http, detail={"code": code, **extra})


def _today(db: Session) -> date:
    return local(db.scalar(select(func.now()))).date()


def _patient(db: Session, pid: int) -> Patient:
    p = db.get(Patient, pid)
    if p is None or p.deleted_at is not None:
        raise _err("unknown_patient")
    return p


def _names(db: Session, ids: set[int | None]) -> dict[int, str]:
    ids = {i for i in ids if i}
    return (
        dict(db.execute(select(User.id, User.full_name_ar).where(User.id.in_(ids))).all())
        if ids
        else {}
    )


# ---------------------------------------------------------------- insurance classes and settings
class InsuranceClassIn(BaseModel):
    company_id: int
    name: str = Field(min_length=1, max_length=60)
    patient_share_pct: Decimal = Field(Decimal(0), ge=0, le=100, max_digits=5, decimal_places=2)
    max_patient_share_per_invoice: MoneyIn | None = None
    consultation_max_covered: MoneyIn | None = None
    daily_limit: MoneyIn | None = None
    excluded_service_ids: list[int] = []
    is_active: bool = True


class InsuranceClassPatch(BaseModel):
    version: int
    name: str | None = Field(None, min_length=1, max_length=60)
    patient_share_pct: Decimal | None = Field(None, ge=0, le=100, max_digits=5, decimal_places=2)
    max_patient_share_per_invoice: MoneyIn | None = None
    consultation_max_covered: MoneyIn | None = None
    daily_limit: MoneyIn | None = None
    excluded_service_ids: list[int] | None = None
    is_active: bool | None = None


class InsuranceClassOut(_Out):
    company_id: int
    name: str
    patient_share_pct: Money
    max_patient_share_per_invoice: Money | None
    consultation_max_covered: Money | None
    daily_limit: Money | None
    excluded_service_ids: list[int]


def _validate_class(db: Session, c: InsuranceClass) -> None:
    if db.get(InsuranceCompany, c.company_id) is None:
        raise _err("unknown_insurance_company")


router.include_router(
    master_router(
        InsuranceClass,
        "/insurance-classes",
        out=InsuranceClassOut,
        create=InsuranceClassIn,
        update=InsuranceClassPatch,
        tag="insurance-classes",
        validate=_validate_class,
        order_by=(InsuranceClass.company_id, InsuranceClass.sort_order, InsuranceClass.id),
    )
)


@router.get("/settings/billing", response_model=BillingSettings)
def read_billing(db: DbSession, _: CurrentUser) -> BillingSettings:
    return get_billing(db)


@router.put("/settings/billing", response_model=BillingSettings)
def write_billing(
    body: BillingSettings, db: DbSession, p: Principal = Depends(require("settings.manage"))
) -> BillingSettings:
    save_setting(db, BILLING_KEY, body, p.user.id)
    db.commit()
    return get_billing(db)


# ---------------------------------------------------------------- shared document shapes
class LineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    seq: int
    service_id: int | None
    description_ar: str
    description_en: str
    price: Money
    qty: Money
    discount_amount: Money
    discount_pct: Money
    gross: Money
    discount: Money
    net: Money
    vat_rate: Money
    vat_amount: Money
    line_total: Money
    patient_share: Money
    insurance_share: Money
    teeth: list[int]
    price_overridden: bool


class TotalsOut(BaseModel):
    gross: Money
    discount: Money
    net: Money
    vat: Money
    total: Money
    insurance_share: Money
    patient_share: Money


class PreviewIn(BaseModel):
    patient_id: int
    lines: list[LineIn] = Field(min_length=1, max_length=100)
    insurance: InsuranceChoice | None = None


class PreviewOut(TotalsOut):
    lines: list[LineOut]
    insurance: dict | None
    saudi: bool
    notes: list[str]


@router.post("/pricing/preview", response_model=PreviewOut)
def preview(body: PreviewIn, db: DbSession, p: Principal = QView) -> PreviewOut:
    """Live totals while editing; the same calculation runs again on save (nothing from here is trusted)."""
    patient = _patient(db, body.patient_id)
    rows, totals, snap, saudi = documents.build(
        db, patient, body.lines, body.insurance, p, _today(db)
    )
    return PreviewOut(
        lines=[LineOut(**r) for r in rows],
        insurance=snap,
        saudi=saudi,
        notes=totals.notes,
        **{k: getattr(totals, k) for k in TotalsOut.model_fields},
    )


class DocIn(BaseModel):
    patient_id: int
    doctor_id: int | None = None
    plan_id: int | None = None
    notes: str = Field("", max_length=4000)
    lines: list[LineIn] = Field(min_length=1, max_length=100)
    insurance: InsuranceChoice | None = None


class DocPatch(BaseModel):
    version: int
    doctor_id: int | None = None
    notes: str | None = Field(None, max_length=4000)
    lines: list[LineIn] | None = Field(None, min_length=1, max_length=100)
    insurance: InsuranceChoice | None = None


class DocOutBase(TotalsOut):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_id: int
    doctor_id: int | None
    clinic_id: int | None
    plan_id: int | None
    notes: str
    insurance: dict | None
    saudi: bool
    status: str
    created_at: datetime
    created_by: int | None
    updated_at: datetime
    version: int
    lines: list[LineOut] = []
    patient_name_ar: str = ""
    patient_name_en: str = ""
    patient_file_no: int = 0
    created_by_name: str | None = None


class QuotationOut(DocOutBase):
    quotation_no: str
    valid_until: date | None


class PaymentOrderOut(DocOutBase):
    order_no: str
    quotation_id: int | None
    installment_id: int | None
    reception_note: str
    sent_at: datetime | None
    sent_by: int | None
    sent_by_name: str | None = None
    invoice_id: int | None = None
    invoice_no: str | None = None
    paid_amount: Money = Decimal(0)
    remaining: Money = Decimal(0)
    closed_reason: str = ""
    corrects_invoice_id: int | None = None
    invoices: list[dict] = []  # each payment's invoice: id, invoice_no, patient_share, issued_at


def _doc_out(
    db: Session, doc, kind: Literal["quotation", "payment_order"], with_lines: bool = True
):
    cls = QuotationOut if kind == "quotation" else PaymentOrderOut
    o = cls.model_validate(doc)
    pt = db.get(Patient, doc.patient_id)
    names = _names(db, {doc.created_by, getattr(doc, "sent_by", None)})
    o.patient_name_ar, o.patient_name_en, o.patient_file_no = pt.name_ar, pt.name_en, pt.file_no
    o.created_by_name = names.get(doc.created_by)
    if kind == "payment_order":
        o.sent_by_name = names.get(doc.sent_by)
        invs = db.execute(
            select(Invoice.id, Invoice.invoice_no, Invoice.patient_share, Invoice.issued_at)
            .where(Invoice.payment_order_id == doc.id)
            .order_by(Invoice.id)
        ).all()
        o.invoices = [
            {"id": i, "invoice_no": n, "patient_share": f"{s:.2f}", "issued_at": at.isoformat()}
            for i, n, s, at in invs
        ]
        if invs:
            o.invoice_id, o.invoice_no = invs[-1][0], invs[-1][1]
        if doc.status in ("part_paid", "paid"):
            o.remaining = doc.patient_share - doc.paid_amount
    if with_lines:
        o.lines = [LineOut.model_validate(ln) for ln in documents.lines_of(db, kind, doc.id)]
    return o


def _check_doc_refs(
    db: Session, patient_id: int, doctor_id: int | None, plan_id: int | None
) -> Doctor | None:
    doctor = None
    if doctor_id is not None:
        doctor = db.get(Doctor, doctor_id)
        if doctor is None or doctor.deleted_at is not None:
            raise _err("unknown_doctor")
    if plan_id is not None:
        plan = db.get(TreatmentPlan, plan_id)
        if plan is None or plan.patient_id != patient_id or plan.deleted_at is not None:
            raise _err("unknown_plan")
    return doctor


# ---------------------------------------------------------------- quotations (SPEC 10.2, 10.3)
def _expire(db: Session, q: Quotation) -> None:
    if q.status in ("draft", "sent") and q.valid_until and q.valid_until < _today(db):
        q.status = "expired"


def _get_q(db: Session, qid: int) -> Quotation:
    q = db.get(Quotation, qid)
    if q is None or q.deleted_at is not None:
        raise not_found()
    return q


@router.get("/quotations", response_model=list[QuotationOut])
def list_quotations(
    db: DbSession,
    _: Principal = QView,
    patient_id: int | None = None,
    status_: str | None = Query(None, alias="status"),
    limit: int = Query(200, le=1000),
) -> list[QuotationOut]:
    q = select(Quotation).where(Quotation.deleted_at.is_(None))
    if patient_id:
        q = q.where(Quotation.patient_id == patient_id)
    if status_:
        q = q.where(Quotation.status == status_)
    rows = list(db.scalars(q.order_by(Quotation.id.desc()).limit(limit)))
    for r in rows:
        _expire(db, r)
    db.commit()
    return [_doc_out(db, r, "quotation", with_lines=False) for r in rows]


@router.get("/quotations/{qid}", response_model=QuotationOut)
def get_quotation(qid: int, db: DbSession, _: Principal = QView) -> QuotationOut:
    q = _get_q(db, qid)
    _expire(db, q)
    db.commit()
    return _doc_out(db, q, "quotation")


@router.post("/quotations", response_model=QuotationOut, status_code=201)
def create_quotation(body: DocIn, db: DbSession, p: Principal = QEdit) -> QuotationOut:
    patient = _patient(db, body.patient_id)
    doctor = _check_doc_refs(db, patient.id, body.doctor_id, body.plan_id)
    today = _today(db)
    rows, totals, snap, saudi = documents.build(db, patient, body.lines, body.insurance, p, today)
    q = Quotation(
        quotation_no=numbering.allocate(db, "quotation"),
        patient_id=patient.id,
        doctor_id=body.doctor_id,
        clinic_id=doctor.clinic_id if doctor else None,
        plan_id=body.plan_id,
        notes=body.notes.strip(),
        valid_until=today + timedelta(days=get_billing(db).quotation_valid_days),
        created_by=p.user.id,
        updated_by=p.user.id,
    )
    db.add(q)
    db.flush()
    documents.apply(db, q, "quotation", rows, totals, snap, saudi)
    db.commit()
    db.refresh(q)
    return _doc_out(db, q, "quotation")


@router.patch("/quotations/{qid}", response_model=QuotationOut)
def update_quotation(qid: int, body: DocPatch, db: DbSession, p: Principal = QEdit) -> QuotationOut:
    """Editable until accepted, converted or expired (SPEC 10.2)."""
    q = _get_q(db, qid)
    _expire(db, q)
    if q.status not in ("draft", "sent"):
        db.commit()
        raise _err("document_closed", status.HTTP_409_CONFLICT, status=q.status)
    check_version(q.version, body.version, updater_name(db, q), q.updated_at)
    _update_doc(db, q, "quotation", body, p)
    db.commit()
    db.refresh(q)
    return _doc_out(db, q, "quotation")


def _update_doc(db: Session, doc, kind: str, body: DocPatch, p: Principal) -> None:
    patient = _patient(db, doc.patient_id)
    if "doctor_id" in body.model_fields_set:
        doctor = _check_doc_refs(db, patient.id, body.doctor_id, None)
        doc.doctor_id = body.doctor_id
        doc.clinic_id = doctor.clinic_id if doctor else None
    if body.notes is not None:
        doc.notes = body.notes.strip()
    if body.lines is not None or "insurance" in body.model_fields_set:
        lines = body.lines
        if lines is None:
            lines = [
                LineIn(
                    service_id=ln.service_id,
                    description_ar=ln.description_ar,
                    description_en=ln.description_en,
                    price=ln.price,
                    qty=ln.qty,
                    discount_amount=ln.discount_amount,
                    discount_pct=ln.discount_pct,
                    teeth=ln.teeth,
                )
                for ln in documents.lines_of(db, kind, doc.id)
            ]
        rows, totals, snap, saudi = documents.build(
            db, patient, lines, body.insurance, p, _today(db)
        )
        documents.apply(db, doc, kind, rows, totals, snap, saudi)
    doc.updated_by = p.user.id
    doc.updated_at = func.now()


class QuoteAction(BaseModel):
    version: int


@router.post("/quotations/{qid}/convert", response_model=PaymentOrderOut, status_code=201)
def convert_to_payment_order(
    qid: int, body: QuoteAction, db: DbSession, p: Principal = QEdit
) -> PaymentOrderOut:
    """Copy the quotation into a new payment order; prices and shares are recalculated today (SPEC 10.3)."""
    q = _get_q(db, qid)
    _expire(db, q)
    check_version(q.version, body.version, updater_name(db, q), q.updated_at)
    if q.status not in ("draft", "sent", "accepted"):
        db.commit()
        raise _err("document_closed", status.HTTP_409_CONFLICT, status=q.status)
    lines = [
        LineIn(
            service_id=ln.service_id,
            description_ar=ln.description_ar,
            description_en=ln.description_en,
            price=ln.price,
            qty=ln.qty,
            discount_amount=ln.discount_amount,
            discount_pct=ln.discount_pct,
            teeth=ln.teeth,
        )
        for ln in documents.lines_of(db, "quotation", q.id)
    ]
    choice = InsuranceChoice(
        use_insurance=q.insurance is not None, class_id=(q.insurance or {}).get("class_id")
    )
    po = _new_po(
        db, q.patient_id, q.doctor_id, q.plan_id, q.notes, lines, choice, p, quotation_id=q.id
    )
    q.status = "converted"
    q.updated_by = p.user.id
    db.commit()
    db.refresh(po)
    return _doc_out(db, po, "payment_order")


# Declared after /convert so that path is not taken for an action.
@router.post("/quotations/{qid}/{action}", response_model=QuotationOut)
def quotation_action(
    qid: int,
    action: Literal["send", "accept", "cancel"],
    body: QuoteAction,
    db: DbSession,
    p: Principal = QEdit,
) -> QuotationOut:
    q = _get_q(db, qid)
    _expire(db, q)
    check_version(q.version, body.version, updater_name(db, q), q.updated_at)
    allowed = {
        "send": ("draft",),
        "accept": ("draft", "sent"),
        "cancel": ("draft", "sent", "accepted"),
    }
    if q.status not in allowed[action]:
        db.commit()
        raise _err("document_closed", status.HTTP_409_CONFLICT, status=q.status)
    q.status = {"send": "sent", "accept": "accepted", "cancel": "cancelled"}[action]
    q.updated_by = p.user.id
    db.commit()
    db.refresh(q)
    return _doc_out(db, q, "quotation")


# ---------------------------------------------------------------- payment orders (SPEC 10.2, 10.5)
def _get_po(db: Session, pid: int) -> PaymentOrder:
    po = db.get(PaymentOrder, pid)
    if po is None or po.deleted_at is not None:
        raise not_found()
    return po


def _new_po(
    db,
    patient_id,
    doctor_id,
    plan_id,
    notes,
    lines,
    choice,
    p,
    quotation_id=None,
    installment_id=None,
) -> PaymentOrder:
    patient = _patient(db, patient_id)
    doctor = _check_doc_refs(db, patient.id, doctor_id, plan_id)
    rows, totals, snap, saudi = documents.build(db, patient, lines, choice, p, _today(db))
    po = PaymentOrder(
        order_no=numbering.allocate(db, "payment_order"),
        patient_id=patient.id,
        doctor_id=doctor_id,
        clinic_id=doctor.clinic_id if doctor else None,
        plan_id=plan_id,
        quotation_id=quotation_id,
        installment_id=installment_id,
        notes=(notes or "").strip(),
        created_by=p.user.id,
        updated_by=p.user.id,
    )
    db.add(po)
    db.flush()
    documents.apply(db, po, "payment_order", rows, totals, snap, saudi)
    return po


@router.get("/payment-orders", response_model=list[PaymentOrderOut])
def list_payment_orders(
    db: DbSession,
    p: CurrentUser,
    patient_id: int | None = None,
    status_: str | None = Query(None, alias="status"),
    limit: int = Query(200, le=1000),
) -> list[PaymentOrderOut]:
    # Reception sees the inbox (payment.collect); doctors and billing staff see orders (quotation.view).
    if not (p.can("quotation.view") or p.can("payment.collect")):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "missing": ["quotation.view"]}
        )
    q = select(PaymentOrder).where(PaymentOrder.deleted_at.is_(None))
    if patient_id:
        q = q.where(PaymentOrder.patient_id == patient_id)
    if status_:
        q = q.where(PaymentOrder.status == status_)
    order = (PaymentOrder.sent_at.asc(),) if status_ == "sent" else (PaymentOrder.id.desc(),)
    return [
        _doc_out(db, r, "payment_order", with_lines=False)
        for r in db.scalars(q.order_by(*order).limit(limit))
    ]


@router.get("/payment-orders/waiting-count")
def waiting_count(db: DbSession, p: CurrentUser) -> dict:
    """Badge in the top bar: payment orders waiting at reception (SPEC 4.3, 10.5)."""
    if not (p.can("payment.collect") or p.can("quotation.view")):
        return {"count": 0}
    n = db.scalar(
        select(func.count())
        .select_from(PaymentOrder)
        .where(PaymentOrder.status == "sent", PaymentOrder.deleted_at.is_(None))
    )
    return {"count": n}


@router.get("/payment-orders/{pid}", response_model=PaymentOrderOut)
def get_payment_order(pid: int, db: DbSession, p: CurrentUser) -> PaymentOrderOut:
    if not (p.can("quotation.view") or p.can("payment.collect")):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "missing": ["quotation.view"]}
        )
    return _doc_out(db, _get_po(db, pid), "payment_order")


@router.post("/payment-orders", response_model=PaymentOrderOut, status_code=201)
def create_payment_order(body: DocIn, db: DbSession, p: Principal = QEdit) -> PaymentOrderOut:
    po = _new_po(
        db, body.patient_id, body.doctor_id, body.plan_id, body.notes, body.lines, body.insurance, p
    )
    db.commit()
    db.refresh(po)
    return _doc_out(db, po, "payment_order")


@router.patch("/payment-orders/{pid}", response_model=PaymentOrderOut)
def update_payment_order(
    pid: int, body: DocPatch, db: DbSession, p: Principal = QEdit
) -> PaymentOrderOut:
    """Editable until paid (SPEC 10.2)."""
    po = _get_po(db, pid)
    if po.status not in ("draft", "sent"):
        raise _err("document_closed", status.HTTP_409_CONFLICT, status=po.status)
    check_version(po.version, body.version, updater_name(db, po), po.updated_at)
    _update_doc(db, po, "payment_order", body, p)
    db.commit()
    db.refresh(po)
    return _doc_out(db, po, "payment_order")


class SendIn(BaseModel):
    version: int
    reception_note: str = Field("", max_length=1000)


@router.post("/payment-orders/{pid}/send", response_model=PaymentOrderOut)
def send_to_reception(
    pid: int, body: SendIn, db: DbSession, p: Principal = QEdit
) -> PaymentOrderOut:
    """Doctor sends the order to reception for payment (SPEC 10.3 primary action)."""
    po = _get_po(db, pid)
    check_version(po.version, body.version, updater_name(db, po), po.updated_at)
    if po.status != "draft":
        raise _err("document_closed", status.HTTP_409_CONFLICT, status=po.status)
    po.status = "sent"
    po.sent_at = db.scalar(select(func.now()))
    po.sent_by = p.user.id
    po.reception_note = body.reception_note.strip()
    po.updated_by = p.user.id
    db.commit()
    db.refresh(po)
    return _doc_out(db, po, "payment_order")


@router.post("/payment-orders/{pid}/cancel", response_model=PaymentOrderOut)
def cancel_payment_order(
    pid: int, body: QuoteAction, db: DbSession, p: Principal = QEdit
) -> PaymentOrderOut:
    po = _get_po(db, pid)
    check_version(po.version, body.version, updater_name(db, po), po.updated_at)
    if po.status not in ("draft", "sent"):
        raise _err("document_closed", status.HTTP_409_CONFLICT, status=po.status)
    po.status = "cancelled"
    po.updated_by = p.user.id
    db.commit()
    db.refresh(po)
    return _doc_out(db, po, "payment_order")


# ---------------------------------------------------------------- treatment plans (SPEC 9)
class OptionIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    price: MoneyIn
    description: str = Field("", max_length=2000)


class SessionIn(BaseModel):
    description: str = Field(min_length=1, max_length=1000)
    service_id: int | None = None
    teeth: list[int] = []
    price_share: MoneyIn = Decimal(0)
    status: Literal["planned", "booked", "done"] = "planned"


class InstallmentIn(BaseModel):
    due_date: date
    amount: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]


class PlanIn(BaseModel):
    patient_id: int
    doctor_id: int
    department_id: int | None = None
    title: str = Field(min_length=1, max_length=200)
    total_price: MoneyIn = Decimal(0)
    discount: MoneyIn = Decimal(0)
    notes: str = Field("", max_length=4000)
    options: list[OptionIn] = []
    sessions: list[SessionIn] = []
    installments: list[InstallmentIn] = []


class PlanPatch(BaseModel):
    version: int
    doctor_id: int | None = None
    department_id: int | None = None
    title: str | None = Field(None, min_length=1, max_length=200)
    total_price: MoneyIn | None = None
    discount: MoneyIn | None = None
    notes: str | None = Field(None, max_length=4000)
    options: list[OptionIn] | None = None
    sessions: list[SessionIn] | None = None
    installments: list[InstallmentIn] | None = None


class OptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    price: Money
    description: str


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    seq: int
    description: str
    service_id: int | None
    teeth: list[int]
    price_share: Money
    status: str


class InstallmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    due_date: date
    amount: Money
    paid_amount: Money
    overdue: bool = False


class PlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_id: int
    doctor_id: int
    department_id: int | None
    title: str
    status: str
    total_price: Money
    discount: Money
    net_price: Money = Decimal(0)
    paid: Money = Decimal(0)
    remaining: Money = Decimal(0)
    installments_total: Money = Decimal(0)
    accepted_option_id: int | None
    accepted_at: datetime | None
    notes: str
    options: list[OptionOut]
    sessions: list[SessionOut]
    installments: list[InstallmentOut]
    created_at: datetime
    updated_at: datetime
    version: int
    patient_name_ar: str = ""
    patient_file_no: int = 0


OPEN = ("draft", "proposed", "accepted", "in_progress")


def _plan_out(db: Session, plan: TreatmentPlan) -> PlanOut:
    o = PlanOut.model_validate(plan)
    today = _today(db)
    for i in o.installments:
        i.overdue = i.due_date < today and i.paid_amount < i.amount
    o.net_price = plan.total_price - plan.discount
    o.paid = sum((i.paid_amount for i in plan.installments), Decimal(0))
    o.remaining = o.net_price - o.paid
    o.installments_total = sum((i.amount for i in plan.installments), Decimal(0))
    pt = db.get(Patient, plan.patient_id)
    o.patient_name_ar, o.patient_file_no = pt.name_ar, pt.file_no
    return o


def _get_plan(db: Session, pid: int) -> TreatmentPlan:
    plan = db.get(TreatmentPlan, pid)
    if plan is None or plan.deleted_at is not None:
        raise not_found()
    return plan


def _check_plan_refs(
    db: Session, doctor_id: int | None, department_id: int | None, sessions: list[SessionIn] | None
) -> None:
    if doctor_id is not None and db.get(Doctor, doctor_id) is None:
        raise _err("unknown_doctor")
    if department_id is not None and db.get(Department, department_id) is None:
        raise _err("unknown_department")
    for s in sessions or []:
        if s.service_id is not None and db.get(Service, s.service_id) is None:
            raise _err("unknown_service")


def _replace_children(plan: TreatmentPlan, options, sessions, installments) -> None:
    if options is not None:
        plan.options = [PlanOption(**o.model_dump()) for o in options]
    if sessions is not None:
        plan.sessions = [PlanSession(seq=i + 1, **s.model_dump()) for i, s in enumerate(sessions)]
    if installments is not None:
        plan.installments = [PlanInstallment(**i.model_dump()) for i in installments]


@router.get("/treatment-plans", response_model=list[PlanOut])
def list_plans(
    db: DbSession, _: Principal = PView, patient_id: int | None = None, open_only: bool = False
) -> list[PlanOut]:
    q = select(TreatmentPlan).where(TreatmentPlan.deleted_at.is_(None))
    if patient_id:
        q = q.where(TreatmentPlan.patient_id == patient_id)
    if open_only:
        q = q.where(TreatmentPlan.status.in_(OPEN))
    return [_plan_out(db, p) for p in db.scalars(q.order_by(TreatmentPlan.id.desc()))]


class OverdueOut(BaseModel):
    plan_id: int
    plan_title: str
    patient_id: int
    patient_name_ar: str
    patient_file_no: int
    installment_id: int
    due_date: date
    amount: Money
    paid_amount: Money
    days_overdue: int


@router.get("/treatment-plans/overdue-installments", response_model=list[OverdueOut])
def overdue_installments(db: DbSession, p: CurrentUser) -> list[OverdueOut]:
    """For the reception dashboard and the outstanding balances report (SPEC 9, 11.2)."""
    if not (p.can("plan.view") or p.can("payment.collect")):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "missing": ["plan.view"]}
        )
    today = _today(db)
    rows = db.execute(
        select(PlanInstallment, TreatmentPlan, Patient)
        .join(TreatmentPlan, TreatmentPlan.id == PlanInstallment.plan_id)
        .join(Patient, Patient.id == TreatmentPlan.patient_id)
        .where(
            PlanInstallment.due_date < today,
            PlanInstallment.paid_amount < PlanInstallment.amount,
            TreatmentPlan.status.in_(("accepted", "in_progress")),
            TreatmentPlan.deleted_at.is_(None),
        )
        .order_by(PlanInstallment.due_date)
    ).all()
    return [
        OverdueOut(
            plan_id=pl.id,
            plan_title=pl.title,
            patient_id=pt.id,
            patient_name_ar=pt.name_ar,
            patient_file_no=pt.file_no,
            installment_id=i.id,
            due_date=i.due_date,
            amount=i.amount,
            paid_amount=i.paid_amount,
            days_overdue=(today - i.due_date).days,
        )
        for i, pl, pt in rows
    ]


@router.get("/treatment-plans/{pid}", response_model=PlanOut)
def get_plan(pid: int, db: DbSession, _: Principal = PView) -> PlanOut:
    return _plan_out(db, _get_plan(db, pid))


@router.post("/treatment-plans", response_model=PlanOut, status_code=201)
def create_plan(body: PlanIn, db: DbSession, p: Principal = PEdit) -> PlanOut:
    _patient(db, body.patient_id)
    _check_plan_refs(db, body.doctor_id, body.department_id, body.sessions)
    if body.discount > body.total_price:
        raise _err("discount_exceeds_price")
    plan = TreatmentPlan(
        **body.model_dump(exclude={"options", "sessions", "installments"}),
        created_by=p.user.id,
        updated_by=p.user.id,
    )
    _replace_children(plan, body.options, body.sessions, body.installments)
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return _plan_out(db, plan)


@router.patch("/treatment-plans/{pid}", response_model=PlanOut)
def update_plan(pid: int, body: PlanPatch, db: DbSession, p: Principal = PEdit) -> PlanOut:
    plan = _get_plan(db, pid)
    check_version(plan.version, body.version, updater_name(db, plan), plan.updated_at)
    if plan.status in ("completed", "cancelled"):
        raise _err("plan_closed", status.HTTP_409_CONFLICT)
    _check_plan_refs(db, body.doctor_id, body.department_id, body.sessions)
    accepted = plan.status in ("accepted", "in_progress")
    if accepted and (
        body.options is not None or body.total_price is not None or body.discount is not None
    ):
        # The price was agreed with the patient; it changes only by re-proposing the plan.
        raise _err("plan_price_locked", status.HTTP_409_CONFLICT)
    if body.installments is not None and any(i.paid_amount > 0 for i in plan.installments):
        raise _err("installments_have_payments", status.HTTP_409_CONFLICT)
    for k, v in body.model_dump(
        exclude_unset=True, exclude={"version", "options", "sessions", "installments"}
    ).items():
        setattr(plan, k, v.strip() if isinstance(v, str) else v)
    if plan.discount > plan.total_price:
        raise _err("discount_exceeds_price")
    _replace_children(plan, body.options, body.sessions, body.installments)
    plan.updated_by = p.user.id
    plan.updated_at = func.now()
    db.commit()
    db.refresh(plan)
    return _plan_out(db, plan)


class PlanStatusIn(BaseModel):
    version: int
    status: Literal["draft", "proposed", "in_progress", "completed", "cancelled"]


TRANSITIONS = {
    "draft": {"proposed", "cancelled"},
    "proposed": {"draft", "cancelled"},
    "accepted": {"in_progress", "cancelled", "proposed"},
    "in_progress": {"completed", "cancelled"},
}


@router.post("/treatment-plans/{pid}/status", response_model=PlanOut)
def set_plan_status(pid: int, body: PlanStatusIn, db: DbSession, p: Principal = PEdit) -> PlanOut:
    plan = _get_plan(db, pid)
    check_version(plan.version, body.version, updater_name(db, plan), plan.updated_at)
    if body.status not in TRANSITIONS.get(plan.status, set()):
        raise _err("invalid_transition", status.HTTP_409_CONFLICT, current=plan.status)
    if body.status == "proposed" and plan.status == "accepted":
        plan.accepted_option_id = None
        plan.accepted_at = None
    plan.status = body.status
    plan.updated_by = p.user.id
    db.commit()
    db.refresh(plan)
    return _plan_out(db, plan)


class AcceptIn(BaseModel):
    version: int
    option_id: int | None = None


@router.post("/treatment-plans/{pid}/accept", response_model=PlanOut)
def accept_plan(pid: int, body: AcceptIn, db: DbSession, p: Principal = PEdit) -> PlanOut:
    """Patient accepts the plan (or one of its options, which sets the price) (SPEC 9)."""
    plan = _get_plan(db, pid)
    check_version(plan.version, body.version, updater_name(db, plan), plan.updated_at)
    if plan.status not in ("draft", "proposed"):
        raise _err("invalid_transition", status.HTTP_409_CONFLICT, current=plan.status)
    if plan.options:
        opt = next((o for o in plan.options if o.id == body.option_id), None)
        if opt is None:
            raise _err("option_required")
        plan.accepted_option_id = opt.id
        plan.total_price = opt.price
        if plan.discount > plan.total_price:
            plan.discount = Decimal(0)
    plan.status = "accepted"
    plan.accepted_at = func.now()
    plan.updated_by = p.user.id
    db.commit()
    db.refresh(plan)
    return _plan_out(db, plan)


class GenerateIn(BaseModel):
    version: int
    count: int = Field(ge=1, le=60)
    first_due: date
    every_months: int = Field(1, ge=1, le=12)
    down_payment: MoneyIn = Decimal(0)

    @field_validator("first_due")
    @classmethod
    def _sane(cls, v):
        if v.year < 2000:
            raise ValueError("date out of range")
        return v


def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


@router.post("/treatment-plans/{pid}/installments/generate", response_model=PlanOut)
def generate_installments(
    pid: int, body: GenerateIn, db: DbSession, p: Principal = PEdit
) -> PlanOut:
    """Payment schedule: optional down payment today, then equal installments; the halala remainder
    goes on the last one so the schedule adds up exactly to the plan's net price."""
    plan = _get_plan(db, pid)
    check_version(plan.version, body.version, updater_name(db, plan), plan.updated_at)
    if any(i.paid_amount > 0 for i in plan.installments):
        raise _err("installments_have_payments", status.HTTP_409_CONFLICT)
    net = plan.total_price - plan.discount
    if net <= 0:
        raise _err("plan_has_no_price")
    if body.down_payment >= net:
        raise _err("down_payment_too_large")
    rest = net - body.down_payment
    each = (rest / body.count).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    items = []
    if body.down_payment > 0:
        items.append(InstallmentIn(due_date=_today(db), amount=body.down_payment))
    for k in range(body.count):
        amt = each if k < body.count - 1 else rest - each * (body.count - 1)
        items.append(
            InstallmentIn(due_date=_add_months(body.first_due, k * body.every_months), amount=amt)
        )
    _replace_children(plan, None, None, items)
    plan.updated_by = p.user.id
    plan.updated_at = func.now()
    db.commit()
    db.refresh(plan)
    return _plan_out(db, plan)


class InstallmentOrderIn(BaseModel):
    reception_note: str = Field("", max_length=1000)


@router.post(
    "/treatment-plans/{pid}/installments/{iid}/payment-order",
    response_model=PaymentOrderOut,
    status_code=201,
)
def installment_payment_order(
    pid: int, iid: int, body: InstallmentOrderIn, db: DbSession, p: Principal = QEdit
) -> PaymentOrderOut:
    """Send an installment to reception as a payment order (paid in M8; paying it updates the plan)."""
    plan = _get_plan(db, pid)
    inst = next((i for i in plan.installments if i.id == iid), None)
    if inst is None:
        raise not_found()
    if plan.status not in ("accepted", "in_progress"):
        raise _err("plan_not_accepted", status.HTTP_409_CONFLICT)
    due = inst.amount - inst.paid_amount
    if due <= 0:
        raise _err("installment_paid", status.HTTP_409_CONFLICT)
    open_po = db.scalar(
        select(PaymentOrder.id).where(
            PaymentOrder.installment_id == inst.id, PaymentOrder.status.in_(("draft", "sent"))
        )
    )
    if open_po:
        raise _err("installment_order_exists", status.HTTP_409_CONFLICT, payment_order_id=open_po)
    line = LineIn(
        description_ar=f"دفعة خطة علاج: {plan.title}",
        description_en=f"Treatment plan installment: {plan.title}",
        price=due,
    )
    # A plan installment is agreed money, not a catalog price: allowed without the override permission.
    po = _new_po(
        db,
        plan.patient_id,
        plan.doctor_id,
        plan.id,
        "",
        [line],
        InsuranceChoice(use_insurance=False),
        _AllowFreeLine(p),
        installment_id=inst.id,
    )
    po.status = "sent"
    po.sent_at = db.scalar(select(func.now()))
    po.sent_by = p.user.id
    po.reception_note = body.reception_note.strip()
    db.commit()
    db.refresh(po)
    return _doc_out(db, po, "payment_order")


class _AllowFreeLine:
    """Wraps a principal so a plan installment line passes the free-line check, nothing else."""

    def __init__(self, p: Principal):
        self._p = p
        self.user = p.user

    def can(self, perm: str) -> bool:
        return True if perm == "invoice.price_override" else self._p.can(perm)
