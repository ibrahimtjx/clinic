"""Appointments and the waiting list (SPEC 6, milestone M4)."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, VersionMixin


class Appointment(TimestampMixin, VersionMixin, SoftDeleteMixin, Base):
    __tablename__ = "appointments"
    __audited__ = True
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="ck_appointments_times"),
        # Two slot-blocking appointments for the same doctor can never overlap (SPEC 3.6). The
        # database enforces it, so two receptionists booking at the same moment cannot both win.
        # blocks_slot is copied from the status on every status change, because an exclusion
        # constraint cannot read the statuses table.
        ExcludeConstraint(
            ("doctor_id", "="),
            (text("tstzrange(starts_at, ends_at)"), "&&"),
            name="ex_appointments_doctor_overlap",
            using="gist",
            where=text("blocks_slot AND deleted_at IS NULL"),
        ),
        Index("ix_appointments_doctor_start", "doctor_id", "starts_at"),
        Index("ix_appointments_patient_start", "patient_id", "starts_at"),
        Index("ix_appointments_start", "starts_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id"))
    clinic_id: Mapped[int | None] = mapped_column(ForeignKey("clinics.id"))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status_id: Mapped[int] = mapped_column(ForeignKey("appointment_statuses.id"))
    blocks_slot: Mapped[bool] = mapped_column(Boolean)
    visit_type_id: Mapped[int | None] = mapped_column(ForeignKey("visit_types.id"))
    service_id: Mapped[int | None] = mapped_column(ForeignKey("services.id"))
    plan_session_id: Mapped[int | None] = mapped_column(
        BigInteger
    )  # FK added with treatment plans (M7)
    # The patient has this appointment but would take an earlier one (SPEC 6.3, 6.6).
    is_waiting_list: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    exclude_sms: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    confirmed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[str | None] = mapped_column(Text)


class WaitingListEntry(TimestampMixin, VersionMixin, Base):
    """A patient who wants a slot (or an earlier one) with a doctor, at preferred times (SPEC 6.6)."""

    __tablename__ = "waiting_list"
    __audited__ = True
    __table_args__ = (
        Index("ix_waiting_list_open", "doctor_id", postgresql_where=text("resolved_at IS NULL")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    doctor_id: Mapped[int | None] = mapped_column(ForeignKey("doctors.id"))  # NULL = any doctor
    appointment_id: Mapped[int | None] = mapped_column(
        ForeignKey("appointments.id")
    )  # current booking, if any
    preferred_days: Mapped[str] = mapped_column(
        String(20), default="", server_default=""
    )  # e.g. "0,1,2"
    preferred_from: Mapped[str | None] = mapped_column(String(5))  # "HH:MM"
    preferred_to: Mapped[str | None] = mapped_column(String(5))
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
