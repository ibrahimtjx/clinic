"""User management (SPEC 3.2, 3.3). Users are deactivated, never deleted."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.audit import log_event
from app.deps import DbSession, Principal, check_version, require
from app.models import AuthSession, Role, User, UserRole
from app.routers.auth import policy_error
from app.schemas import ResetPasswordIn, UserCreate, UserOut, UserUpdate
from app.security import PolicyError, check_password_policy, hash_secret

router = APIRouter(prefix="/users", tags=["users"])
Admin = Depends(require("user.manage"))


def _get(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})
    return user


def _check_roles(db: Session, role_ids: list[int]) -> None:
    found = db.scalars(select(Role.id).where(Role.id.in_(role_ids))).all()
    if len(found) != len(set(role_ids)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": "unknown_role"})


def _set_roles(db: Session, user: User, role_ids: list[int]) -> None:
    _check_roles(db, role_ids)
    current = set(db.scalars(select(UserRole.role_id).where(UserRole.user_id == user.id)))
    wanted = set(role_ids)
    for rid in current - wanted:
        db.delete(db.get(UserRole, (user.id, rid)))
    for rid in wanted - current:
        db.add(UserRole(user_id=user.id, role_id=rid))


def _revoke_sessions(db: Session, user_id: int, reason: str) -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=func.now(), revoked_reason=reason)
    )


def _admin_count_without(db: Session, user_id: int) -> int:
    return db.scalar(
        select(func.count(func.distinct(User.id)))
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(Role.key == "admin", User.is_active, User.deleted_at.is_(None), User.id != user_id)
    )


def _out(db: Session, user: User) -> UserOut:
    db.refresh(user)
    return UserOut.model_validate(user)


@router.get("", response_model=list[UserOut])
def list_users(db: DbSession, _: Principal = Admin, include_inactive: bool = True) -> list[User]:
    q = select(User).where(User.deleted_at.is_(None)).order_by(User.is_active.desc(), User.username)
    if not include_inactive:
        q = q.where(User.is_active)
    return list(db.scalars(q))


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, db: DbSession, p: Principal = Admin) -> UserOut:
    if db.scalar(select(User.id).where(func.lower(User.username) == body.username.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "username_taken"})
    try:
        check_password_policy(body.password, body.username)
    except PolicyError as e:
        raise policy_error(e) from None
    _check_roles(db, body.role_ids)
    user = User(
        username=body.username,
        full_name_ar=body.full_name_ar,
        full_name_en=body.full_name_en,
        password_hash=hash_secret(body.password),
        must_change_password=True,  # the person sets their own password on first sign-in
        created_by=p.user.id,
        updated_by=p.user.id,
    )
    db.add(user)
    db.flush()
    _set_roles(db, user, body.role_ids)
    db.commit()
    return _out(db, user)


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: DbSession, _: Principal = Admin) -> User:
    return _get(db, user_id)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, db: DbSession, p: Principal = Admin) -> UserOut:
    user = _get(db, user_id)
    updater = db.get(User, user.updated_by) if user.updated_by else None
    check_version(user.version, body.version, updater.display_name if updater else None, user.updated_at)
    if body.full_name_ar is not None:
        user.full_name_ar = body.full_name_ar.strip()
    if body.full_name_en is not None:
        user.full_name_en = body.full_name_en.strip()
    if body.role_ids is not None:
        admin_role = db.scalar(select(Role.id).where(Role.key == "admin"))
        if admin_role not in body.role_ids and _admin_count_without(db, user.id) == 0:
            raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "last_admin"})
        _set_roles(db, user, body.role_ids)
    user.updated_by = p.user.id
    user.updated_at = func.now()  # role changes alone must still bump version
    db.commit()
    return _out(db, user)


@router.post("/{user_id}/reset-password", response_model=UserOut)
def reset_password(user_id: int, body: ResetPasswordIn, db: DbSession, p: Principal = Admin) -> UserOut:
    """Admin sets a temporary password; the user must change it at next sign-in."""
    user = _get(db, user_id)
    try:
        check_password_policy(body.new_password, user.username)
    except PolicyError as e:
        raise policy_error(e) from None
    user.password_hash = hash_secret(body.new_password)
    user.must_change_password = True
    user.failed_logins = 0
    user.locked_until = None
    user.updated_by = p.user.id
    _revoke_sessions(db, user.id, "password_reset")
    db.commit()
    return _out(db, user)


@router.post("/{user_id}/unlock", response_model=UserOut)
def unlock_user(user_id: int, db: DbSession, p: Principal = Admin) -> UserOut:
    user = _get(db, user_id)
    user.failed_logins = 0
    user.locked_until = None
    log_event(db, "unlock", "users", user.id)
    db.commit()
    return _out(db, user)


@router.post("/{user_id}/deactivate", response_model=UserOut)
def deactivate_user(user_id: int, db: DbSession, p: Principal = Admin) -> UserOut:
    user = _get(db, user_id)
    if user.id == p.user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "cannot_deactivate_self"})
    if any(r.key == "admin" for r in user.roles) and _admin_count_without(db, user.id) == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "last_admin"})
    user.is_active = False
    user.updated_by = p.user.id
    _revoke_sessions(db, user.id, "deactivated")
    db.commit()
    return _out(db, user)


@router.post("/{user_id}/activate", response_model=UserOut)
def activate_user(user_id: int, db: DbSession, p: Principal = Admin) -> UserOut:
    user = _get(db, user_id)
    user.is_active = True
    user.updated_by = p.user.id
    db.commit()
    return _out(db, user)


@router.delete("/{user_id}/pin", response_model=UserOut)
def clear_user_pin(user_id: int, db: DbSession, p: Principal = Admin) -> UserOut:
    user = _get(db, user_id)
    user.pin_hash = None
    user.updated_by = p.user.id
    db.commit()
    return _out(db, user)

