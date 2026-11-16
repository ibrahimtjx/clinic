"""Issuing final invoices, receipts and credit notes; patient balances; the cash box (SPEC 10.5–10.9).

Everything here runs inside the caller's transaction and commits together with it: paying a payment
order issues the invoice (gapless number), the receipt and the balance change at once, or nothing.

Patient money:
  - `patients.balance` is what the patient still owes on final invoices.
  - `patients.deposit_balance` is money held on account (deposits, credit moved to deposit).
  Outstanding on one invoice = patient share - payments allocated to it - credit notes that lowered it.
"""

import base64
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, literal, select, text, union_all, update
from sqlalchemy.orm import Session

from app.deps import Principal
from app.models import (
    CashClosing,
    CreditNote,
    CreditNoteLine,
    Invoice,
    InvoiceLine,
    Patient,
    PaymentOrder,
    PlanInstallment,
    Receipt,
    ReceiptAllocation,
    ReceiptPayment,
)
from app.services import documents, numbering
from app.services.pricing import ZERO, _allocate, money
from app.services.settings import get_clinic_info

Method = Literal["cash", "mada", "credit_card", "bank_transfer", "deposit"]
CASH_METHODS = ("cash", "mada", "credit_card", "bank_transfer")  # money that passes the cash box
GENESIS_HASH = hashlib.sha256(b"0").hexdigest()
_CHAIN_LOCK = 7000  # advisory lock keys
_CASHBOX_LOCK = 7001


class PaymentIn(BaseModel):
    method: Method
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    reference: str = Field("", max_length=100)


def err(code: str, http: int = status.HTTP_422_UNPROCESSABLE_CONTENT, **extra) -> HTTPException:
    return HTTPException(http, detail={"code": code, **extra})


# ---------------------------------------------------------------- helpers
def lock_cashbox(db: Session, user_id: int) -> datetime:
    """Serialize money movements of one user with that user's box closing, then return the exact
    time to stamp (taken after the lock, so nothing lands inside an already closed shift)."""
    db.execute(text("SELECT pg_advisory_xact_lock(:k, :u)"), {"k": _CASHBOX_LOCK, "u": user_id})
    return db.scalar(select(func.clock_timestamp()))


def _lock_chain(db: Session) -> str:
    """Invoices and credit notes form one hash chain (ZATCA previous invoice hash)."""
    db.execute(text("SELECT pg_advisory_xact_lock(:k, 0)"), {"k": _CHAIN_LOCK})
    q = union_all(
        select(
            Invoice.hash.label("h"),
            Invoice.issued_at.label("at"),
            literal(0).label("t"),
            Invoice.id.label("i"),
        ),
        select(CreditNote.hash, CreditNote.issued_at, literal(1), CreditNote.id),
    ).subquery()
    last = db.scalar(select(q.c.h).order_by(q.c.at.desc(), q.c.t.desc(), q.c.i.desc()).limit(1))
    return last or GENESIS_HASH


def _hash(payload: dict, previous: str) -> str:
    body = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256((previous + body).encode()).hexdigest()


def zatca_qr(seller: str, vat_no: str, at: datetime, total: Decimal, vat: Decimal) -> str:
    """ZATCA simplified invoice QR (phase 1 TLV, base64): seller, VAT number, time, total, VAT."""
    out = b""
    for tag, value in enumerate(
        [seller, vat_no, at.isoformat(timespec="seconds"), f"{total:.2f}", f"{vat:.2f}"], start=1
    ):
        v = value.encode()
        out += bytes([tag, len(v)]) + v
    return base64.b64encode(out).decode()


def adjust_patient(
    db: Session, patient_id: int, balance: Decimal = ZERO, deposit: Decimal = ZERO
) -> None:
    """Atomic change of what a patient owes / holds, without bumping the record version."""
    if deposit < 0:
        res = db.execute(
            update(Patient)
            .where(Patient.id == patient_id, Patient.deposit_balance >= -deposit)
            .values(
                balance=Patient.balance + balance, deposit_balance=Patient.deposit_balance + deposit
            )
        )
        if res.rowcount != 1:
            raise err("insufficient_deposit")
        return
    db.execute(
        update(Patient)
        .where(Patient.id == patient_id)
        .values(
            balance=Patient.balance + balance, deposit_balance=Patient.deposit_balance + deposit
        )
    )


def _vat_part(amount: Decimal, vat: Decimal, total: Decimal) -> Decimal:
    return money(amount * vat / total) if total > 0 else ZERO


def outstanding(db: Session, invoice_ids: list[int]) -> dict[int, Decimal]:
    if not invoice_ids:
        return {}
    paid = dict(
        db.execute(
            select(ReceiptAllocation.invoice_id, func.sum(ReceiptAllocation.amount))
            .where(ReceiptAllocation.invoice_id.in_(invoice_ids))
            .group_by(ReceiptAllocation.invoice_id)
        ).all()
    )
    reduced = dict(
        db.execute(
            select(CreditNote.invoice_id, func.sum(CreditNote.balance_reduced))
            .where(CreditNote.invoice_id.in_(invoice_ids))
            .group_by(CreditNote.invoice_id)
        ).all()
    )
    shares = dict(
        db.execute(
            select(Invoice.id, Invoice.patient_share).where(Invoice.id.in_(invoice_ids))
        ).all()
    )
    return {i: shares[i] - paid.get(i, ZERO) - reduced.get(i, ZERO) for i in invoice_ids}


def _receipt(
    db: Session,
    p: Principal,
    at: datetime,
    kind: str,
    patient_id: int,
    payments: list[PaymentIn],
    vat: Decimal,
    *,
    invoice_id: int | None = None,
    credit_note_id: int | None = None,
    plan_id: int | None = None,
    note: str = "",
) -> Receipt:
    total = sum((x.amount for x in payments), ZERO)
    r = Receipt(
        receipt_no=numbering.allocate(db, "receipt"),
        kind=kind,
        patient_id=patient_id,
        invoice_id=invoice_id,
        credit_note_id=credit_note_id,
        plan_id=plan_id,
        received_by=p.user.id,
        received_at=at,
        total=total,
        vat=vat,
        note=(note or "").strip(),
    )
    db.add(r)
    db.flush()
    for x, v in zip(payments, _allocate(vat, [x.amount for x in payments]), strict=True):
        db.add(
            ReceiptPayment(
                receipt_id=r.id,
                method=x.method,
                amount=x.amount,
                vat=v,
                reference=x.reference.strip(),
            )
        )
    return r


def _check_payments(payments: list[PaymentIn], allow_deposit: bool = True) -> Decimal:
    if not allow_deposit and any(x.method == "deposit" for x in payments):
        raise err("deposit_method_not_allowed")
    return sum((x.amount for x in payments), ZERO)


# ---------------------------------------------------------------- invoice from a payment order
@dataclass
class Collected:
    invoice: Invoice
    receipt: Receipt | None


def collect(
    db: Session, po: PaymentOrder, payments: list[PaymentIn], note: str, p: Principal
) -> Collected:
    """Pay a payment order: issue the final invoice and the receipt in one transaction (SPEC 10.5)."""
    patient = db.get(Patient, po.patient_id)
    at = lock_cashbox(db, p.user.id)
    paid = _check_payments(payments)
    if paid > po.patient_share:
        raise err("overpaid", due=f"{po.patient_share:.2f}")
    lines = documents.lines_of(db, "payment_order", po.id)
    clinic = get_clinic_info(db)
    previous = _lock_chain(db)
    snap = po.insurance or {}
    ins_vat = sum((ln.insurance_vat for ln in lines), ZERO)
    inv = Invoice(
        invoice_no=numbering.allocate(db, "invoice"),
        payment_order_id=po.id,
        patient_id=po.patient_id,
        doctor_id=po.doctor_id,
        clinic_id=po.clinic_id,
        plan_id=po.plan_id,
        installment_id=po.installment_id,
        issued_at=at,
        issued_by=p.user.id,
        notes=po.notes,
        insurance=po.insurance,
        insurance_company_id=snap.get("company_id"),
        buyer_name_ar=patient.name_ar,
        buyer_name_en=patient.name_en or "",
        buyer_national_id=patient.national_id or "",
        buyer_nationality=patient.nationality or "",
        buyer_file_no=patient.file_no,
        saudi=po.saudi,
        seller_name_ar=clinic.name_ar,
        seller_name_en=clinic.name_en,
        seller_vat_no=clinic.vat_number,
        seller_cr_no=clinic.cr_number,
        seller_address_ar=clinic.address_ar,
        gross=po.gross,
        discount=po.discount,
        net=po.net,
        vat=po.vat,
        total=po.total,
        insurance_share=po.insurance_share,
        insurance_vat=ins_vat,
        patient_share=po.patient_share,
        patient_vat=po.vat - ins_vat,
        previous_hash=previous,
        hash="",
        qr_payload="",
    )
    inv.hash = _hash(
        {
            "no": inv.invoice_no,
            "at": at.isoformat(),
            "seller_vat": inv.seller_vat_no,
            "buyer": [inv.buyer_name_ar, inv.buyer_national_id],
            "total": f"{inv.total:.2f}",
            "vat": f"{inv.vat:.2f}",
            "lines": [[ln.seq, f"{ln.net:.2f}", f"{ln.vat_amount:.2f}"] for ln in lines],
        },
        previous,
    )
    inv.qr_payload = zatca_qr(clinic.name_ar, clinic.vat_number, at, inv.total, inv.vat)
    db.add(inv)
    db.flush()
    for ln in lines:
        db.add(
            InvoiceLine(
                invoice_id=inv.id,
                **{
                    k: getattr(ln, k)
                    for k in (
                        "seq",
                        "service_id",
                        "description_ar",
                        "description_en",
                        "price",
                        "qty",
                        "discount_amount",
                        "discount_pct",
                        "gross",
                        "discount",
                        "net",
                        "vat_rate",
                        "vat_amount",
                        "line_total",
                        "patient_share",
                        "insurance_share",
                        "insurance_vat",
                        "teeth",
                        "price_overridden",
                    )
                },
            )
        )
    receipt = None
    if paid > 0:
        receipt = _receipt(
            db,
            p,
            at,
            "installment" if po.installment_id else "payment",
            po.patient_id,
            payments,
            _vat_part(paid, inv.patient_vat, inv.patient_share),
            invoice_id=inv.id,
            plan_id=po.plan_id,
            note=note,
        )
        db.add(ReceiptAllocation(receipt_id=receipt.id, invoice_id=inv.id, amount=paid))
    used = sum((x.amount for x in payments if x.method == "deposit"), ZERO)
    adjust_patient(db, po.patient_id, balance=inv.patient_share - paid, deposit=-used)
    if po.installment_id:
        inst = db.get(PlanInstallment, po.installment_id)
        inst.paid_amount = min(inst.amount, inst.paid_amount + sum((ln.net for ln in lines), ZERO))
    po.status = "paid"
    po.updated_by = p.user.id
    return Collected(inv, receipt)


# ---------------------------------------------------------------- later payments, deposits
def pay_balance(
    db: Session,
    patient: Patient,
    payments: list[PaymentIn],
    invoice_ids: list[int] | None,
    note: str,
    p: Principal,
) -> Receipt:
    """Pay what the patient owes, oldest invoice first (or only the chosen invoices)."""
    at = lock_cashbox(db, p.user.id)
    amount = _check_payments(payments)
    q = (
        select(Invoice.id)
        .where(Invoice.patient_id == patient.id)
        .order_by(Invoice.issued_at, Invoice.id)
    )
    if invoice_ids:
        q = q.where(Invoice.id.in_(invoice_ids))
    ids = list(db.scalars(q))
    if invoice_ids and len(ids) != len(set(invoice_ids)):
        raise err("unknown_invoice")
    owed = {i: o for i, o in outstanding(db, ids).items() if o > 0}
    total_owed = sum(owed.values(), ZERO)
    if amount > total_owed:
        raise err("overpaid", due=f"{total_owed:.2f}")
    left, allocs = amount, []
    for i in ids:
        if i in owed and left > 0:
            part = min(left, owed[i])
            allocs.append((i, part))
            left -= part
    invs = {
        i.id: i for i in db.scalars(select(Invoice).where(Invoice.id.in_([a[0] for a in allocs])))
    }
    vat = sum((_vat_part(a, invs[i].patient_vat, invs[i].patient_share) for i, a in allocs), ZERO)
    r = _receipt(
        db,
        p,
        at,
        "payment",
        patient.id,
        payments,
        vat,
        invoice_id=allocs[0][0] if len(allocs) == 1 else None,
        note=note,
    )
    for i, a in allocs:
        db.add(ReceiptAllocation(receipt_id=r.id, invoice_id=i, amount=a))
    used = sum((x.amount for x in payments if x.method == "deposit"), ZERO)
    adjust_patient(db, patient.id, balance=-amount, deposit=-used)
    return r


def take_deposit(
    db: Session,
    patient: Patient,
    payments: list[PaymentIn],
    plan_id: int | None,
    note: str,
    p: Principal,
) -> Receipt:
    """Money on account, e.g. an advance for a treatment plan. VAT is accounted on the invoice."""
    at = lock_cashbox(db, p.user.id)
    amount = _check_payments(payments, allow_deposit=False)
    r = _receipt(db, p, at, "deposit", patient.id, payments, ZERO, plan_id=plan_id, note=note)
    adjust_patient(db, patient.id, deposit=amount)
    return r


def refund_deposit(
    db: Session, patient: Patient, payments: list[PaymentIn], note: str, p: Principal
) -> Receipt:
    at = lock_cashbox(db, p.user.id)
    amount = _check_payments(payments, allow_deposit=False)
    adjust_patient(db, patient.id, deposit=-amount)
    return _receipt(db, p, at, "refund", patient.id, payments, ZERO, note=note)


# ---------------------------------------------------------------- credit notes (SPEC 10.6)
class CreditLineIn(BaseModel):
    invoice_line_id: int
    qty: Decimal = Field(gt=0, max_digits=8, decimal_places=2)


class RefundIn(BaseModel):
    """How to settle the part of the credit the patient already paid: refund or keep on account."""

    to_deposit: bool = False
    payments: list[PaymentIn] = []


_CREDIT_FIELDS = (
    "net",
    "vat_amount",
    "line_total",
    "patient_share",
    "insurance_share",
    "insurance_vat",
)


def credited_by_line(db: Session, invoice_id: int) -> dict[int, dict[str, Decimal]]:
    rows = db.execute(
        select(
            CreditNoteLine.invoice_line_id,
            func.sum(CreditNoteLine.qty),
            func.sum(CreditNoteLine.net),
            func.sum(CreditNoteLine.vat),
            func.sum(CreditNoteLine.total),
            func.sum(CreditNoteLine.patient_share),
            func.sum(CreditNoteLine.insurance_share),
            func.sum(CreditNoteLine.insurance_vat),
        )
        .join(CreditNote, CreditNote.id == CreditNoteLine.credit_note_id)
        .where(CreditNote.invoice_id == invoice_id)
        .group_by(CreditNoteLine.invoice_line_id)
    ).all()
    return {r[0]: dict(zip(("qty", *_CREDIT_FIELDS), r[1:], strict=True)) for r in rows}


def issue_credit_note(
    db: Session,
    inv: Invoice,
    reason: str,
    lines: list[CreditLineIn] | None,
    refund: RefundIn | None,
    p: Principal,
) -> CreditNote:
    """Credit the whole invoice (lines=None) or chosen quantities of lines. The patient's part first
    lowers what they still owe on this invoice; the rest is refunded or kept on account."""
    at = lock_cashbox(db, p.user.id)
    inv_lines = {
        ln.id: ln for ln in db.scalars(select(InvoiceLine).where(InvoiceLine.invoice_id == inv.id))
    }
    done = credited_by_line(db, inv.id)
    wanted = (
        [(i, ln.qty - done.get(i, {}).get("qty", ZERO)) for i, ln in inv_lines.items()]
        if lines is None
        else [(x.invoice_line_id, x.qty) for x in lines]
    )
    out: list[CreditNoteLine] = []
    for lid, qty in wanted:
        ln = inv_lines.get(lid)
        if ln is None:
            raise err("unknown_invoice_line", line=lid)
        prev = done.get(lid, {})
        left_qty = ln.qty - prev.get("qty", ZERO)
        if qty <= 0 and lines is None:
            continue
        if qty > left_qty:
            raise err("credit_exceeds_line", line=lid, available=f"{left_qty:.2f}")
        amounts = {}
        for f in _CREDIT_FIELDS:
            left = getattr(ln, f) - prev.get(f, ZERO)
            amounts[f] = (
                left if qty == left_qty else min(left, money(getattr(ln, f) * qty / ln.qty))
            )
        out.append(
            CreditNoteLine(
                invoice_line_id=lid,
                qty=qty,
                net=amounts["net"],
                vat=amounts["vat_amount"],
                total=amounts["line_total"],
                patient_share=amounts["patient_share"],
                insurance_share=amounts["insurance_share"],
                insurance_vat=amounts["insurance_vat"],
            )
        )
    if not out:
        raise err("nothing_to_credit")
    tot = {
        k: sum((getattr(c, k) for c in out), ZERO)
        for k in ("net", "vat", "total", "patient_share", "insurance_share", "insurance_vat")
    }
    owed = max(ZERO, outstanding(db, [inv.id])[inv.id])
    reduced = min(tot["patient_share"], owed)
    to_return = tot["patient_share"] - reduced
    refund = refund or RefundIn()
    if to_return > 0:
        if refund.to_deposit:
            if refund.payments:
                raise err("refund_choose_one")
        else:
            got = _check_payments(refund.payments, allow_deposit=False)
            if got != to_return:
                raise err("refund_amount_mismatch", due=f"{to_return:.2f}")
    elif refund.payments:
        raise err("nothing_to_refund")
    previous = _lock_chain(db)
    clinic = get_clinic_info(db)
    cn = CreditNote(
        credit_note_no=numbering.allocate(db, "credit_note"),
        invoice_id=inv.id,
        patient_id=inv.patient_id,
        reason=reason.strip(),
        issued_at=at,
        issued_by=p.user.id,
        patient_vat=tot["vat"] - tot["insurance_vat"],
        balance_reduced=reduced,
        refunded=to_return,
        previous_hash=previous,
        hash="",
        qr_payload="",
        **tot,
    )
    cn.hash = _hash(
        {
            "no": cn.credit_note_no,
            "invoice": inv.invoice_no,
            "at": at.isoformat(),
            "total": f"{cn.total:.2f}",
            "vat": f"{cn.vat:.2f}",
            "lines": [[c.invoice_line_id, f"{c.qty}", f"{c.net:.2f}"] for c in out],
        },
        previous,
    )
    cn.qr_payload = zatca_qr(clinic.name_ar, inv.seller_vat_no, at, cn.total, cn.vat)
    db.add(cn)
    db.flush()
    for c in out:
        c.credit_note_id = cn.id
        db.add(c)
    adjust_patient(
        db, inv.patient_id, balance=-reduced, deposit=to_return if refund.to_deposit else ZERO
    )
    if to_return > 0:
        pays = (
            refund.payments
            if not refund.to_deposit
            else [PaymentIn(method="deposit", amount=to_return)]
        )
        _receipt(
            db,
            p,
            at,
            "refund",
            inv.patient_id,
            pays,
            _vat_part(to_return, cn.patient_vat, cn.patient_share),
            invoice_id=inv.id,
            credit_note_id=cn.id,
            note=reason,
        )
    return cn


# ---------------------------------------------------------------- cash box (SPEC 10.9)
def _split(total: Decimal, vat: Decimal) -> dict[str, str]:
    return {"net": f"{total - vat:.2f}", "vat": f"{vat:.2f}", "total": f"{total:.2f}"}


def last_closing(db: Session, user_id: int) -> CashClosing | None:
    return db.scalar(
        select(CashClosing)
        .where(CashClosing.user_id == user_id)
        .order_by(CashClosing.to_at.desc())
        .limit(1)
    )


def box_totals(db: Session, user_id: int, from_at: datetime | None, to_at: datetime) -> dict:
    q = (
        select(
            Receipt.kind,
            ReceiptPayment.method,
            func.sum(ReceiptPayment.amount),
            func.sum(ReceiptPayment.vat),
            func.count(),
        )
        .join(Receipt, Receipt.id == ReceiptPayment.receipt_id)
        .where(Receipt.received_by == user_id, Receipt.received_at <= to_at)
        .group_by(Receipt.kind, ReceiptPayment.method)
    )
    if from_at is not None:
        q = q.where(Receipt.received_at > from_at)
    methods: dict[str, dict[str, Decimal]] = {
        m: {"in": ZERO, "in_vat": ZERO, "out": ZERO, "out_vat": ZERO} for m in CASH_METHODS
    }
    deposit_used = deposit_kept = ZERO
    deposits_taken = ZERO
    count = 0
    for kind, method, amount, vat, n in db.execute(q).all():
        count += n
        if method == "deposit":
            if kind == "refund":
                deposit_kept += amount
            else:
                deposit_used += amount
            continue
        m = methods[method]
        if kind == "refund":
            m["out"] += amount
            m["out_vat"] += vat
        else:
            m["in"] += amount
            m["in_vat"] += vat
            if kind == "deposit":
                deposits_taken += amount
    rows = []
    s = {"in": ZERO, "in_vat": ZERO, "out": ZERO, "out_vat": ZERO}
    for name, m in methods.items():
        for k in s:
            s[k] += m[k]
        rows.append(
            {
                "method": name,
                "in": _split(m["in"], m["in_vat"]),
                "out": _split(m["out"], m["out_vat"]),
                "net": _split(m["in"] - m["out"], m["in_vat"] - m["out_vat"]),
            }
        )
    return {
        "from_at": from_at.isoformat() if from_at else None,
        "to_at": to_at.isoformat(),
        "count": count,
        "methods": rows,
        "in": _split(s["in"], s["in_vat"]),
        "out": _split(s["out"], s["out_vat"]),
        "net": _split(s["in"] - s["out"], s["in_vat"] - s["out_vat"]),
        "deposits_taken": f"{deposits_taken:.2f}",
        "deposit_used": f"{deposit_used:.2f}",
        "credit_to_deposit": f"{deposit_kept:.2f}",
    }


def close_box(db: Session, user_id: int, note: str, p: Principal) -> CashClosing:
    at = lock_cashbox(db, user_id)
    prev = last_closing(db, user_id)
    from_at = prev.to_at if prev else None
    c = CashClosing(
        user_id=user_id,
        from_at=from_at,
        to_at=at,
        totals_json=box_totals(db, user_id, from_at, at),
        note=(note or "").strip(),
        closed_by=p.user.id,
        closed_at=at,
    )
    db.add(c)
    db.flush()
    return c
