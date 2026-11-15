from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AuditLog(Base):
    """Append-only (a trigger rejects UPDATE and DELETE). SPEC 3.4."""

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_record", "table_name", "record_id"),
        Index("ix_audit_log_at", "at"),
        Index("ix_audit_log_user_at", "user_id", "at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    machine: Mapped[str | None] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(String(64))
    table_name: Mapped[str] = mapped_column(String(60))
    record_id: Mapped[str | None] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(30))
    old_json: Mapped[dict | None] = mapped_column(JSONB)
    new_json: Mapped[dict | None] = mapped_column(JSONB)
