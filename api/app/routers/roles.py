"""Roles and the permission matrix (SPEC 3.2). Admin always has every permission."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select

from app.deps import DbSession, Principal, check_version, require
from app.models import Role, RolePermission, User, UserRole
from app.permissions import ADMIN_ROLE, PERMISSION_KEYS, PERMISSIONS
from app.schemas import PermissionOut, RoleCreate, RoleOut, RoleUpdate

router = APIRouter(tags=["roles"])


def _validate(perms: list[str]) -> set[str]:
    unknown = set(perms) - PERMISSION_KEYS
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": "unknown_permission", "keys": sorted(unknown)})
    return set(perms)


@router.get("/permissions", response_model=list[PermissionOut])
def list_permissions(_: Principal = Depends(require("role.manage"))) -> list[PermissionOut]:
    return [PermissionOut(key=p.key, group=p.group) for p in PERMISSIONS]


@router.get("/roles", response_model=list[RoleOut])
def list_roles(db: DbSession, _: Principal = Depends(require("user.manage"))) -> list[RoleOut]:
    out = []
    for r in db.scalars(select(Role).order_by(Role.id)):
        role = RoleOut.model_validate(r)
        if r.key == ADMIN_ROLE:  # Admin always holds everything, whatever is stored
            role.permissions = sorted(PERMISSION_KEYS)
        out.append(role)
    return out


@router.post("/roles", response_model=RoleOut, status_code=201)
def create_role(body: RoleCreate, db: DbSession, p: Principal = Depends(require("role.manage"))) -> Role:
    if db.scalar(select(Role.id).where(Role.key == body.key)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "role_key_taken"})
    role = Role(key=body.key, name_ar=body.name_ar, name_en=body.name_en, created_by=p.user.id, updated_by=p.user.id)
    role.permissions = [RolePermission(permission=k) for k in sorted(_validate(body.permissions))]
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


@router.patch("/roles/{role_id}", response_model=RoleOut)
def update_role(role_id: int, body: RoleUpdate, db: DbSession, p: Principal = Depends(require("role.manage"))) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})
    updater = db.get(User, role.updated_by) if role.updated_by else None
    check_version(role.version, body.version, updater.display_name if updater else None, role.updated_at)
    if body.permissions is not None:
        if role.key == ADMIN_ROLE:
            raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "admin_role_fixed"})
        wanted = _validate(body.permissions)
        current = {rp.permission: rp for rp in role.permissions}
        role.permissions = [rp for k, rp in current.items() if k in wanted] + [
            RolePermission(permission=k) for k in sorted(wanted - current.keys())
        ]
    if body.name_ar is not None:
        role.name_ar = body.name_ar
    if body.name_en is not None:
        role.name_en = body.name_en
    role.updated_by = p.user.id
    role.updated_at = func.now()
    db.commit()
    db.refresh(role)
    return role


@router.delete("/roles/{role_id}", status_code=204)
def delete_role(role_id: int, db: DbSession, _: Principal = Depends(require("role.manage"))) -> None:
    """Only custom roles that nobody holds can be removed."""
    role = db.get(Role, role_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})
    if role.is_system:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "system_role"})
    if db.scalar(select(func.count()).select_from(UserRole).where(UserRole.role_id == role.id)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "role_in_use"})
    db.delete(role)
    db.commit()
