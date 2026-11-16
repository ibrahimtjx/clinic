from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.deps import DbSession, Principal, require
from app.models import AuditLog, User
from app.schemas import AuditOut, Page

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=Page[AuditOut])
def list_audit(
    db: DbSession,
    _: Principal = Depends(require("audit.view")),
    table_name: str | None = None,
    record_id: str | None = None,
    user_id: int | None = None,
    action: str | None = None,
    from_at: datetime | None = Query(None, alias="from"),
    to_at: datetime | None = Query(None, alias="to"),
    before_id: int | None = None,
    limit: int = Query(50, ge=1, le=200),
) -> Page[AuditOut]:
    q = select(AuditLog, User.full_name_ar, User.username).outerjoin(
        User, User.id == AuditLog.user_id
    )
    if table_name:
        q = q.where(AuditLog.table_name == table_name)
    if record_id:
        q = q.where(AuditLog.record_id == record_id)
    if user_id:
        q = q.where(AuditLog.user_id == user_id)
    if action:
        q = q.where(AuditLog.action == action)
    if from_at:
        q = q.where(AuditLog.at >= from_at)
    if to_at:
        q = q.where(AuditLog.at < to_at)
    if before_id:
        q = q.where(AuditLog.id < before_id)
    rows = db.execute(q.order_by(AuditLog.id.desc()).limit(limit + 1)).all()
    items = [
        AuditOut.model_validate(a).model_copy(update={"user_name": name or uname})
        for a, name, uname in rows[:limit]
    ]
    return Page(items=items, next_cursor=items[-1].id if len(rows) > limit else None)
