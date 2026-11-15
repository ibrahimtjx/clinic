"""Settings and master data (SPEC 12, milestone M2)."""

from datetime import time
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, VersionMixin

MONEY = Numeric(12, 2)


class MasterMixin(TimestampMixin, VersionMixin, SoftDeleteMixin):
    """Editable list entry: deactivated rather than removed; deleting is a soft delete."""

    __audited__ = True

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Clinic(MasterMixin, Base):
    __tablename__ = "clinics"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(150))
    name_en: Mapped[str] = mapped_column(String(150))


class Department(MasterMixin, Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    clinic_id: Mapped[int | None] = mapped_column(ForeignKey("clinics.id"))
    name_ar: Mapped[str] = mapped_column(String(150))
    name_en: Mapped[str] = mapped_column(String(150))


class Doctor(MasterMixin, Base):
    __tablename__ = "doctors"
    __table_args__ = (CheckConstraint("slot_minutes BETWEEN 5 AND 240", name="ck_doctors_slot"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), unique=True)
    name_ar: Mapped[str] = mapped_column(String(150))
    name_en: Mapped[str] = mapped_column(String(150), default="", server_default="")
    specialty_ar: Mapped[str] = mapped_column(String(150), default="", server_default="")
    specialty_en: Mapped[str] = mapped_column(String(150), default="", server_default="")
    clinic_id: Mapped[int | None] = mapped_column(ForeignKey("clinics.id"))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    color: Mapped[str] = mapped_column(String(20), default="blue", server_default="blue")
    slot_minutes: Mapped[int] = mapped_column(SmallInteger, default=15, server_default="15")

    schedules: Mapped[list["DoctorSchedule"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="(DoctorSchedule.weekday, DoctorSchedule.start_time)"
    )
    commission_rules: Mapped[list["DoctorCommissionRule"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="DoctorCommissionRule.id"
    )


class DoctorSchedule(Base):
    """Weekly working periods and breaks. weekday: 0 = Sunday … 6 = Saturday."""

    __tablename__ = "doctor_schedules"
    __audited__ = True
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_doctor_schedules_weekday"),
        CheckConstraint("end_time > start_time", name="ck_doctor_schedules_times"),
        CheckConstraint("kind IN ('work', 'break')", name="ck_doctor_schedules_kind"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id", ondelete="CASCADE"), index=True)
    weekday: Mapped[int] = mapped_column(SmallInteger)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    kind: Mapped[str] = mapped_column(String(10), default="work", server_default="work")


class DoctorCommissionRule(Base):
    """Percent of net collected revenue (SPEC 10.8). Most specific rule wins: service, then
    department, then the doctor's default (both NULL)."""

    __tablename__ = "doctor_commission_rules"
    __audited__ = True
    __table_args__ = (
        CheckConstraint("percent >= 0 AND percent <= 100", name="ck_commission_percent"),
        CheckConstraint("NOT (department_id IS NOT NULL AND service_id IS NOT NULL)", name="ck_commission_scope"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id", ondelete="CASCADE"), index=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    service_id: Mapped[int | None] = mapped_column(ForeignKey("services.id"))
    percent: Mapped[Decimal] = mapped_column(Numeric(5, 2))


class Service(MasterMixin, Base):
    __tablename__ = "services"
    __table_args__ = (
        CheckConstraint("min_price >= 0 AND cost_price >= 0", name="ck_services_nonneg"),
        CheckConstraint("min_price <= sale_price AND sale_price <= max_price", name="ck_services_price_range"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    number: Mapped[int] = mapped_column(Integer, unique=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name_ar: Mapped[str] = mapped_column(String(200))
    name_en: Mapped[str] = mapped_column(String(200))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    sale_price: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    min_price: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    max_price: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    cost_price: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0), server_default="0")
    vat_applicable: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Consultation lines follow the insurance class's consultation limit (SPEC 10.4).
    is_consultation: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class AppointmentStatus(MasterMixin, Base):
    """`key` identifies statuses the system acts on (e.g. arrived, cancelled); custom ones have their own key.
    `blocks_slot` is copied onto each appointment on every status change (SPEC 14)."""

    __tablename__ = "appointment_statuses"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    key: Mapped[str] = mapped_column(String(40), unique=True)
    name_ar: Mapped[str] = mapped_column(String(100))
    name_en: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(20))
    blocks_slot: Mapped[bool] = mapped_column(Boolean)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class VisitType(MasterMixin, Base):
    __tablename__ = "visit_types"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(100))
    name_en: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(20), default="neutral", server_default="neutral")


class SavedPhrase(MasterMixin, Base):
    __tablename__ = "saved_phrases"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    field_key: Mapped[str] = mapped_column(String(40), index=True)
    text: Mapped[str] = mapped_column(Text)


class NumberSequence(Base):
    """Gapless document numbers (SPEC 10.2). Rows are locked with SELECT … FOR UPDATE inside the
    transaction that issues the document, so a rollback also returns the number."""

    __tablename__ = "number_sequences"
    __table_args__ = (UniqueConstraint("doc_type", "year"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    doc_type: Mapped[str] = mapped_column(String(20))
    year: Mapped[int] = mapped_column(SmallInteger)  # 0 when numbering does not reset yearly
    next_value: Mapped[int] = mapped_column(BigInteger, default=1, server_default="1")
