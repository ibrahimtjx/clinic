"""Dental record (SPEC 8, milestone M6)."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, VersionMixin

FINDING_CATEGORIES = (
    "restoration",
    "extraction",
    "endodontic",
    "prosthetic",
    "orthodontic",
    "other",
)


class DentalVisit(TimestampMixin, VersionMixin, SoftDeleteMixin, Base):
    __tablename__ = "dental_visits"
    __audited__ = True
    __table_args__ = (
        Index("ix_dental_visits_patient_at", "patient_id", "visit_at"),
        # Teeth are FDI numbers; a GIN index lets "visits on tooth 36" use the index.
        Index("ix_dental_visits_teeth", "teeth", postgresql_using="gin"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id"))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    appointment_id: Mapped[int | None] = mapped_column(ForeignKey("appointments.id"))
    visit_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    teeth: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), default=list, server_default="{}")
    chief_complaint: Mapped[str] = mapped_column(Text, default="", server_default="")
    diagnosis: Mapped[str] = mapped_column(Text, default="", server_default="")
    icd10: Mapped[str | None] = mapped_column(String(10))
    procedure: Mapped[str] = mapped_column(Text, default="", server_default="")
    treatment_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    preventive_advice: Mapped[str] = mapped_column(Text, default="", server_default="")
    complications: Mapped[str] = mapped_column(Text, default="", server_default="")
    patient_education: Mapped[str] = mapped_column(Text, default="", server_default="")
    next_visit: Mapped[str] = mapped_column(Text, default="", server_default="")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")


class DentalVisitAddendum(Base):
    """Changes after the edit window are added, never overwritten (SPEC 8.4)."""

    __tablename__ = "dental_visit_addenda"
    __audited__ = True

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("dental_visits.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ToothFinding(TimestampMixin, SoftDeleteMixin, Base):
    """A marker on the chart: what was done or found on a tooth (SPEC 8.2)."""

    __tablename__ = "tooth_findings"
    __audited__ = True
    __table_args__ = (
        CheckConstraint(
            "category IN ('restoration','extraction','endodontic','prosthetic','orthodontic','other')",
            name="ck_finding_category",
        ),
        CheckConstraint(
            "(tooth_fdi BETWEEN 11 AND 48 AND mod(tooth_fdi, 10) BETWEEN 1 AND 8) OR (tooth_fdi BETWEEN 51 AND 85 AND mod(tooth_fdi, 10) BETWEEN 1 AND 5)",
            name="ck_finding_tooth",
        ),
        Index("ix_findings_patient_tooth", "patient_id", "tooth_fdi"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    tooth_fdi: Mapped[int] = mapped_column(SmallInteger)
    category: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    visit_id: Mapped[int | None] = mapped_column(ForeignKey("dental_visits.id"))
