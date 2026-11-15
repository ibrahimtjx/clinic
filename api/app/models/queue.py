"""Patient queue: who is physically in the clinic today (SPEC 7, milestone M5)."""

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, VersionMixin


class QueueEntry(TimestampMixin, VersionMixin, Base):
    __tablename__ = "queue_entries"
    __audited__ = True
    __table_args__ = (
        UniqueConstraint("day", "queue_no", name="uq_queue_day_no"),
        Index("ix_queue_day_doctor", "day", "doctor_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    day: Mapped[date] = mapped_column(Date)  # clinic-local date
    queue_no: Mapped[int] = mapped_column(Integer)  # restarts at 1 each day
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id"))
    clinic_id: Mapped[int | None] = mapped_column(ForeignKey("clinics.id"))
    appointment_id: Mapped[int | None] = mapped_column(ForeignKey("appointments.id"), index=True)
    # Each step stamps server time and the user (SPEC 7.3).
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    called_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    called_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    entered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    entered_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    exited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    exited_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    postponed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    cancelled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )  # left without being seen
