import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, VersionMixin


class Role(TimestampMixin, VersionMixin, Base):
    __tablename__ = "roles"
    __audited__ = True

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    key: Mapped[str] = mapped_column(String(50), unique=True)
    name_ar: Mapped[str] = mapped_column(String(100))
    name_en: Mapped[str] = mapped_column(String(100))
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    permissions: Mapped[list["RolePermission"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="RolePermission.permission"
    )

    @property
    def permission_keys(self) -> list[str]:
        return [p.permission for p in self.permissions]


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __audited__ = True

    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission: Mapped[str] = mapped_column(String(80), primary_key=True)


class UserRole(Base):
    __tablename__ = "user_roles"
    __audited__ = True

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="RESTRICT"), primary_key=True
    )


class User(TimestampMixin, VersionMixin, SoftDeleteMixin, Base):
    __tablename__ = "users"
    # Declared here so migration autogenerate keeps it (created in migration 0002).
    __table_args__ = (Index("ux_users_username_lower", text("lower(username)"), unique=True),)
    __audited__ = True
    __audit_masked__ = frozenset({"password_hash", "pin_hash"})
    # Sign-in counters and UI preferences change often; sign-in events are logged explicitly instead.
    __audit_skip__ = frozenset({"failed_logins", "locked_until", "preferences"})

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str] = mapped_column(String(50))  # unique on lower(username), see migration
    password_hash: Mapped[str] = mapped_column(String(100))
    pin_hash: Mapped[str | None] = mapped_column(String(100), nullable=True)
    full_name_ar: Mapped[str] = mapped_column(String(150))
    full_name_en: Mapped[str] = mapped_column(String(150), default="", server_default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    failed_logins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    preferences: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))

    roles: Mapped[list[Role]] = relationship(
        secondary="user_roles", lazy="selectin", order_by=Role.id, viewonly=True
    )

    @property
    def has_pin(self) -> bool:
        return self.pin_hash is not None

    @property
    def display_name(self) -> str:
        return self.full_name_ar or self.username


class AuthSession(Base):
    """One signed-in session (one refresh token). Revoked on lock, sign out, password reset."""

    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64))
    method: Mapped[str] = mapped_column(String(20))  # password | pin
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(40))
    machine: Mapped[str | None] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(Text)
