"""Final invoices, credit notes, receipts and cash box closings (SPEC 10.2, 10.5–10.9, milestone M8).

Every table here is append-only: a database trigger rejects UPDATE, DELETE and TRUNCATE, so issued
documents cannot be changed by anyone, including Admin or a direct SQL session (SPEC 10.6).
"""

import uuid as uuid_mod
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    Uuid,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

MONEY = Numeric(12, 2)
PCT = Numeric(5, 2)
ZERO = Decimal(0)

IMMUTABLE_TABLES = (
    "invoices",
    "invoice_lines",
    "credit_notes",
    "credit_note_lines",
    "receipts",
    "receipt_payments",
    "receipt_allocations",
    "cash_closings",
)


def _money(**kw) -> Mapped[Decimal]:
    return mapped_column(MONEY, default=ZERO, server_default="0", **kw)


class Invoice(Base):
    __tablename__ = "invoices"
    __audited__ = True
    __table_args__ = (Index("ix_invoices_patient", "patient_id", "issued_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    invoice_no: Mapped[str] = mapped_column(String(30), unique=True)
    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, unique=True, default=uuid_mod.uuid4)
    payment_order_id: Mapped[int] = mapped_column(ForeignKey("payment_orders.id"), unique=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    doctor_id: Mapped[int | None] = mapped_column(ForeignKey("doctors.id"))
    clinic_id: Mapped[int | None] = mapped_column(ForeignKey("clinics.id"))
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("treatment_plans.id"))
    installment_id: Mapped[int | None] = mapped_column(ForeignKey("treatment_plan_installments.id"))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    issued_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Snapshots (SPEC 10.7 / ZATCA): what the invoice said at issue time, never looked up again.
    insurance: Mapped[dict | None] = mapped_column(JSONB)
    insurance_company_id: Mapped[int | None] = mapped_column(ForeignKey("insurance_companies.id"))
    buyer_name_ar: Mapped[str] = mapped_column(String(200))
    buyer_name_en: Mapped[str] = mapped_column(String(200), default="", server_default="")
    buyer_national_id: Mapped[str] = mapped_column(String(20), default="", server_default="")
    buyer_nationality: Mapped[str] = mapped_column(String(2), default="", server_default="")
    buyer_file_no: Mapped[int] = mapped_column(Integer)
    saudi: Mapped[bool] = mapped_column(Boolean)
    seller_name_ar: Mapped[str] = mapped_column(String(200), default="", server_default="")
    seller_name_en: Mapped[str] = mapped_column(String(200), default="", server_default="")
    seller_vat_no: Mapped[str] = mapped_column(String(15), default="", server_default="")
    seller_cr_no: Mapped[str] = mapped_column(String(20), default="", server_default="")
    seller_address_ar: Mapped[str] = mapped_column(Text, default="", server_default="")
    gross: Mapped[Decimal] = _money()
    discount: Mapped[Decimal] = _money()
    net: Mapped[Decimal] = _money()
    vat: Mapped[Decimal] = _money()
    total: Mapped[Decimal] = _money()
    insurance_share: Mapped[Decimal] = _money()
    insurance_vat: Mapped[Decimal] = _money()
    patient_share: Mapped[Decimal] = _money()
    patient_vat: Mapped[Decimal] = _money()
    previous_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
    qr_payload: Mapped[str] = mapped_column(Text)


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    service_id: Mapped[int | None] = mapped_column(ForeignKey("services.id"), index=True)
    description_ar: Mapped[str] = mapped_column(Text)
    description_en: Mapped[str] = mapped_column(Text, default="", server_default="")
    price: Mapped[Decimal] = mapped_column(MONEY)
    qty: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    discount_amount: Mapped[Decimal] = mapped_column(MONEY)
    discount_pct: Mapped[Decimal] = mapped_column(PCT)
    gross: Mapped[Decimal] = mapped_column(MONEY)
    discount: Mapped[Decimal] = mapped_column(MONEY)
    net: Mapped[Decimal] = mapped_column(MONEY)
    vat_rate: Mapped[Decimal] = mapped_column(PCT)
    vat_amount: Mapped[Decimal] = mapped_column(MONEY)
    line_total: Mapped[Decimal] = mapped_column(MONEY)
    patient_share: Mapped[Decimal] = mapped_column(MONEY)
    insurance_share: Mapped[Decimal] = mapped_column(MONEY)
    insurance_vat: Mapped[Decimal] = _money()
    teeth: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), default=list, server_default="{}")
    price_overridden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class CreditNote(Base):
    __tablename__ = "credit_notes"
    __audited__ = True

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    credit_note_no: Mapped[str] = mapped_column(String(30), unique=True)
    uuid: Mapped[uuid_mod.UUID] = mapped_column(Uuid, unique=True, default=uuid_mod.uuid4)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), index=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    reason: Mapped[str] = mapped_column(Text)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    issued_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    net: Mapped[Decimal] = _money()
    vat: Mapped[Decimal] = _money()
    total: Mapped[Decimal] = _money()
    insurance_share: Mapped[Decimal] = _money()
    insurance_vat: Mapped[Decimal] = _money()
    patient_share: Mapped[Decimal] = _money()
    patient_vat: Mapped[Decimal] = _money()
    # How the patient's part was settled: lowered what they owed, refunded, or moved to deposit.
    balance_reduced: Mapped[Decimal] = _money()
    refunded: Mapped[Decimal] = _money()
    previous_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
    qr_payload: Mapped[str] = mapped_column(Text)


class CreditNoteLine(Base):
    __tablename__ = "credit_note_lines"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    credit_note_id: Mapped[int] = mapped_column(ForeignKey("credit_notes.id"), index=True)
    invoice_line_id: Mapped[int] = mapped_column(ForeignKey("invoice_lines.id"), index=True)
    qty: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    net: Mapped[Decimal] = mapped_column(MONEY)
    vat: Mapped[Decimal] = mapped_column(MONEY)
    total: Mapped[Decimal] = mapped_column(MONEY)
    patient_share: Mapped[Decimal] = mapped_column(MONEY)
    insurance_share: Mapped[Decimal] = mapped_column(MONEY)
    insurance_vat: Mapped[Decimal] = _money()


class Receipt(Base):
    """Money in (payment, installment, deposit) or out (refund). `total` is always positive."""

    __tablename__ = "receipts"
    __audited__ = True
    __table_args__ = (
        CheckConstraint(
            "kind IN ('payment','deposit','refund','installment')", name="ck_receipt_kind"
        ),
        CheckConstraint("total > 0", name="ck_receipt_total"),
        Index("ix_receipts_user_at", "received_by", "received_at"),
        Index("ix_receipts_patient", "patient_id", "received_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    receipt_no: Mapped[str] = mapped_column(String(30), unique=True)
    kind: Mapped[str] = mapped_column(String(12))
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), index=True)
    credit_note_id: Mapped[int | None] = mapped_column(ForeignKey("credit_notes.id"), index=True)
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("treatment_plans.id"))
    received_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    total: Mapped[Decimal] = mapped_column(MONEY)
    vat: Mapped[Decimal] = _money()  # VAT contained in the amount (for the cash box split)
    note: Mapped[str] = mapped_column(Text, default="", server_default="")


class ReceiptPayment(Base):
    __tablename__ = "receipt_payments"
    __table_args__ = (
        CheckConstraint(
            "method IN ('cash','mada','credit_card','bank_transfer','deposit')",
            name="ck_payment_method",
        ),
        CheckConstraint("amount > 0", name="ck_payment_amount"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    receipt_id: Mapped[int] = mapped_column(ForeignKey("receipts.id"), index=True)
    method: Mapped[str] = mapped_column(String(20))
    amount: Mapped[Decimal] = mapped_column(MONEY)
    vat: Mapped[Decimal] = _money()
    reference: Mapped[str] = mapped_column(String(100), default="", server_default="")


class ReceiptAllocation(Base):
    """Which invoices a payment receipt settles (one receipt can pay several invoices)."""

    __tablename__ = "receipt_allocations"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_allocation_amount"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    receipt_id: Mapped[int] = mapped_column(ForeignKey("receipts.id"), index=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(MONEY)


class CashClosing(Base):
    """A closed shift of one user's cash box (SPEC 10.9)."""

    __tablename__ = "cash_closings"
    __audited__ = True
    __table_args__ = (Index("ix_cash_closings_user", "user_id", "to_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    from_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    to_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    totals_json: Mapped[dict] = mapped_column(JSONB)
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    closed_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
