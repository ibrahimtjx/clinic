from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from app.db import Base

__all__ = ["Base", "SoftDeleteMixin", "TimestampMixin", "VersionMixin"]


class TimestampMixin:
    """Server-side timestamps only: clients never send record times (SPEC 2 Rules)."""

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @declared_attr
    def created_by(cls) -> Mapped[int | None]:
        return mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)

    @declared_attr
    def updated_by(cls) -> Mapped[int | None]:
        return mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)


class VersionMixin:
    """Optimistic locking (SPEC 3.6). SQLAlchemy bumps `version` on every UPDATE."""

    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)

    @declared_attr.directive
    def __mapper_args__(cls) -> dict:
        return {"version_id_col": cls.version}


class SoftDeleteMixin:
    """Records are never hard deleted (SPEC 3.4)."""

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @declared_attr
    def deleted_by(cls) -> Mapped[int | None]:
        return mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
