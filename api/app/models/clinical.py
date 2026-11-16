"""Phase 2 (milestone M12): patient images and documents (SPEC 8.5); prescriptions, lab requests and
results, medical reports (SPEC 8.6)."""

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, VersionMixin
from app.models.master import MasterMixin

FILE_KINDS = (
    "xray",
    "panoramic",
    "ceph",
    "cbct",
    "intraoral",
    "extraoral",
    "document",
    "consent",
    "lab_result",
    "referral",
    "id_card",
    "insurance_card",
    "other",
)


class PatientFile(TimestampMixin, VersionMixin, SoftDeleteMixin, Base):
    """An image or document. The bytes live on the server disk (CLINIC_FILES_DIR), never in the
    database (SPEC 8.5); a soft-deleted file stays on disk and in backups."""

    __tablename__ = "patient_files"
    __audited__ = True
    __table_args__ = (
        CheckConstraint(
            "kind IN (" + ",".join(f"'{k}'" for k in FILE_KINDS) + ")", name="ck_file_kind"
        ),
        Index("ix_patient_files_patient", "patient_id", "taken_on"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    visit_id: Mapped[int | None] = mapped_column(ForeignKey("dental_visits.id"), index=True)
    tooth_fdi: Mapped[int | None] = mapped_column(SmallInteger)
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(200), default="", server_default="")
    taken_on: Mapped[date] = mapped_column(Date)
    path: Mapped[str] = mapped_column(String(300), unique=True)  # relative to CLINIC_FILES_DIR
    original_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    has_thumb: Mapped[bool] = mapped_column(default=False, server_default="false")


class Medication(MasterMixin, Base):
    """Quick-pick list for prescriptions; doctors can still type any drug."""

    __tablename__ = "medications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(
        String(200)
    )  # generic name and strength, e.g. "Amoxicillin 500 mg"
    form: Mapped[str] = mapped_column(String(60), default="", server_default="")
    dose: Mapped[str] = mapped_column(String(100), default="", server_default="")
    frequency: Mapped[str] = mapped_column(String(100), default="", server_default="")
    duration: Mapped[str] = mapped_column(String(100), default="", server_default="")
    instructions: Mapped[str] = mapped_column(String(300), default="", server_default="")


class LabTest(MasterMixin, Base):
    __tablename__ = "lab_tests"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(30), default="", server_default="")
    name_ar: Mapped[str] = mapped_column(String(200))
    name_en: Mapped[str] = mapped_column(String(200))
    unit: Mapped[str] = mapped_column(String(40), default="", server_default="")
    reference_range: Mapped[str] = mapped_column(String(100), default="", server_default="")


class _ClinicalDoc(TimestampMixin, VersionMixin, SoftDeleteMixin):
    """Shared by prescriptions, lab requests and medical reports. Editable by its doctor within the
    dental edit window (dental.edit_hours); after that only cancelling with a reason."""

    __audited__ = True

    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id"))
    visit_id: Mapped[int | None] = mapped_column(ForeignKey("dental_visits.id"))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(12), default="active", server_default="active")
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")


class Prescription(_ClinicalDoc, Base):
    __tablename__ = "prescriptions"
    __table_args__ = (CheckConstraint("status IN ('active','cancelled')", name="ck_rx_status"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    diagnosis: Mapped[str] = mapped_column(Text, default="", server_default="")
    items: Mapped[list["PrescriptionItem"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="PrescriptionItem.seq"
    )


class PrescriptionItem(Base):
    __tablename__ = "prescription_items"
    __audited__ = True

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    prescription_id: Mapped[int] = mapped_column(
        ForeignKey("prescriptions.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(SmallInteger)
    drug: Mapped[str] = mapped_column(String(200))
    form: Mapped[str] = mapped_column(String(60), default="", server_default="")
    dose: Mapped[str] = mapped_column(String(100), default="", server_default="")
    frequency: Mapped[str] = mapped_column(String(100), default="", server_default="")
    duration: Mapped[str] = mapped_column(String(100), default="", server_default="")
    quantity: Mapped[str] = mapped_column(String(60), default="", server_default="")
    instructions: Mapped[str] = mapped_column(String(300), default="", server_default="")


class LabRequest(_ClinicalDoc, Base):
    __tablename__ = "lab_requests"
    __table_args__ = (
        CheckConstraint("status IN ('active','resulted','cancelled')", name="ck_lab_status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    lab_name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    clinical_info: Mapped[str] = mapped_column(Text, default="", server_default="")
    resulted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resulted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    result_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    items: Mapped[list["LabRequestItem"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="LabRequestItem.seq"
    )


class LabRequestItem(Base):
    __tablename__ = "lab_request_items"
    __audited__ = True
    __table_args__ = (
        CheckConstraint(
            "flag IS NULL OR flag IN ('normal','low','high','abnormal')", name="ck_lab_flag"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("lab_requests.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(SmallInteger)
    test_id: Mapped[int | None] = mapped_column(ForeignKey("lab_tests.id"))
    name: Mapped[str] = mapped_column(String(200))
    unit: Mapped[str] = mapped_column(String(40), default="", server_default="")
    reference_range: Mapped[str] = mapped_column(String(100), default="", server_default="")
    result: Mapped[str] = mapped_column(String(200), default="", server_default="")
    flag: Mapped[str | None] = mapped_column(String(10))


class MedicalReport(_ClinicalDoc, Base):
    __tablename__ = "medical_reports"
    __table_args__ = (
        CheckConstraint("status IN ('active','cancelled')", name="ck_report_status"),
        CheckConstraint("kind IN ('report','referral','attendance')", name="ck_report_kind"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(String(12), default="report", server_default="report")
    language: Mapped[str] = mapped_column(String(2), default="ar", server_default="ar")
    recipient: Mapped[str] = mapped_column(String(200), default="", server_default="")
    title: Mapped[str] = mapped_column(String(200), default="", server_default="")
    body: Mapped[str] = mapped_column(Text)
