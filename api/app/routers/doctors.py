"""Doctors with weekly schedules and commission rules (SPEC 12, 10.8)."""

from collections import defaultdict
from itertools import pairwise

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.crud import OrderIn, not_found, updater_name
from app.deps import CurrentUser, DbSession, Principal, check_version, require
from app.models import (
    Clinic,
    Department,
    Doctor,
    DoctorCommissionRule,
    DoctorSchedule,
    Service,
    User,
)
from app.schemas_master import CommissionRuleItem, DoctorIn, DoctorOut, DoctorPatch, ScheduleItem

router = APIRouter(prefix="/doctors", tags=["doctors"])
writer = Depends(require("settings.manage"))


def _err(code: str, **extra) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": code, **extra})


def _sees_commission(p: Principal) -> bool:
    return p.can("settings.manage") or p.can("report.financial")


def _out(d: Doctor, p: Principal) -> DoctorOut:
    o = DoctorOut.model_validate(d)
    if not _sees_commission(p):
        o.commission_rules = None
    return o


def validate_schedule(items: list[ScheduleItem]) -> None:
    """Per weekday: work periods do not overlap; each break lies inside one work period;
    breaks do not overlap each other."""
    by_day: dict[int, dict[str, list[ScheduleItem]]] = defaultdict(lambda: {"work": [], "break": []})
    for it in items:
        if it.end_time <= it.start_time:
            raise _err("schedule_times", weekday=it.weekday)
        by_day[it.weekday][it.kind].append(it)
    for day, kinds in by_day.items():
        for kind in ("work", "break"):
            spans = sorted(kinds[kind], key=lambda x: x.start_time)
            for a, b in pairwise(spans):
                if b.start_time < a.end_time:
                    raise _err("schedule_overlap", weekday=day)
        for br in kinds["break"]:
            if not any(w.start_time <= br.start_time and br.end_time <= w.end_time for w in kinds["work"]):
                raise _err("break_outside_work", weekday=day)


def _validate_rules(db: Session, rules: list[CommissionRuleItem]) -> None:
    seen = set()
    for r in rules:
        if r.department_id is not None and r.service_id is not None:
            raise _err("commission_scope")
        scope = (r.department_id, r.service_id)
        if scope in seen:
            raise _err("commission_duplicate")
        seen.add(scope)
        if r.department_id is not None and not db.get(Department, r.department_id):
            raise _err("unknown_department")
        if r.service_id is not None and not db.get(Service, r.service_id):
            raise _err("unknown_service")


def _validate_refs(db: Session, d: Doctor) -> None:
    if d.clinic_id is not None and not db.get(Clinic, d.clinic_id):
        raise _err("unknown_clinic")
    if d.department_id is not None and not db.get(Department, d.department_id):
        raise _err("unknown_department")
    if d.user_id is not None:
        user = db.get(User, d.user_id)
        if user is None or user.deleted_at is not None:
            raise _err("unknown_user")
        taken = db.scalar(select(Doctor.id).where(Doctor.user_id == d.user_id, Doctor.id != (d.id or 0)))
        if taken:
            raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "user_already_doctor"})


def _replace_children(d: Doctor, schedules: list[ScheduleItem] | None, rules: list[CommissionRuleItem] | None) -> None:
    if schedules is not None:
        d.schedules = [DoctorSchedule(**s.model_dump()) for s in schedules]
    if rules is not None:
        d.commission_rules = [DoctorCommissionRule(**r.model_dump()) for r in rules]


def _get(db: Session, doctor_id: int) -> Doctor:
    d = db.get(Doctor, doctor_id)
    if d is None or d.deleted_at is not None:
        raise not_found()
    return d


@router.get("", response_model=list[DoctorOut])
def list_doctors(db: DbSession, p: CurrentUser, include_inactive: bool = False) -> list[DoctorOut]:
    q = select(Doctor).where(Doctor.deleted_at.is_(None))
    if not include_inactive:
        q = q.where(Doctor.is_active)
    return [_out(d, p) for d in db.scalars(q.order_by(Doctor.sort_order, Doctor.id))]


@router.get("/{doctor_id}", response_model=DoctorOut)
def get_doctor(doctor_id: int, db: DbSession, p: CurrentUser) -> DoctorOut:
    return _out(_get(db, doctor_id), p)


@router.post("", response_model=DoctorOut, status_code=201)
def create_doctor(body: DoctorIn, db: DbSession, p: Principal = writer) -> DoctorOut:
    validate_schedule(body.schedules)
    _validate_rules(db, body.commission_rules)
    d = Doctor(**body.model_dump(exclude={"schedules", "commission_rules"}), created_by=p.user.id, updated_by=p.user.id)
    d.sort_order = (db.scalar(select(func.max(Doctor.sort_order))) or 0) + 10
    _validate_refs(db, d)
    _replace_children(d, body.schedules, body.commission_rules)
    db.add(d)
    db.commit()
    db.refresh(d)
    return _out(d, p)


@router.patch("/{doctor_id}", response_model=DoctorOut)
def update_doctor(doctor_id: int, body: DoctorPatch, db: DbSession, p: Principal = writer) -> DoctorOut:
    d = _get(db, doctor_id)
    check_version(d.version, body.version, updater_name(db, d), d.updated_at)
    changes = body.model_dump(exclude_unset=True, exclude={"version", "schedules", "commission_rules"})
    for k, v in changes.items():
        setattr(d, k, v)
    _validate_refs(db, d)
    if body.schedules is not None:
        validate_schedule(body.schedules)
    if body.commission_rules is not None:
        _validate_rules(db, body.commission_rules)
    _replace_children(d, body.schedules, body.commission_rules)
    d.updated_by = p.user.id
    d.updated_at = func.now()  # child-only changes still bump the version
    db.commit()
    db.refresh(d)
    return _out(d, p)


@router.delete("/{doctor_id}", status_code=204)
def delete_doctor(doctor_id: int, db: DbSession, p: Principal = writer) -> None:
    d = _get(db, doctor_id)
    d.deleted_at = db.scalar(select(func.now()))
    d.deleted_by = p.user.id
    d.updated_by = p.user.id
    db.commit()


@router.put("/order", response_model=list[DoctorOut])
def reorder_doctors(body: OrderIn, db: DbSession, p: Principal = writer) -> list[DoctorOut]:
    docs = {d.id: d for d in db.scalars(select(Doctor).where(Doctor.id.in_(body.ids)))}
    if len(docs) != len(set(body.ids)):
        raise not_found()
    for i, doc_id in enumerate(body.ids):
        docs[doc_id].sort_order = (i + 1) * 10
    db.commit()
    return [_out(docs[i], p) for i in body.ids]
