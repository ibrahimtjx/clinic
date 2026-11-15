"""Patients (SPEC 5, milestone M3)."""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    Sequence,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, VersionMixin
from app.models.master import MasterMixin

FILE_NO_SEQ = Sequence("patient_file_no_seq", start=1)

# SQL function clinic_normalize() (migration 0004): strips Arabic diacritics and tatweel, unifies
# alef forms, ta marbuta → ha, alef maqsura → ya, Arabic-Indic digits → Western, lower case.
SEARCH_TEXT = "clinic_normalize(coalesce(name_ar, '') || ' ' || coalesce(name_en, ''))"
SEARCH_DIGITS = (
    "file_no::text || ' ' || coalesce(secondary_file_no, '') || ' ' || coalesce(mobile, '') || ' ' || "
    "coalesce(phone, '') || ' ' || coalesce(emergency_phone, '') || ' ' || coalesce(national_id, '')"
)


class InsuranceCompany(MasterMixin, Base):
    """Insurance companies. Classes and coverage rules arrive with quotations (M7)."""

    __tablename__ = "insurance_companies"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name_ar: Mapped[str] = mapped_column(String(200))
    name_en: Mapped[str] = mapped_column(String(200))


class Patient(TimestampMixin, VersionMixin, SoftDeleteMixin, Base):
    __tablename__ = "patients"
    __audited__ = True
    __table_args__ = (
        CheckConstraint("gender IN ('male', 'female')", name="ck_patients_gender"),
        CheckConstraint(
            r"national_id IS NULL OR national_id ~ '^\d{10}$'", name="ck_patients_national_id"
        ),
        CheckConstraint(r"mobile IS NULL OR mobile ~ '^05\d{8}$'", name="ck_patients_mobile"),
        Index(
            "ix_patients_search_text",
            "search_text",
            postgresql_using="gin",
            postgresql_ops={"search_text": "gin_trgm_ops"},
        ),
        Index(
            "ix_patients_search_digits",
            "search_digits",
            postgresql_using="gin",
            postgresql_ops={"search_digits": "gin_trgm_ops"},
        ),
        Index("ix_patients_national_id", "national_id"),
        Index("ix_patients_mobile", "mobile"),
        Index("ix_patients_created_at", "created_at"),
        Index("ix_patients_default_doctor", "default_doctor_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # Sequential and never reused (a sequence never hands out the same value twice).
    file_no: Mapped[int] = mapped_column(
        BigInteger, FILE_NO_SEQ, server_default=FILE_NO_SEQ.next_value(), unique=True
    )
    secondary_file_no: Mapped[str | None] = mapped_column(String(30))
    name_ar: Mapped[str] = mapped_column(String(200))
    name_en: Mapped[str] = mapped_column(String(200), default="", server_default="")
    national_id: Mapped[str | None] = mapped_column(String(10))
    nationality: Mapped[str | None] = mapped_column(String(2))  # ISO 3166-1 alpha-2
    gender: Mapped[str | None] = mapped_column(String(6))
    dob: Mapped[date | None] = mapped_column(Date)
    mobile: Mapped[str | None] = mapped_column(String(10))
    phone: Mapped[str | None] = mapped_column(String(20))
    emergency_name: Mapped[str | None] = mapped_column(String(200))
    emergency_phone: Mapped[str | None] = mapped_column(String(20))
    default_doctor_id: Mapped[int | None] = mapped_column(ForeignKey("doctors.id"))
    is_external: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    sms_opt_out: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Shown as warning badges on the header card.
    chronic_diseases: Mapped[str] = mapped_column(Text, default="", server_default="")
    allergies: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Medical file: read only through the logged /health endpoint (SPEC 3.4).
    medications: Mapped[str] = mapped_column(Text, default="", server_default="")
    medical_history: Mapped[str] = mapped_column(Text, default="", server_default="")
    referral_source: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Maintained by billing (M8) and visits (M4–M6); read-only here.
    balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal(0), server_default="0")
    last_visit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    search_text: Mapped[str] = mapped_column(Text, Computed(SEARCH_TEXT, persisted=True))
    search_digits: Mapped[str] = mapped_column(Text, Computed(SEARCH_DIGITS, persisted=True))

    insurance: Mapped["PatientInsurance | None"] = relationship(
        back_populates="patient", uselist=False, lazy="selectin", cascade="all, delete-orphan"
    )


class PatientInsurance(TimestampMixin, VersionMixin, Base):
    """The patient's current insurance (one row per patient; changes are kept in the audit log)."""

    __tablename__ = "patient_insurance"
    __audited__ = True

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        ForeignKey("patients.id", ondelete="CASCADE"), unique=True
    )
    company_id: Mapped[int] = mapped_column(ForeignKey("insurance_companies.id"), index=True)
    policy_no: Mapped[str] = mapped_column(String(60), default="", server_default="")
    class_name: Mapped[str] = mapped_column(String(60), default="", server_default="")
    membership_no: Mapped[str] = mapped_column(String(60), default="", server_default="")
    expiry: Mapped[date | None] = mapped_column(Date)

    patient: Mapped[Patient] = relationship(back_populates="insurance")


class PatientAssignment(Base):
    """A patient handed to a staff member with a note, e.g. "call to reschedule" (SPEC 5.4)."""

    __tablename__ = "patient_assignments"
    __audited__ = True
    __table_args__ = (
        Index("ix_assignments_open", "assigned_to", postgresql_where=text("done_at IS NULL")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    assigned_to: Mapped[int] = mapped_column(ForeignKey("users.id"))
    assigned_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    done_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
