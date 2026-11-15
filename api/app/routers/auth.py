"""Sign-in, quick switch, lock and session endpoints (SPEC 3.3)."""

import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.audit import AuditContext, log_event, set_audit_context
from app.config import get_settings
from app.deps import (
    CurrentUserPending,
    DbSession,
    client_ip,
    client_machine,
    permissions_of,
    set_anonymous_context,
)
from app.models import AuthSession, User
from app.schemas import (
    ChangePasswordIn,
    LoginIn,
    MeOut,
    PinLoginIn,
    Preferences,
    RoleRef,
    SetPinIn,
    TokenOut,
)
from app.security import (
    PolicyError,
    check_password_policy,
    check_pin_policy,
    constant_eq,
    create_access_token,
    hash_secret,
    new_refresh_secret,
    sha256,
    verify_secret,
)
from app.services.settings import get_security

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(set_anonymous_context)])

COOKIE = "clinic_refresh"


def policy_error(e: PolicyError) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": e.code})


def build_me(db: Session, user: User) -> MeOut:
    return MeOut(
        id=user.id,
        username=user.username,
        full_name_ar=user.full_name_ar,
        full_name_en=user.full_name_en,
        roles=[RoleRef.model_validate(r) for r in user.roles],
        permissions=sorted(permissions_of(user)),
        has_pin=user.pin_hash is not None,
        must_change_password=user.must_change_password,
        preferences=Preferences(**(user.preferences or {})),
        security=get_security(db),
    )


def _set_cookie(response: Response, session_id: uuid.UUID, secret: str) -> None:
    response.set_cookie(
        COOKIE,
        f"{session_id}.{secret}",
        max_age=settings.refresh_token_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path=settings.cookie_path,
    )


def _clear_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE, path=settings.cookie_path, secure=settings.cookie_secure, httponly=True, samesite="strict")


def _authenticate(db: Session, request: Request, username: str, secret: str, method: str) -> User:
    """Shared by password and PIN sign-in. Failed attempts of either kind count toward lockout."""
    sec = get_security(db)
    now = db.scalar(select(func.now()))
    user = db.execute(
        select(User)
        .where(func.lower(User.username) == username.strip().lower(), User.deleted_at.is_(None))
        .with_for_update()
    ).scalar_one_or_none()

    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "invalid_credentials"})
    if user is None:
        verify_secret(secret, None)  # similar timing for unknown usernames
        log_event(db, "login_failed", "users", None, new={"username": username[:50], "method": method})
        db.commit()
        raise invalid

    if user.locked_until and user.locked_until > now:
        log_event(db, "login_blocked", "users", user.id, new={"method": method}, user_id=user.id)
        db.commit()
        raise HTTPException(
            status.HTTP_423_LOCKED, detail={"code": "account_locked", "until": user.locked_until.isoformat()}
        )

    hashed = user.password_hash if method == "password" else user.pin_hash
    if method == "pin" and hashed is None:
        verify_secret(secret, None)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "pin_not_set"})

    if not user.is_active or not verify_secret(secret, hashed):
        user.failed_logins += 1
        locked = user.failed_logins >= sec.lockout_attempts
        if locked:
            user.locked_until = now + timedelta(minutes=sec.lockout_minutes)
            user.failed_logins = 0
        log_event(db, "login_failed", "users", user.id, new={"method": method, "locked": locked}, user_id=user.id)
        db.commit()
        if locked:
            raise HTTPException(
                status.HTTP_423_LOCKED, detail={"code": "account_locked", "until": user.locked_until.isoformat()}
            )
        raise invalid

    user.failed_logins = 0
    user.locked_until = None
    return user


def _start_session(db: Session, request: Request, response: Response, user: User, method: str) -> TokenOut:
    secret, token_hash = new_refresh_secret()
    s = AuthSession(
        id=uuid.uuid4(),
        user_id=user.id,
        token_hash=token_hash,
        method=method,
        expires_at=db.scalar(select(func.now())) + timedelta(hours=settings.refresh_token_hours),
        machine=client_machine(request),
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300],
    )
    db.add(s)
    set_audit_context(db, AuditContext(user_id=user.id, machine=s.machine, ip=s.ip))
    log_event(db, "login", "auth_sessions", s.id, new={"method": method})
    db.commit()
    _set_cookie(response, s.id, secret)
    token, ttl = create_access_token(user.id, s.id, user.must_change_password)
    return TokenOut(access_token=token, expires_in=ttl, user=build_me(db, user))


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, response: Response, db: DbSession) -> TokenOut:
    user = _authenticate(db, request, body.username, body.password, "password")
    return _start_session(db, request, response, user, "password")


@router.post("/pin-login", response_model=TokenOut)
def pin_login(body: PinLoginIn, request: Request, response: Response, db: DbSession) -> TokenOut:
    """Unlock or quick-switch user with a PIN (SPEC 3.3)."""
    user = _authenticate(db, request, body.username, body.pin, "pin")
    return _start_session(db, request, response, user, "pin")


def _session_from_cookie(db: Session, cookie: str | None) -> AuthSession | None:
    if not cookie or "." not in cookie:
        return None
    sid, secret = cookie.split(".", 1)
    try:
        sid_uuid = uuid.UUID(sid)
    except ValueError:
        return None
    s = db.execute(
        select(AuthSession).where(
            AuthSession.id == sid_uuid, AuthSession.revoked_at.is_(None), AuthSession.expires_at > func.now()
        )
    ).scalar_one_or_none()
    if s is None or not constant_eq(s.token_hash, sha256(secret)):
        return None
    return s


@router.post("/refresh", response_model=TokenOut)
def refresh(
    response: Response, db: DbSession, clinic_refresh: Annotated[str | None, Cookie()] = None
) -> TokenOut:
    """New access token from the refresh cookie. The session ends at most 12 hours after sign-in."""
    s = _session_from_cookie(db, clinic_refresh)
    user = db.get(User, s.user_id) if s else None
    if s is None or user is None or not user.is_active or user.deleted_at is not None:
        _clear_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "session_ended"})
    s.last_used_at = func.now()
    db.commit()
    token, ttl = create_access_token(user.id, s.id, user.must_change_password)
    return TokenOut(access_token=token, expires_in=ttl, user=build_me(db, user))


def _end_session(db: Session, request: Request, response: Response, cookie: str | None, reason: str) -> None:
    s = _session_from_cookie(db, cookie)
    if s is not None:
        s.revoked_at = func.now()
        s.revoked_reason = reason
        set_audit_context(db, AuditContext(user_id=s.user_id, machine=client_machine(request), ip=client_ip(request)))
        log_event(db, reason, "auth_sessions", s.id)
        db.commit()
    _clear_cookie(response)


@router.post("/logout", status_code=204)
def logout(
    request: Request, response: Response, db: DbSession, clinic_refresh: Annotated[str | None, Cookie()] = None
) -> None:
    _end_session(db, request, response, clinic_refresh, "logout")


@router.post("/lock", status_code=204)
def lock(
    request: Request, response: Response, db: DbSession, clinic_refresh: Annotated[str | None, Cookie()] = None
) -> None:
    """Screen lock: ends the session on the server. Unlocking needs the PIN or password again."""
    _end_session(db, request, response, clinic_refresh, "lock")


@router.get("/me", response_model=MeOut)
def me(principal: CurrentUserPending, db: DbSession) -> MeOut:
    return build_me(db, principal.user)


@router.patch("/me/preferences", response_model=MeOut)
def update_preferences(body: Preferences, principal: CurrentUserPending, db: DbSession) -> MeOut:
    user = principal.user
    user.preferences = {**(user.preferences or {}), **body.model_dump(exclude_none=True)}
    db.commit()
    return build_me(db, user)


@router.post("/me/password", response_model=TokenOut)
def change_password(
    body: ChangePasswordIn, request: Request, response: Response, principal: CurrentUserPending, db: DbSession
) -> TokenOut:
    user = principal.user
    if not verify_secret(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"code": "wrong_password"})
    try:
        check_password_policy(body.new_password, user.username)
    except PolicyError as e:
        raise policy_error(e) from None
    if verify_secret(body.new_password, user.password_hash):
        raise policy_error(PolicyError("password_reused"))
    user.password_hash = hash_secret(body.new_password)
    user.password_changed_at = func.now()
    user.must_change_password = False
    # End every other session of this user; keep this one.
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.id != principal.session_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=func.now(), revoked_reason="password_changed")
    )
    db.commit()
    db.refresh(user)
    token, ttl = create_access_token(user.id, principal.session_id, False)
    return TokenOut(access_token=token, expires_in=ttl, user=build_me(db, user))


@router.put("/me/pin", response_model=MeOut)
def set_pin(body: SetPinIn, principal: CurrentUserPending, db: DbSession) -> MeOut:
    user = principal.user
    if not verify_secret(body.password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"code": "wrong_password"})
    try:
        check_pin_policy(body.pin)
    except PolicyError as e:
        raise policy_error(e) from None
    user.pin_hash = hash_secret(body.pin)
    db.commit()
    return build_me(db, user)


@router.delete("/me/pin", response_model=MeOut)
def clear_pin(principal: CurrentUserPending, db: DbSession) -> MeOut:
    principal.user.pin_hash = None
    db.commit()
    return build_me(db, principal.user)
