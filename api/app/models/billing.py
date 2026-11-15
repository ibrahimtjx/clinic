"""Treatment plans, quotations and payment orders (SPEC 9, 10.1–10.4, milestone M7)."""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, VersionMixin
from app.models.master import MasterMixin

MONEY = Numeric(12, 2)
PCT = Numeric(5, 2)


class InsuranceClass(MasterMixin, Base):
    """Coverage rules for one class of one insurance company (SPEC 10.4). Assumed rules; see pricing.py."""

    __tablename__ = "insurance_classes"
    __table_args__ = (
        CheckConstraint("patient_share_pct BETWEEN 0 AND 100", name="ck_ins_class_pct"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("insurance_companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    patient_share_pct: Mapped[Decimal] = mapped_column(
        PCT, default=Decimal(0), server_default="0"
    )
    max_patient_share_per_invoice: Mapped[Decimal | None] = mapped_column(MONEY)
    consultation_max_covered: Mapped[Decimal | None] = mapped_column(MONEY)
    daily_limit: Mapped[Decimal | None] = mapped_column(MONEY)
    excluded_service_ids: Mapped[list[int]] = mapped_column(
        ARRAY(BigInteger), default=list, server_default="{}"
    )


class TreatmentPlan(TimestampMixin, VersionMixin, SoftDeleteMixin, Base):
    __tablename__ = "treatment_plans"
    __audited__ = True
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','proposed','accepted','in_progress','completed','cancelled')",
            name="ck_plan_status",
        ),
        CheckConstraint("discount >= 0 AND discount <= total_price", name="ck_plan_discount"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id"))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft")
    total_price: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    discount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    accepted_option_id: Mapped[int | None] = mapped_column(BigInteger)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")

    options: Mapped[list["PlanOption"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="PlanOption.id"
    )
    sessions: Mapped[list["PlanSession"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="PlanSession.seq"
    )
    installments: Mapped[list["PlanInstallment"]] = relationship(
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="(PlanInstallment.due_date, PlanInstallment.id)",
    )


class PlanOption(Base):
    """An alternative for the patient to choose, e.g. fixed braces vs clear aligners (SPEC 9)."""

    __tablename__ = "treatment_plan_options"
    __audited__ = True

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    plan_id: Mapped[int] = mapped_column(
        ForeignKey("treatment_plans.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    price: Mapped[Decimal] = mapped_column(MONEY)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")


class PlanSession(Base):
    __tablename__ = "treatment_plan_sessions"
    __audited__ = True
    __table_args__ = (
        CheckConstraint("status IN ('planned','booked','done')", name="ck_session_status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    plan_id: Mapped[int] = mapped_column(
        ForeignKey("treatment_plans.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(SmallInteger)
    description: Mapped[str] = mapped_column(Text)
    service_id: Mapped[int | None] = mapped_column(ForeignKey("services.id"))
    teeth: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), default=list, server_default="{}")
    price_share: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    status: Mapped[str] = mapped_column(String(10), default="planned", server_default="planned")


class PlanInstallment(Base):
    __tablename__ = "treatment_plan_installments"
    __audited__ = True
    __table_args__ = (
        CheckConstraint(
            "amount > 0 AND paid_amount >= 0 AND paid_amount <= amount",
            name="ck_installment_amounts",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    plan_id: Mapped[int] = mapped_column(
        ForeignKey("treatment_plans.id", ondelete="CASCADE"), index=True
    )
    due_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    paid_amount: Mapped[Decimal] = mapped_column(
        MONEY, default=Decimal(0), server_default="0"
    )  # updated by payments (M8)


class _DocumentMixin(TimestampMixin, VersionMixin, SoftDeleteMixin):
    """Shared by quotations and payment orders. Totals are always recalculated by the server."""

    __audited__ = True

    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    doctor_id: Mapped[int | None] = mapped_column(ForeignKey("doctors.id"))
    clinic_id: Mapped[int | None] = mapped_column(ForeignKey("clinics.id"))
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("treatment_plans.id"))
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Insurance as used for this document (SPEC 10.3 insurance panel); null = cash.
    insurance: Mapped[dict | None] = mapped_column(JSONB)
    saudi: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    gross: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    discount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    net: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    vat: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    total: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    insurance_share: Mapped[Decimal] = mapped_column(
        MONEY, default=Decimal(0), server_default="0"
    )
    patient_share: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")


class Quotation(_DocumentMixin, Base):
    __tablename__ = "quotations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','sent','accepted','converted','expired','cancelled')",
            name="ck_quotation_status",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    quotation_no: Mapped[str] = mapped_column(String(30), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft")
    valid_until: Mapped[date | None] = mapped_column(Date)


class PaymentOrder(_DocumentMixin, Base):
    """Temporary invoice sent to reception for payment; paying it issues the final invoice (M8)."""

    __tablename__ = "payment_orders"
    __table_args__ = (
        CheckConstraint("status IN ('draft','sent','paid','cancelled')", name="ck_po_status"),
        Index("ix_po_status_sent", "status", "sent_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    order_no: Mapped[str] = mapped_column(String(30), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft")
    quotation_id: Mapped[int | None] = mapped_column(ForeignKey("quotations.id"))
    installment_id: Mapped[int | None] = mapped_column(ForeignKey("treatment_plan_installments.id"))
    reception_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class DraftLine(Base):
    """A line on a quotation or payment order (SPEC 14 draft_lines)."""

    __tablename__ = "draft_lines"
    __audited__ = True
    __table_args__ = (
        CheckConstraint("parent_type IN ('quotation','payment_order')", name="ck_draft_parent"),
        CheckConstraint("qty > 0 AND price >= 0", name="ck_draft_amounts"),
        Index("ix_draft_lines_parent", "parent_type", "parent_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    parent_type: Mapped[str] = mapped_column(String(20))
    parent_id: Mapped[int] = mapped_column(BigInteger)
    seq: Mapped[int] = mapped_column(Integer)
    service_id: Mapped[int | None] = mapped_column(ForeignKey("services.id"))
    description_ar: Mapped[str] = mapped_column(Text)
    description_en: Mapped[str] = mapped_column(Text, default="", server_default="")
    price: Mapped[Decimal] = mapped_column(MONEY)
    qty: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal(1), server_default="1")
    discount_amount: Mapped[Decimal] = mapped_column(
        MONEY, default=Decimal(0), server_default="0"
    )
    discount_pct: Mapped[Decimal] = mapped_column(PCT, default=Decimal(0), server_default="0")
    gross: Mapped[Decimal] = mapped_column(MONEY)
    discount: Mapped[Decimal] = mapped_column(MONEY)
    net: Mapped[Decimal] = mapped_column(MONEY)
    vat_rate: Mapped[Decimal] = mapped_column(PCT)
    vat_amount: Mapped[Decimal] = mapped_column(MONEY)
    line_total: Mapped[Decimal] = mapped_column(MONEY)
    patient_share: Mapped[Decimal] = mapped_column(MONEY)
    insurance_share: Mapped[Decimal] = mapped_column(MONEY)
    teeth: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), default=list, server_default="{}")
    price_overridden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
