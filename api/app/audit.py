"""Audit log (SPEC 3.4).

Every flush of a model marked ``__audited__ = True`` writes audit rows automatically, so no
endpoint can forget to. The acting user and machine come from a per-request context set by the
auth dependency. Read access (e.g. opening a medical file) and auth events are logged explicitly
with :func:`log_event`.
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.models.audit import AuditLog


@dataclass
class AuditContext:
    user_id: int | None = None
    machine: str | None = None
    ip: str | None = None


_KEY = "audit_ctx"


def set_audit_context(db: Session, ctx: AuditContext) -> None:
    """Kept on the DB session (one per request). A ContextVar would not survive FastAPI running
    dependencies and the endpoint in separate thread-pool contexts."""
    db.info[_KEY] = ctx


def get_audit_context(db: Session) -> AuditContext:
    return db.info.get(_KEY) or AuditContext()


def _jsonable(v: Any) -> Any:
    if isinstance(v, datetime | date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, UUID):
        return str(v)
    if isinstance(v, dict | list | str | int | float | bool) or v is None:
        return v
    return str(v)


def _pk(obj: Any) -> str:
    # Read from the instance: right after an INSERT the identity key is not assigned yet.
    ident = inspect(obj).mapper.primary_key_from_instance(obj)
    return "/".join(str(i) for i in ident)


def _columns(obj: Any) -> list[str]:
    skip = getattr(obj, "__audit_skip__", frozenset())
    return [c.key for c in inspect(obj).mapper.column_attrs if c.key not in skip]


def _mask(obj: Any, key: str, value: Any) -> Any:
    masked = getattr(obj, "__audit_masked__", frozenset())
    return ("***" if value else None) if key in masked else _jsonable(value)


SKIP = {"updated_at", "updated_by", "version"}


def log_event(
    db: Session,
    action: str,
    table_name: str,
    record_id: Any = None,
    new: dict | None = None,
    old: dict | None = None,
    user_id: int | None = None,
) -> None:
    ctx = get_audit_context(db)
    db.add(
        AuditLog(
            user_id=user_id if user_id is not None else ctx.user_id,
            machine=ctx.machine,
            ip=ctx.ip,
            table_name=table_name,
            record_id=None if record_id is None else str(record_id),
            action=action,
            old_json=old,
            new_json=new,
        )
    )


@event.listens_for(Session, "after_flush")
def _audit_after_flush(session: Session, _flush_ctx) -> None:
    ctx = get_audit_context(session)
    rows: list[AuditLog] = []

    def add(obj: Any, action: str, old: dict | None, new: dict | None) -> None:
        rows.append(
            AuditLog(
                user_id=ctx.user_id,
                machine=ctx.machine,
                ip=ctx.ip,
                table_name=obj.__tablename__,
                record_id=_pk(obj),
                action=action,
                old_json=old,
                new_json=new,
            )
        )

    for obj in session.new:
        if getattr(obj, "__audited__", False):
            add(
                obj,
                "create",
                None,
                {k: _mask(obj, k, getattr(obj, k)) for k in _columns(obj) if k not in SKIP},
            )

    for obj in session.dirty:
        if not getattr(obj, "__audited__", False) or not session.is_modified(
            obj, include_collections=False
        ):
            continue
        state = inspect(obj)
        old, new = {}, {}
        for key in _columns(obj):
            if key in SKIP:
                continue
            hist = state.attrs[key].history
            if hist.has_changes():
                old[key] = _mask(obj, key, hist.deleted[0] if hist.deleted else None)
                new[key] = _mask(obj, key, hist.added[0] if hist.added else None)
        if not new:
            continue
        action = "delete" if new.get("deleted_at") and not old.get("deleted_at") else "update"
        if "deleted_at" in new and new["deleted_at"] is None and old.get("deleted_at"):
            action = "restore"
        add(obj, action, old, new)

    for obj in session.deleted:
        # Only link tables (role permissions, user roles) are ever physically deleted.
        if getattr(obj, "__audited__", False):
            add(obj, "delete", {k: _mask(obj, k, getattr(obj, k)) for k in _columns(obj)}, None)

    if rows:
        session.add_all(rows)
