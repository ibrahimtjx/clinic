"""Request dependencies: DB session, current user, permission checks."""

import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import AuditContext, set_audit_context
from app.db import get_db
from app.models import AuthSession, User
from app.permissions import ADMIN_ROLE, PERMISSION_KEYS
from app.security import decode_access_token

DbSession = Annotated[Session, Depends(get_db)]

_MACHINE_RE = re.compile(r"[^\w .\-]", re.UNICODE)


def client_machine(request: Request) -> str | None:
    """Client PC name from the X-Client-Machine header (set by the desktop app or per browser)."""
    raw = request.headers.get("x-client-machine")
    return _MACHINE_RE.sub("", raw)[:64] or None if raw else None


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def set_anonymous_context(request: Request, db: DbSession) -> None:
    set_audit_context(
        db, AuditContext(user_id=None, machine=client_machine(request), ip=client_ip(request))
    )


@dataclass
class Principal:
    user: User
    session_id: uuid.UUID
    permissions: frozenset[str]

    @property
    def is_admin(self) -> bool:
        return any(r.key == ADMIN_ROLE for r in self.user.roles)

    def can(self, perm: str) -> bool:
        return perm in self.permissions


def permissions_of(user: User) -> frozenset[str]:
    if any(r.key == ADMIN_ROLE for r in user.roles):
        return PERMISSION_KEYS
    return frozenset(p for r in user.roles for p in r.permission_keys) & PERMISSION_KEYS


def _unauthorized(code: str) -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED, detail={"code": code}, headers={"WWW-Authenticate": "Bearer"}
    )


def _principal(
    request: Request,
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
    allow_password_change_pending: bool = False,
) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauthorized("not_authenticated")
    try:
        payload = decode_access_token(authorization[7:])
    except jwt.ExpiredSignatureError:
        raise _unauthorized("token_expired") from None
    except jwt.InvalidTokenError:
        raise _unauthorized("invalid_token") from None

    # Checked on every request so lock, sign-out, deactivation and resets take effect at once.
    session = db.execute(
        select(AuthSession).where(
            AuthSession.id == uuid.UUID(payload["sid"]),
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > func.now(),
        )
    ).scalar_one_or_none()
    if session is None or str(session.user_id) != payload["sub"]:
        raise _unauthorized("session_ended")
    user = db.get(User, session.user_id)
    if user is None or not user.is_active or user.deleted_at is not None:
        raise _unauthorized("session_ended")

    set_audit_context(
        db, AuditContext(user_id=user.id, machine=client_machine(request), ip=client_ip(request))
    )

    if user.must_change_password and not allow_password_change_pending:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "password_change_required"})
    return Principal(user=user, session_id=session.id, permissions=permissions_of(user))


def current_principal(
    request: Request, db: DbSession, authorization: Annotated[str | None, Header()] = None
) -> Principal:
    return _principal(request, db, authorization)


def current_principal_allow_pending(
    request: Request, db: DbSession, authorization: Annotated[str | None, Header()] = None
) -> Principal:
    """For /auth/me and changing the password while a forced reset is pending."""
    return _principal(request, db, authorization, allow_password_change_pending=True)


CurrentUser = Annotated[Principal, Depends(current_principal)]
CurrentUserPending = Annotated[Principal, Depends(current_principal_allow_pending)]


def require(*perms: str) -> Callable[..., Principal]:
    """Dependency: the signed-in user must hold every listed permission."""
    unknown = set(perms) - PERMISSION_KEYS
    if unknown:
        raise ValueError(f"Unknown permissions: {unknown}")

    def dep(principal: CurrentUser) -> Principal:
        missing = [p for p in perms if not principal.can(p)]
        if missing:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "missing": missing}
            )
        return principal

    return dep


def check_version(
    record_version: int, client_version: int, updated_by_name: str | None, updated_at
) -> None:
    """Optimistic locking (SPEC 3.6): a stale save says who changed the record."""
    if record_version != client_version:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "stale_record",
                "current_version": record_version,
                "updated_by": updated_by_name,
                "updated_at": updated_at.isoformat() if updated_at else None,
            },
        )
