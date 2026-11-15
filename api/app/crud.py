"""Shared endpoints for settings lists (clinics, departments, statuses, visit types, phrases, services).

Every list gets: list (active by default), get, create, update with optimistic locking, soft delete,
restore and reorder. Reading needs only a signed-in user (the lists feed every screen); writing needs
`settings.manage`. Deleted rows are visible only with `record.view_deleted` (SPEC 3.4).
"""

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.deps import CurrentUser, DbSession, Principal, check_version, require
from app.models import User


class OrderIn(BaseModel):
    ids: list[int]


def not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})


def updater_name(db: Session, obj: Any) -> str | None:
    if not getattr(obj, "updated_by", None):
        return None
    u = db.get(User, obj.updated_by)
    return u.full_name_ar or u.username if u else None


def master_router(
    model: type,
    prefix: str,
    *,
    out: type[BaseModel],
    create: type[BaseModel],
    update: type[BaseModel],
    tag: str,
    filters: Callable[[Select, dict], Select] | None = None,
    validate: Callable[[Session, Any], None] | None = None,
    protect: Callable[[Any, str], None] | None = None,
    order_by: tuple = (),
) -> APIRouter:
    """`validate(db, obj)` runs before every save; `protect(obj, action)` may refuse an action."""
    router = APIRouter(prefix=prefix, tags=[tag])
    writer = Depends(require("settings.manage"))
    default_order = order_by or (model.sort_order, model.id)

    def _get(db: Session, item_id: int, deleted_ok: bool = False):
        obj = db.get(model, item_id)
        if obj is None or (obj.deleted_at is not None and not deleted_ok):
            raise not_found()
        return obj

    @router.get("", response_model=list[out])
    def list_items(
        db: DbSession,
        principal: CurrentUser,
        include_inactive: bool = False,
        include_deleted: bool = False,
        field_key: str | None = Query(None, description="saved phrases only"),
    ):
        q = select(model)
        if not (include_deleted and principal.can("record.view_deleted")):
            q = q.where(model.deleted_at.is_(None))
        if not include_inactive:
            q = q.where(model.is_active)
        if filters:
            q = filters(q, {"field_key": field_key})
        return list(db.scalars(q.order_by(*default_order)))

    @router.get("/{item_id}", response_model=out)
    def get_item(item_id: int, db: DbSession, principal: CurrentUser):
        return _get(db, item_id, deleted_ok=principal.can("record.view_deleted"))

    @router.post("", response_model=out, status_code=201)
    def create_item(body: create, db: DbSession, p: Principal = writer):  # type: ignore[valid-type]
        obj = model(**body.model_dump(), created_by=p.user.id, updated_by=p.user.id)
        if "sort_order" not in body.model_fields_set:
            obj.sort_order = (db.scalar(select(func.max(model.sort_order))) or 0) + 10
        if validate:
            validate(db, obj)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @router.patch("/{item_id}", response_model=out)
    def update_item(item_id: int, body: update, db: DbSession, p: Principal = writer):  # type: ignore[valid-type]
        obj = _get(db, item_id)
        check_version(obj.version, body.version, updater_name(db, obj), obj.updated_at)
        changes = body.model_dump(exclude_unset=True, exclude={"version"})
        if protect:
            protect(obj, "update:" + ",".join(sorted(changes)))
        for k, v in changes.items():
            setattr(obj, k, v)
        if validate:
            validate(db, obj)
        obj.updated_by = p.user.id
        db.commit()
        db.refresh(obj)
        return obj

    @router.delete("/{item_id}", status_code=204)
    def delete_item(item_id: int, db: DbSession, p: Principal = writer):
        obj = _get(db, item_id)
        if protect:
            protect(obj, "delete")
        obj.deleted_at = db.scalar(select(func.now()))  # a value, so the audit row shows the time
        obj.deleted_by = p.user.id
        obj.updated_by = p.user.id
        db.commit()

    @router.post("/{item_id}/restore", response_model=out)
    def restore_item(item_id: int, db: DbSession, p: Principal = writer):
        obj = _get(db, item_id, deleted_ok=True)
        obj.deleted_at = None
        obj.deleted_by = None
        obj.updated_by = p.user.id
        db.commit()
        db.refresh(obj)
        return obj

    @router.put("/order", response_model=list[out])
    def reorder(body: OrderIn, db: DbSession, p: Principal = writer):
        """Set display order to the order of `ids` (the list as shown on screen)."""
        objs = {o.id: o for o in db.scalars(select(model).where(model.id.in_(body.ids)))}
        if len(objs) != len(set(body.ids)):
            raise not_found()
        for i, item_id in enumerate(body.ids):
            if objs[item_id].sort_order != (i + 1) * 10:
                objs[item_id].sort_order = (i + 1) * 10
                objs[item_id].updated_by = p.user.id
        db.commit()
        return [objs[i] for i in body.ids]

    return router
