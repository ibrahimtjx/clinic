"""Server health written by the ops container on each server (SPEC 15.4)."""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SystemStatus(Base):
    """One row per server (primary and standby), updated every minute. Not audited: it is telemetry."""

    __tablename__ = "system_status"

    node: Mapped[str] = mapped_column(String(64), primary_key=True)
    role: Mapped[str] = mapped_column(String(10))  # primary | standby
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    disk_total: Mapped[int | None] = mapped_column(BigInteger)
    disk_free: Mapped[int | None] = mapped_column(BigInteger)
    backup_total: Mapped[int | None] = mapped_column(BigInteger)
    backup_free: Mapped[int | None] = mapped_column(BigInteger)
    last_wal_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_dump_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_dump_bytes: Mapped[int | None] = mapped_column(BigInteger)
    last_dump_file: Mapped[str | None] = mapped_column(String(200))
    last_basebackup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
