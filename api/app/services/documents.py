"""Building quotation and payment order lines and totals on the server (SPEC 10.3, 18).

Clients send only what a person chooses (service, price, quantity, discount, teeth). Everything
derived (VAT rate, VAT, totals, insurance and patient shares) is computed here, every time.
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.deps import Principal
from app.models import (
    CreditNote,
    DraftLine,
    InsuranceClass,
    InsuranceCompany,
    Invoice,
    InvoiceLine,
    Patient,
    PatientInsurance,
    Service,
    Setting,
)
from app.services import pricing

RIYADH = ZoneInfo("Asia/Riyadh")
Money = Field(ge=0, max_digits=12, decimal_places=2)


class BillingSettings(BaseModel):
    vat_rate: Decimal = Field(Decimal(15), ge=0, le=100, max_digits=5, decimal_places=2)
    quotation_valid_days: int = Field(30, ge=1, le=365)


BILLING_KEY = "billing"


def get_billing(db: Session) -> BillingSettings:
    row = db.get(Setting, BILLING_KEY)
    return BillingSettings(**(row.value_json if row else {}))


class LineIn(BaseModel):
    service_id: int | None = None
    description_ar: str | None = Field(None, max_length=500)
    description_en: str | None = Field(None, max_length=500)
    price: Decimal = Money
    qty: Decimal = Field(Decimal(1), gt=0, max_digits=8, decimal_places=2)
    discount_amount: Decimal = Field(Decimal(0), ge=0, max_digits=12, decimal_places=2)
    discount_pct: Decimal = Field(Decimal(0), ge=0, le=100, max_digits=5, decimal_places=2)
    teeth: list[int] = []


class InsuranceChoice(BaseModel):
    """Insurance for this document. Prefilled from the patient; `use_insurance=false` bills as cash."""

    use_insurance: bool = True
    class_id: int | None = None
    policy_no: str | None = Field(None, max_length=60)
    membership_no: str | None = Field(None, max_length=60)


def _err(code: str, http: int = status.HTTP_422_UNPROCESSABLE_CONTENT, **extra) -> HTTPException:
    return HTTPException(http, detail={"code": code, **extra})


def insurance_snapshot(
    db: Session, patient: Patient, choice: InsuranceChoice | None, p: Principal
) -> tuple[dict | None, pricing.InsuranceRules | None]:
    """The insurance used on a document: from the patient, optionally overridden (with permission)."""
    if choice is not None and not choice.use_insurance:
        return None, None
    pins: PatientInsurance | None = patient.insurance
    if pins is None and (choice is None or choice.class_id is None):
        return None, None
    class_id = choice.class_id if choice and choice.class_id else (pins.class_id if pins else None)
    if (
        choice
        and choice.class_id
        and pins
        and choice.class_id != pins.class_id
        and not p.can("invoice.price_override")
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "missing": ["invoice.price_override"]},
        )
    cls = db.get(InsuranceClass, class_id) if class_id else None
    if class_id and (cls is None or cls.deleted_at is not None):
        raise _err("unknown_insurance_class")
    company_id = cls.company_id if cls else (pins.company_id if pins else None)
    company = db.get(InsuranceCompany, company_id) if company_id else None
    snap = {
        "company_id": company_id,
        "company_name_ar": company.name_ar if company else None,
        "company_name_en": company.name_en if company else None,
        "class_id": cls.id if cls else None,
        "class_name": cls.name if cls else (pins.class_name if pins else ""),
        "policy_no": (
            choice.policy_no
            if choice and choice.policy_no is not None
            else (pins.policy_no if pins else "")
        ),
        "membership_no": (
            choice.membership_no
            if choice and choice.membership_no is not None
            else (pins.membership_no if pins else "")
        ),
        "expiry": pins.expiry.isoformat() if pins and pins.expiry else None,
        "patient_share_pct": str(cls.patient_share_pct) if cls else None,
        "max_patient_share_per_invoice": str(cls.max_patient_share_per_invoice)
        if cls and cls.max_patient_share_per_invoice is not None
        else None,
        "consultation_max_covered": str(cls.consultation_max_covered)
        if cls and cls.consultation_max_covered is not None
        else None,
        "daily_limit": str(cls.daily_limit) if cls and cls.daily_limit is not None else None,
    }
    if cls is None:
        # Insured, but no class rules set up yet: nothing can be split, so the patient pays (shown as a note).
        return snap, None
    rules = pricing.InsuranceRules(
        patient_share_pct=cls.patient_share_pct,
        max_patient_share_per_invoice=cls.max_patient_share_per_invoice,
        consultation_max_covered=cls.consultation_max_covered,
        daily_limit=cls.daily_limit,
        excluded_service_ids=frozenset(cls.excluded_service_ids or []),
        expiry=pins.expiry if pins else None,
    )
    return snap, rules


def insurer_used_today(
    db: Session, patient_id: int, day: date, company_id: int | None = None
) -> Decimal:
    """Insurer's share before VAT already used on today's final invoices for this patient, less credit
    notes on them (SPEC 10.4 daily limit). Counted per insurance company when one is given."""
    start = datetime.combine(day, time(0), tzinfo=RIYADH)
    end = start + timedelta(days=1)
    inv = select(Invoice.id).where(
        Invoice.patient_id == patient_id, Invoice.issued_at >= start, Invoice.issued_at < end
    )
    if company_id is not None:
        inv = inv.where(Invoice.insurance_company_id == company_id)
    used = db.scalar(
        select(
            func.coalesce(func.sum(InvoiceLine.insurance_share - InvoiceLine.insurance_vat), 0)
        ).where(InvoiceLine.invoice_id.in_(inv))
    )
    credited = db.scalar(
        select(
            func.coalesce(func.sum(CreditNote.insurance_share - CreditNote.insurance_vat), 0)
        ).where(CreditNote.invoice_id.in_(inv))
    )
    return Decimal(used) - Decimal(credited)


def build(
    db: Session,
    patient: Patient,
    lines: list[LineIn],
    choice: InsuranceChoice | None,
    p: Principal,
    on_date: date,
) -> tuple[list[dict], pricing.Totals, dict | None, bool]:
    """Validate lines against the catalog and price limits, then calculate. Returns
    (line rows, totals, insurance snapshot, saudi)."""
    if not lines:
        raise _err("no_lines")
    services = {
        s.id: s
        for s in db.scalars(
            select(Service).where(Service.id.in_([ln.service_id for ln in lines if ln.service_id]))
        )
    }
    rows, calc_lines = [], []
    for i, ln in enumerate(lines):
        svc = services.get(ln.service_id) if ln.service_id else None
        if ln.service_id and (svc is None or svc.deleted_at is not None or not svc.is_active):
            raise _err("unknown_service", line=i)
        if svc is None and not (ln.description_ar or "").strip():
            raise _err("line_description_required", line=i)
        overridden = False
        if svc is not None and not (svc.min_price <= ln.price <= svc.max_price):
            # Outside the service's range needs invoice.price_override (SPEC 10.3).
            if not p.can("invoice.price_override"):
                raise _err(
                    "price_out_of_range", line=i, min=str(svc.min_price), max=str(svc.max_price)
                )
            overridden = True
        if svc is None and not p.can("invoice.price_override"):
            raise _err("free_line_needs_override", line=i)
        if ln.discount_amount > ln.price * ln.qty:
            raise _err("discount_too_large", line=i)
        bad = [t for t in ln.teeth if not (11 <= t <= 48 or 51 <= t <= 85)]
        if bad:
            raise _err("invalid_teeth", line=i)
        rows.append(
            {
                "seq": i + 1,
                "service_id": svc.id if svc else None,
                "description_ar": (ln.description_ar or (svc.name_ar if svc else "")).strip(),
                "description_en": (ln.description_en or (svc.name_en if svc else "")).strip(),
                "price": ln.price,
                "qty": ln.qty,
                "discount_amount": ln.discount_amount,
                "discount_pct": ln.discount_pct,
                "teeth": sorted(set(ln.teeth)),
                "price_overridden": overridden,
            }
        )
        calc_lines.append(
            pricing.LineIn(
                price=ln.price,
                qty=ln.qty,
                discount_amount=ln.discount_amount,
                discount_pct=ln.discount_pct,
                vat_applicable=svc.vat_applicable if svc else True,
                is_consultation=svc.is_consultation if svc else False,
                service_id=svc.id if svc else None,
            )
        )
    snap, rules = insurance_snapshot(db, patient, choice, p)
    saudi = pricing.is_saudi(patient.nationality, patient.national_id)
    totals = pricing.calculate(
        calc_lines,
        standard_vat_rate=get_billing(db).vat_rate,
        saudi=saudi,
        insurance=rules,
        on_date=on_date,
        insurer_used_today=insurer_used_today(db, patient.id, on_date, snap.get("company_id"))
        if rules
        else Decimal(0),
    )
    if snap is not None and rules is None:
        totals.notes.append("insurance_class_missing")
    if not saudi and patient.nationality is None and not patient.national_id:
        totals.notes.append("nationality_unknown_vat_charged")
    for r, lo in zip(rows, totals.lines, strict=True):
        r.update(
            gross=lo.gross,
            discount=lo.discount,
            net=lo.net,
            vat_rate=lo.vat_rate,
            vat_amount=lo.vat,
            line_total=lo.total,
            patient_share=lo.patient_share,
            insurance_share=lo.insurance_share,
            insurance_vat=lo.insurance_share - lo.insurance_net if lo.covered else Decimal(0),
        )
    return rows, totals, snap, saudi


def apply(
    db: Session,
    doc,
    parent_type: str,
    rows: list[dict],
    totals: pricing.Totals,
    snap: dict | None,
    saudi: bool,
) -> None:
    """Replace a document's lines and totals."""
    if doc.id:
        db.execute(
            delete(DraftLine).where(
                DraftLine.parent_type == parent_type, DraftLine.parent_id == doc.id
            )
        )
    db.flush()
    for r in rows:
        db.add(DraftLine(parent_type=parent_type, parent_id=doc.id, **r))
    doc.insurance = snap
    doc.saudi = saudi
    for k in ("gross", "discount", "net", "vat", "total", "insurance_share", "patient_share"):
        setattr(doc, k, getattr(totals, k))


def lines_of(db: Session, parent_type: str, parent_id: int) -> list[DraftLine]:
    return list(
        db.scalars(
            select(DraftLine)
            .where(DraftLine.parent_type == parent_type, DraftLine.parent_id == parent_id)
            .order_by(DraftLine.seq)
        )
    )


def recalculate(db: Session, doc, parent_type: str, patient: Patient, on_date: date) -> bool:
    """Recalculate a saved document from its own lines (at payment time: VAT rate, nationality and the
    insurer's daily limit may have changed since it was written). Prices and discounts stay as saved;
    price limits are not checked again. Returns True if any amount changed."""
    saved = lines_of(db, parent_type, doc.id)
    services = {
        s.id: s
        for s in db.scalars(
            select(Service).where(Service.id.in_([ln.service_id for ln in saved if ln.service_id]))
        )
    }
    snap = doc.insurance
    rules = None
    if snap and snap.get("class_id"):
        cls = db.get(InsuranceClass, snap["class_id"])
        if cls is not None:
            exp = snap.get("expiry")
            rules = pricing.InsuranceRules(
                patient_share_pct=cls.patient_share_pct,
                max_patient_share_per_invoice=cls.max_patient_share_per_invoice,
                consultation_max_covered=cls.consultation_max_covered,
                daily_limit=cls.daily_limit,
                excluded_service_ids=frozenset(cls.excluded_service_ids or []),
                expiry=date.fromisoformat(exp) if exp else None,
            )
    saudi = pricing.is_saudi(patient.nationality, patient.national_id)
    totals = pricing.calculate(
        [
            pricing.LineIn(
                price=ln.price,
                qty=ln.qty,
                discount_amount=ln.discount_amount,
                discount_pct=ln.discount_pct,
                vat_applicable=services[ln.service_id].vat_applicable if ln.service_id else True,
                is_consultation=services[ln.service_id].is_consultation if ln.service_id else False,
                service_id=ln.service_id,
            )
            for ln in saved
        ],
        standard_vat_rate=get_billing(db).vat_rate,
        saudi=saudi,
        insurance=rules,
        on_date=on_date,
        insurer_used_today=insurer_used_today(db, patient.id, on_date, snap.get("company_id"))
        if rules
        else Decimal(0),
    )
    changed = saudi != doc.saudi
    for ln, lo in zip(saved, totals.lines, strict=True):
        new = {
            "gross": lo.gross,
            "discount": lo.discount,
            "net": lo.net,
            "vat_rate": lo.vat_rate,
            "vat_amount": lo.vat,
            "line_total": lo.total,
            "patient_share": lo.patient_share,
            "insurance_share": lo.insurance_share,
            "insurance_vat": lo.insurance_share - lo.insurance_net if lo.covered else Decimal(0),
        }
        for k, v in new.items():
            if getattr(ln, k) != v:
                setattr(ln, k, v)
                changed = True
    doc.saudi = saudi
    for k in ("gross", "discount", "net", "vat", "total", "insurance_share", "patient_share"):
        if getattr(doc, k) != getattr(totals, k):
            setattr(doc, k, getattr(totals, k))
            changed = True
    return changed
