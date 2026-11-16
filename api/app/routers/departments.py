"""Department overview: who works in it and which patients its doctors see (Settings, Departments)."""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select

from app.crud import not_found
from app.deps import DbSession, Principal, require
from app.models import (
    Appointment,
    AppointmentStatus,
    Department,
    Doctor,
    Patient,
    Role,
    User,
    UserRole,
)

router = APIRouter(prefix="/departments", tags=["departments"])

RECENT_DAYS = 180
PATIENT_LIMIT = 50


class DeptDoctor(BaseModel):
    id: int
    name_ar: str
    name_en: str
    specialty_ar: str
    specialty_en: str
    room: str
    color: str
    is_active: bool


class DeptStaff(BaseModel):
    id: int
    full_name_ar: str
    full_name_en: str
    roles_ar: list[str]
    roles_en: list[str]
    is_doctor: bool


class DeptPatient(BaseModel):
    id: int
    file_no: int
    name_ar: str
    name_en: str | None
    visits: int
    last_visit: datetime


class DepartmentOverview(BaseModel):
    id: int
    name_ar: str
    name_en: str
    doctors: list[DeptDoctor]
    staff: list[DeptStaff]
    # None when the viewer may not see patients.
    patients: list[DeptPatient] | None
    patient_count: int | None
    recent_days: int = RECENT_DAYS


@router.get("/{dept_id}/overview", response_model=DepartmentOverview)
def overview(
    dept_id: int, db: DbSession, p: Principal = Depends(require("settings.manage"))
) -> DepartmentOverview:
    d = db.get(Department, dept_id)
    if d is None or d.deleted_at is not None:
        raise not_found()
    doctors = list(
        db.scalars(
            select(Doctor)
            .where(Doctor.department_id == dept_id, Doctor.deleted_at.is_(None))
            .order_by(Doctor.is_active.desc(), Doctor.sort_order, Doctor.id)
        )
    )
    doctor_users = {doc.user_id for doc in doctors if doc.user_id}
    users = list(
        db.scalars(
            select(User)
            .where(
                User.deleted_at.is_(None),
                User.is_active,
                (User.department_id == dept_id) | User.id.in_(doctor_users or {0}),
            )
            .order_by(User.full_name_ar)
        )
    )
    roles: dict[int, list[Role]] = {}
    for uid, role in db.execute(
        select(UserRole.user_id, Role)
        .join(Role, Role.id == UserRole.role_id)
        .where(UserRole.user_id.in_([u.id for u in users] or [0]))
    ):
        roles.setdefault(uid, []).append(role)
    staff = [
        DeptStaff(
            id=u.id,
            full_name_ar=u.full_name_ar,
            full_name_en=u.full_name_en,
            roles_ar=[r.name_ar for r in roles.get(u.id, [])],
            roles_en=[r.name_en for r in roles.get(u.id, [])],
            is_doctor=u.id in doctor_users,
        )
        for u in users
    ]

    patients = count = None
    if p.can("patient.view") and doctors:
        since = datetime.now().astimezone() - timedelta(days=RECENT_DAYS)
        seen = (
            select(
                Appointment.patient_id.label("pid"),
                func.count().label("visits"),
                func.max(Appointment.starts_at).label("last"),
            )
            .join(AppointmentStatus, AppointmentStatus.id == Appointment.status_id)
            .where(
                Appointment.doctor_id.in_([doc.id for doc in doctors]),
                Appointment.starts_at >= since,
                Appointment.starts_at <= func.now(),
                Appointment.is_waiting_list.is_(False),
                AppointmentStatus.key.notin_(("cancelled", "no_show")),
            )
            .group_by(Appointment.patient_id)
            .subquery()
        )
        count = db.scalar(select(func.count()).select_from(seen)) or 0
        rows = db.execute(
            select(Patient, seen.c.visits, seen.c.last)
            .join(seen, seen.c.pid == Patient.id)
            .where(Patient.deleted_at.is_(None))
            .order_by(seen.c.last.desc())
            .limit(PATIENT_LIMIT)
        )
        patients = [
            DeptPatient(
                id=pt.id,
                file_no=pt.file_no,
                name_ar=pt.name_ar,
                name_en=pt.name_en,
                visits=visits,
                last_visit=last,
            )
            for pt, visits, last in rows
        ]
    return DepartmentOverview(
        id=d.id,
        name_ar=d.name_ar,
        name_en=d.name_en,
        doctors=[DeptDoctor.model_validate(doc, from_attributes=True) for doc in doctors],
        staff=staff,
        patients=patients,
        patient_count=count,
    )
