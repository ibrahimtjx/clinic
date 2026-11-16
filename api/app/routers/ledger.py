"""Final invoices, receipts, credit notes, deposits, patient accounts and the cash box (SPEC 10.5–10.9).

There are no update or delete endpoints for issued documents; the database rejects them too.
"""

from datetime import datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, PlainSerializer
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.crud import not_found, updater_name
from app.deps import DbSession, Principal, check_version, require
from app.models import (
    CashClosing,
    CreditNote,
    CreditNoteLine,
    Doctor,
    Invoice,
    InvoiceLine,
    Patient,
    PaymentOrder,
    Receipt,
    ReceiptAllocation,
    ReceiptPayment,
    TreatmentPlan,
    User,
)
from app.services import documents, ledger
from app.services.ledger import CreditLineIn, PaymentIn, RefundIn, err
from app.services.scheduling import local

Money = Annotated[Decimal, PlainSerializer(lambda v: f"{v:.2f}", return_type=str)]

router = APIRouter(tags=["ledger"])
IView = Depends(require("invoice.view"))
Collect = Depends(require("payment.collect"))
Credit = Depends(require("invoice.credit_note"))


def _names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.full_name_ar).where(User.id.in_(ids))).all())


def _patient(db: Session, pid: int) -> Patient:
    pt = db.get(Patient, pid)
    if pt is None or pt.deleted_at is not None:
        raise not_found()
    return pt


# ---------------------------------------------------------------- shapes
class InvoiceLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
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
    credited_qty: Money = Decimal(0)


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_no: str
    uuid: UUID
    payment_order_id: int
    patient_id: int
    doctor_id: int | None
    clinic_id: int | None
    plan_id: int | None
    installment_id: int | None
    issued_at: datetime
    issued_by: int
    notes: str
    insurance: dict | None
    buyer_name_ar: str
    buyer_name_en: str
    buyer_national_id: str
    buyer_nationality: str
    buyer_file_no: int
    saudi: bool
    seller_name_ar: str
    seller_name_en: str
    seller_vat_no: str
    seller_cr_no: str
    seller_address_ar: str
    gross: Money
    discount: Money
    net: Money
    vat: Money
    total: Money
    insurance_share: Money
    patient_share: Money
    previous_hash: str
    hash: str
    qr_payload: str
    outstanding: Money = Decimal(0)
    credited: Money = Decimal(0)
    issued_by_name: str | None = None
    doctor_name_ar: str | None = None
    order_no: str | None = None
    lines: list[InvoiceLineOut] = []
    credit_notes: list["CreditNoteBrief"] = []
    receipts: list["ReceiptBrief"] = []


class CreditNoteBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    credit_note_no: str
    issued_at: datetime
    reason: str
    total: Money
    patient_share: Money
    refunded: Money


class ReceiptBrief(BaseModel):
    id: int
    receipt_no: str
    kind: str
    received_at: datetime
    amount: Money  # the part of this receipt for the invoice in question (or the receipt total)


class CreditNoteLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    invoice_line_id: int
    qty: Money
    net: Money
    vat: Money
    total: Money
    patient_share: Money
    insurance_share: Money
    description_ar: str = ""
    description_en: str = ""
    price: Money = Decimal(0)
    vat_rate: Money = Decimal(0)


class CreditNoteOut(CreditNoteBrief):
    uuid: UUID
    invoice_id: int
    invoice_no: str = ""
    invoice_issued_at: datetime | None = None
    patient_id: int
    issued_by: int
    issued_by_name: str | None = None
    net: Money
    vat: Money
    insurance_share: Money
    balance_reduced: Money
    previous_hash: str
    hash: str
    qr_payload: str
    buyer_name_ar: str = ""
    buyer_name_en: str = ""
    buyer_file_no: int = 0
    seller_name_ar: str = ""
    seller_name_en: str = ""
    seller_vat_no: str = ""
    lines: list[CreditNoteLineOut] = []
    refund_receipt_id: int | None = None


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    method: str
    amount: Money
    reference: str


class AllocationOut(BaseModel):
    invoice_id: int
    invoice_no: str
    amount: Money


class ReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    receipt_no: str
    kind: str
    patient_id: int
    invoice_id: int | None
    credit_note_id: int | None
    plan_id: int | None
    received_by: int
    received_at: datetime
    total: Money
    vat: Money
    note: str
    received_by_name: str | None = None
    patient_name_ar: str = ""
    patient_name_en: str = ""
    patient_file_no: int = 0
    credit_note_no: str | None = None
    payments: list[PaymentOut] = []
    allocations: list[AllocationOut] = []
    balance_after: Money | None = None
    deposit_after: Money | None = None


InvoiceOut.model_rebuild()


def _invoice_out(db: Session, inv: Invoice, full: bool = True) -> InvoiceOut:
    o = InvoiceOut.model_validate(inv)
    o.outstanding = ledger.outstanding(db, [inv.id])[inv.id]
    o.issued_by_name = _names(db, {inv.issued_by}).get(inv.issued_by)
    o.order_no = db.scalar(
        select(PaymentOrder.order_no).where(PaymentOrder.id == inv.payment_order_id)
    )
    if inv.doctor_id:
        o.doctor_name_ar = db.scalar(select(Doctor.name_ar).where(Doctor.id == inv.doctor_id))
    cns = list(
        db.scalars(
            select(CreditNote).where(CreditNote.invoice_id == inv.id).order_by(CreditNote.id)
        )
    )
    o.credited = sum((c.total for c in cns), Decimal(0))
    if not full:
        return o
    done = ledger.credited_by_line(db, inv.id)
    o.lines = []
    for ln in db.scalars(
        select(InvoiceLine).where(InvoiceLine.invoice_id == inv.id).order_by(InvoiceLine.seq)
    ):
        lo = InvoiceLineOut.model_validate(ln)
        lo.credited_qty = done.get(ln.id, {}).get("qty", Decimal(0))
        o.lines.append(lo)
    o.credit_notes = [CreditNoteBrief.model_validate(c) for c in cns]
    rows = db.execute(
        select(
            Receipt.id,
            Receipt.receipt_no,
            Receipt.kind,
            Receipt.received_at,
            ReceiptAllocation.amount,
        )
        .join(ReceiptAllocation, ReceiptAllocation.receipt_id == Receipt.id)
        .where(ReceiptAllocation.invoice_id == inv.id)
    ).all()
    refunds = db.execute(
        select(
            Receipt.id, Receipt.receipt_no, Receipt.kind, Receipt.received_at, Receipt.total
        ).where(Receipt.invoice_id == inv.id, Receipt.kind == "refund")
    ).all()
    o.receipts = sorted(
        [
            ReceiptBrief(id=r[0], receipt_no=r[1], kind=r[2], received_at=r[3], amount=r[4])
            for r in [*rows, *refunds]
        ],
        key=lambda r: r.received_at,
    )
    return o


def _receipt_out(db: Session, r: Receipt) -> ReceiptOut:
    o = ReceiptOut.model_validate(r)
    o.received_by_name = _names(db, {r.received_by}).get(r.received_by)
    pt = db.get(Patient, r.patient_id)
    o.patient_name_ar, o.patient_name_en, o.patient_file_no = (
        pt.name_ar,
        pt.name_en or "",
        pt.file_no,
    )
    o.payments = [
        PaymentOut.model_validate(x)
        for x in db.scalars(
            select(ReceiptPayment)
            .where(ReceiptPayment.receipt_id == r.id)
            .order_by(ReceiptPayment.id)
        )
    ]
    o.allocations = [
        AllocationOut(invoice_id=i, invoice_no=n, amount=a)
        for i, n, a in db.execute(
            select(ReceiptAllocation.invoice_id, Invoice.invoice_no, ReceiptAllocation.amount)
            .join(Invoice, Invoice.id == ReceiptAllocation.invoice_id)
            .where(ReceiptAllocation.receipt_id == r.id)
            .order_by(ReceiptAllocation.id)
        ).all()
    ]
    if r.credit_note_id:
        o.credit_note_no = db.scalar(
            select(CreditNote.credit_note_no).where(CreditNote.id == r.credit_note_id)
        )
    return o


def _credit_out(db: Session, cn: CreditNote) -> CreditNoteOut:
    o = CreditNoteOut.model_validate(cn)
    inv = db.get(Invoice, cn.invoice_id)
    o.invoice_no, o.invoice_issued_at = inv.invoice_no, inv.issued_at
    o.buyer_name_ar, o.buyer_name_en, o.buyer_file_no = (
        inv.buyer_name_ar,
        inv.buyer_name_en,
        inv.buyer_file_no,
    )
    o.seller_name_ar, o.seller_name_en, o.seller_vat_no = (
        inv.seller_name_ar,
        inv.seller_name_en,
        inv.seller_vat_no,
    )
    o.issued_by_name = _names(db, {cn.issued_by}).get(cn.issued_by)
    o.lines = []
    for c, ln in db.execute(
        select(CreditNoteLine, InvoiceLine)
        .join(InvoiceLine, InvoiceLine.id == CreditNoteLine.invoice_line_id)
        .where(CreditNoteLine.credit_note_id == cn.id)
        .order_by(InvoiceLine.seq)
    ).all():
        lo = CreditNoteLineOut.model_validate(c)
        lo.description_ar, lo.description_en = ln.description_ar, ln.description_en
        lo.price, lo.vat_rate = ln.price, ln.vat_rate
        o.lines.append(lo)
    o.refund_receipt_id = db.scalar(select(Receipt.id).where(Receipt.credit_note_id == cn.id))
    return o


def _with_balances(db: Session, o: ReceiptOut, patient_id: int) -> ReceiptOut:
    bal, dep = db.execute(
        select(Patient.balance, Patient.deposit_balance).where(Patient.id == patient_id)
    ).one()
    o.balance_after, o.deposit_after = bal, dep
    return o


# ---------------------------------------------------------------- collect a payment order
class CollectIn(BaseModel):
    version: int
    expected_patient_share: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    payments: list[PaymentIn] = Field([], max_length=10)
    note: str = Field("", max_length=1000)


class CollectOut(BaseModel):
    invoice: InvoiceOut
    receipt: ReceiptOut | None


@router.post("/payment-orders/{pid}/collect", response_model=CollectOut, status_code=201)
def collect_payment(pid: int, body: CollectIn, db: DbSession, p: Principal = Collect) -> CollectOut:
    """Paying a payment order issues the final invoice and the receipt together (SPEC 10.5)."""
    po = db.get(PaymentOrder, pid, with_for_update=True)
    if po is None or po.deleted_at is not None:
        raise not_found()
    check_version(po.version, body.version, updater_name(db, po), po.updated_at)
    if po.status != "sent":
        raise err("document_closed", status.HTTP_409_CONFLICT, status=po.status)
    patient = db.get(Patient, po.patient_id)
    today = local(db.scalar(select(func.now()))).date()
    if documents.recalculate(db, po, "payment_order", patient, today) or (
        body.expected_patient_share != po.patient_share
    ):
        # Amounts changed since it was written (daily insurance limit used, VAT rate, nationality):
        # save the new amounts and let reception confirm them before taking money.
        po.updated_by = p.user.id
        db.commit()
        raise err(
            "totals_changed",
            status.HTTP_409_CONFLICT,
            patient_share=f"{po.patient_share:.2f}",
            total=f"{po.total:.2f}",
        )
    res = ledger.collect(db, po, body.payments, body.note, p)
    db.commit()
    receipt = (
        _with_balances(db, _receipt_out(db, res.receipt), po.patient_id) if res.receipt else None
    )
    return CollectOut(invoice=_invoice_out(db, res.invoice), receipt=receipt)


# ---------------------------------------------------------------- invoices
@router.get("/invoices", response_model=list[InvoiceOut])
def list_invoices(
    db: DbSession,
    _: Principal = IView,
    patient_id: int | None = None,
    q: str | None = Query(None, max_length=40),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    unpaid: bool = False,
    limit: int = Query(200, le=1000),
) -> list[InvoiceOut]:
    stmt = select(Invoice)
    if patient_id:
        stmt = stmt.where(Invoice.patient_id == patient_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Invoice.invoice_no.ilike(like),
                Invoice.buyer_name_ar.ilike(like),
                Invoice.buyer_name_en.ilike(like),
            )
        )
    if date_from:
        stmt = stmt.where(Invoice.issued_at >= date_from)
    if date_to:
        stmt = stmt.where(Invoice.issued_at < date_to)
    rows = list(db.scalars(stmt.order_by(Invoice.issued_at.desc(), Invoice.id.desc()).limit(limit)))
    out = [_invoice_out(db, i, full=False) for i in rows]
    return [o for o in out if o.outstanding > 0] if unpaid else out


@router.get("/invoices/{iid}", response_model=InvoiceOut)
def get_invoice(iid: int, db: DbSession, _: Principal = IView) -> InvoiceOut:
    inv = db.get(Invoice, iid)
    if inv is None:
        raise not_found()
    return _invoice_out(db, inv)


class CreditIn(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)
    lines: list[CreditLineIn] | None = Field(None, max_length=100)  # None = the whole invoice
    refund: RefundIn | None = None


@router.post("/invoices/{iid}/credit-notes", response_model=CreditNoteOut, status_code=201)
def create_credit_note(
    iid: int, body: CreditIn, db: DbSession, p: Principal = Credit
) -> CreditNoteOut:
    inv = db.get(Invoice, iid)
    if inv is None:
        raise not_found()
    if body.lines is not None and not body.lines:
        raise err("nothing_to_credit")
    cn = ledger.issue_credit_note(db, inv, body.reason, body.lines, body.refund, p)
    db.commit()
    return _credit_out(db, cn)


@router.get("/credit-notes", response_model=list[CreditNoteBrief])
def list_credit_notes(
    db: DbSession,
    _: Principal = IView,
    patient_id: int | None = None,
    limit: int = Query(200, le=1000),
) -> list[CreditNoteBrief]:
    stmt = select(CreditNote)
    if patient_id:
        stmt = stmt.where(CreditNote.patient_id == patient_id)
    return [
        CreditNoteBrief.model_validate(c)
        for c in db.scalars(stmt.order_by(CreditNote.id.desc()).limit(limit))
    ]


@router.get("/credit-notes/{cid}", response_model=CreditNoteOut)
def get_credit_note(cid: int, db: DbSession, _: Principal = IView) -> CreditNoteOut:
    cn = db.get(CreditNote, cid)
    if cn is None:
        raise not_found()
    return _credit_out(db, cn)


# ---------------------------------------------------------------- receipts
def _can_see_money(p: Principal) -> None:
    if not (p.can("invoice.view") or p.can("payment.collect")):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "missing": ["invoice.view"]}
        )


@router.get("/receipts", response_model=list[ReceiptOut])
def list_receipts(
    db: DbSession,
    p: Principal = Depends(require()),
    patient_id: int | None = None,
    kind: str | None = None,
    limit: int = Query(200, le=1000),
) -> list[ReceiptOut]:
    _can_see_money(p)
    stmt = select(Receipt)
    if patient_id:
        stmt = stmt.where(Receipt.patient_id == patient_id)
    if kind:
        stmt = stmt.where(Receipt.kind == kind)
    return [_receipt_out(db, r) for r in db.scalars(stmt.order_by(Receipt.id.desc()).limit(limit))]


@router.get("/receipts/{rid}", response_model=ReceiptOut)
def get_receipt(rid: int, db: DbSession, p: Principal = Depends(require())) -> ReceiptOut:
    _can_see_money(p)
    r = db.get(Receipt, rid)
    if r is None:
        raise not_found()
    return _receipt_out(db, r)


# ---------------------------------------------------------------- patient account
class AccountOut(BaseModel):
    patient_id: int
    balance: Money
    deposit_balance: Money
    unpaid: list[InvoiceOut]
    receipts: list[ReceiptOut]


@router.get("/patients/{pid}/account", response_model=AccountOut)
def patient_account(pid: int, db: DbSession, p: Principal = Depends(require())) -> AccountOut:
    _can_see_money(p)
    pt = _patient(db, pid)
    db.refresh(pt)
    ids = list(db.scalars(select(Invoice.id).where(Invoice.patient_id == pid)))
    owed = {i for i, o in ledger.outstanding(db, ids).items() if o > 0}
    unpaid = [
        _invoice_out(db, i, full=False)
        for i in db.scalars(select(Invoice).where(Invoice.id.in_(owed)).order_by(Invoice.issued_at))
    ]
    receipts = [
        _receipt_out(db, r)
        for r in db.scalars(
            select(Receipt).where(Receipt.patient_id == pid).order_by(Receipt.id.desc()).limit(30)
        )
    ]
    return AccountOut(
        patient_id=pid,
        balance=pt.balance,
        deposit_balance=pt.deposit_balance,
        unpaid=unpaid,
        receipts=receipts,
    )


class PayBalanceIn(BaseModel):
    payments: list[PaymentIn] = Field(min_length=1, max_length=10)
    invoice_ids: list[int] | None = None
    note: str = Field("", max_length=1000)


@router.post("/patients/{pid}/payments", response_model=ReceiptOut, status_code=201)
def pay_balance(pid: int, body: PayBalanceIn, db: DbSession, p: Principal = Collect) -> ReceiptOut:
    pt = _patient(db, pid)
    r = ledger.pay_balance(db, pt, body.payments, body.invoice_ids, body.note, p)
    db.commit()
    return _with_balances(db, _receipt_out(db, r), pid)


class DepositIn(BaseModel):
    payments: list[PaymentIn] = Field(min_length=1, max_length=10)
    plan_id: int | None = None
    note: str = Field("", max_length=1000)


@router.post("/patients/{pid}/deposits", response_model=ReceiptOut, status_code=201)
def take_deposit(pid: int, body: DepositIn, db: DbSession, p: Principal = Collect) -> ReceiptOut:
    pt = _patient(db, pid)
    if body.plan_id is not None:
        plan = db.get(TreatmentPlan, body.plan_id)
        if plan is None or plan.patient_id != pid or plan.deleted_at is not None:
            raise err("unknown_plan")
    r = ledger.take_deposit(db, pt, body.payments, body.plan_id, body.note, p)
    db.commit()
    return _with_balances(db, _receipt_out(db, r), pid)


class DepositRefundIn(BaseModel):
    payments: list[PaymentIn] = Field(min_length=1, max_length=10)
    note: str = Field(min_length=3, max_length=1000)


@router.post("/patients/{pid}/deposit-refunds", response_model=ReceiptOut, status_code=201)
def refund_deposit(
    pid: int, body: DepositRefundIn, db: DbSession, p: Principal = Credit
) -> ReceiptOut:
    """Give money held on account back to the patient (needs the refund permission)."""
    pt = _patient(db, pid)
    r = ledger.refund_deposit(db, pt, body.payments, body.note, p)
    db.commit()
    return _with_balances(db, _receipt_out(db, r), pid)


# ---------------------------------------------------------------- cash box (SPEC 10.9)
class ClosingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    from_at: datetime | None
    to_at: datetime
    totals_json: dict
    note: str
    closed_by: int
    closed_at: datetime
    user_name: str | None = None
    closed_by_name: str | None = None


class BoxOut(BaseModel):
    user_id: int
    user_name: str | None
    totals: dict
    last_closing: ClosingOut | None


def _box_user(p: Principal, user_id: int | None) -> int:
    """Your own box needs payment.collect; another user's needs cashbox.close."""
    uid = user_id or p.user.id
    need = "cashbox.close" if uid != p.user.id else "payment.collect"
    if not (p.can(need) or p.can("cashbox.close")):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "missing": [need]}
        )
    return uid


def _closing_out(db: Session, c: ClosingOut | CashClosing) -> ClosingOut:
    o = ClosingOut.model_validate(c)
    names = _names(db, {c.user_id, c.closed_by})
    o.user_name, o.closed_by_name = names.get(c.user_id), names.get(c.closed_by)
    return o


@router.get("/cash-box/current", response_model=BoxOut)
def current_box(
    db: DbSession, p: Principal = Depends(require()), user_id: int | None = None
) -> BoxOut:
    uid = _box_user(p, user_id)
    last = ledger.last_closing(db, uid)
    now = db.scalar(select(func.clock_timestamp()))
    return BoxOut(
        user_id=uid,
        user_name=_names(db, {uid}).get(uid),
        totals=ledger.box_totals(db, uid, last.to_at if last else None, now),
        last_closing=_closing_out(db, last) if last else None,
    )


class OpenBoxOut(BaseModel):
    user_id: int
    user_name: str | None
    since: datetime | None
    count: int
    net_total: Money


@router.get("/cash-box/open", response_model=list[OpenBoxOut])
def open_boxes(db: DbSession, _: Principal = Depends(require("cashbox.close"))) -> list[OpenBoxOut]:
    """Users with money movements since their last closing."""
    last = (
        select(CashClosing.user_id, func.max(CashClosing.to_at).label("to_at"))
        .group_by(CashClosing.user_id)
        .subquery()
    )
    rows = db.execute(
        select(Receipt.received_by, func.min(Receipt.received_at), func.count())
        .outerjoin(last, last.c.user_id == Receipt.received_by)
        .where(or_(last.c.to_at.is_(None), Receipt.received_at > last.c.to_at))
        .group_by(Receipt.received_by)
    ).all()
    names = _names(db, {r[0] for r in rows})
    now = db.scalar(select(func.clock_timestamp()))
    out = []
    for uid, since, n in rows:
        lc = ledger.last_closing(db, uid)
        t = ledger.box_totals(db, uid, lc.to_at if lc else None, now)
        out.append(
            OpenBoxOut(
                user_id=uid,
                user_name=names.get(uid),
                since=since,
                count=n,
                net_total=Decimal(t["net"]["total"]),
            )
        )
    return out


class CloseIn(BaseModel):
    user_id: int | None = None
    note: str = Field("", max_length=1000)


@router.post("/cash-box/close", response_model=ClosingOut, status_code=201)
def close_box(body: CloseIn, db: DbSession, p: Principal = Depends(require())) -> ClosingOut:
    uid = _box_user(p, body.user_id)
    c = ledger.close_box(db, uid, body.note, p)
    db.commit()
    return _closing_out(db, c)


@router.get("/cash-box/closings", response_model=list[ClosingOut])
def list_closings(
    db: DbSession,
    p: Principal = Depends(require()),
    user_id: int | None = None,
    limit: int = Query(100, le=500),
) -> list[ClosingOut]:
    stmt = select(CashClosing)
    if not p.can("cashbox.close"):
        _box_user(p, None)
        stmt = stmt.where(CashClosing.user_id == p.user.id)
    elif user_id:
        stmt = stmt.where(CashClosing.user_id == user_id)
    return [
        _closing_out(db, c)
        for c in db.scalars(stmt.order_by(CashClosing.to_at.desc()).limit(limit))
    ]


@router.get("/cash-box/closings/{cid}", response_model=ClosingOut)
def get_closing(cid: int, db: DbSession, p: Principal = Depends(require())) -> ClosingOut:
    c = db.get(CashClosing, cid)
    if c is None:
        raise not_found()
    _box_user(p, c.user_id)
    return _closing_out(db, c)
