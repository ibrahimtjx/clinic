"""Dental record (SPEC 8): visits with an edit window, addenda, tooth chart findings."""

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.crud import not_found, updater_name
from app.deps import DbSession, Principal, check_version, require
from app.models import (
    Appointment,
    DentalVisit,
    DentalVisitAddendum,
    Department,
    Doctor,
    Patient,
    ToothFinding,
    User,
)
from app.services.settings import DENTAL_KEY, DentalSettings, get_dental_settings, save_setting

router = APIRouter(tags=["dental"])
Viewer = Depends(require("dental.view"))
Editor = Depends(require("dental.edit"))

Category = Literal["restoration", "extraction", "endodontic", "prosthetic", "orthodontic", "other"]
TEXT_FIELDS = (
    "chief_complaint",
    "diagnosis",
    "procedure",
    "treatment_note",
    "preventive_advice",
    "complications",
    "patient_education",
    "next_visit",
    "note",
)


def valid_tooth(t: int) -> bool:
    """FDI: 11–18, 21–28, 31–38, 41–48 permanent; 51–55, 61–65, 71–75, 81–85 primary."""
    q, n = divmod(t, 10)
    return (1 <= q <= 4 and 1 <= n <= 8) or (5 <= q <= 8 and 1 <= n <= 5)


class _Teeth(BaseModel):
    @field_validator("teeth", check_fields=False)
    @classmethod
    def _teeth(cls, v):
        if v is None:
            return v
        bad = [t for t in v if not valid_tooth(t)]
        if bad:
            raise ValueError(f"not FDI tooth numbers: {bad}")
        return sorted(set(v))


class VisitIn(_Teeth):
    doctor_id: int
    department_id: int | None = None
    appointment_id: int | None = None
    visit_at: datetime | None = None  # defaults to now (server time)
    teeth: list[int] = []
    chief_complaint: str = Field("", max_length=4000)
    diagnosis: str = Field("", max_length=4000)
    icd10: str | None = Field(None, max_length=10, pattern=r"^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$")
    procedure: str = Field("", max_length=4000)
    treatment_note: str = Field("", max_length=4000)
    preventive_advice: str = Field("", max_length=4000)
    complications: str = Field("", max_length=4000)
    patient_education: str = Field("", max_length=4000)
    next_visit: str = Field("", max_length=1000)
    note: str = Field("", max_length=4000)


class VisitPatch(_Teeth):
    version: int
    department_id: int | None = None
    teeth: list[int] | None = None
    chief_complaint: str | None = Field(None, max_length=4000)
    diagnosis: str | None = Field(None, max_length=4000)
    icd10: str | None = Field(None, max_length=10, pattern=r"^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$")
    procedure: str | None = Field(None, max_length=4000)
    treatment_note: str | None = Field(None, max_length=4000)
    preventive_advice: str | None = Field(None, max_length=4000)
    complications: str | None = Field(None, max_length=4000)
    patient_education: str | None = Field(None, max_length=4000)
    next_visit: str | None = Field(None, max_length=1000)
    note: str | None = Field(None, max_length=4000)


class AddendumIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class AddendumOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    created_by: int
    created_by_name: str | None = None
    created_at: datetime


class VisitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_id: int
    doctor_id: int
    department_id: int | None
    appointment_id: int | None
    visit_at: datetime
    teeth: list[int]
    chief_complaint: str
    diagnosis: str
    icd10: str | None
    procedure: str
    treatment_note: str
    preventive_advice: str
    complications: str
    patient_education: str
    next_visit: str
    note: str
    created_by: int | None
    created_at: datetime
    updated_at: datetime
    version: int
    created_by_name: str | None = None
    editable_until: datetime | None = None
    can_edit: bool = False
    addenda: list[AddendumOut] = []


class FindingIn(BaseModel):
    tooth_fdi: int
    category: Category
    description: str = Field("", max_length=1000)
    visit_id: int | None = None

    @field_validator("tooth_fdi")
    @classmethod
    def _tooth(cls, v):
        if not valid_tooth(v):
            raise ValueError("not an FDI tooth number")
        return v


class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_id: int
    tooth_fdi: int
    category: str
    description: str
    visit_id: int | None
    created_at: datetime
    created_by: int | None


class DentalRecord(BaseModel):
    visits: list[VisitOut]
    findings: list[FindingOut]
    edit_hours: int


def _err(code: str, http: int = status.HTTP_422_UNPROCESSABLE_CONTENT, **extra) -> HTTPException:
    return HTTPException(http, detail={"code": code, **extra})


def _patient(db: Session, pid: int) -> Patient:
    p = db.get(Patient, pid)
    if p is None or p.deleted_at is not None:
        raise not_found()
    return p


def _is_visit_doctor(db: Session, v: DentalVisit, p: Principal) -> bool:
    """The visit's own doctor: the user linked to its doctor, or whoever wrote it."""
    doc = db.get(Doctor, v.doctor_id)
    return (doc is not None and doc.user_id == p.user.id) or v.created_by == p.user.id


def _visits_out(
    db: Session, visits: list[DentalVisit], p: Principal, now: datetime, hours: int
) -> list[VisitOut]:
    ids = [v.id for v in visits]
    adds = (
        list(
            db.scalars(
                select(DentalVisitAddendum)
                .where(DentalVisitAddendum.visit_id.in_(ids))
                .order_by(DentalVisitAddendum.id)
            )
        )
        if ids
        else []
    )
    uids = {v.created_by for v in visits if v.created_by} | {a.created_by for a in adds}
    names = (
        dict(db.execute(select(User.id, User.full_name_ar).where(User.id.in_(uids))).all())
        if uids
        else {}
    )
    out = []
    for v in visits:
        o = VisitOut.model_validate(v)
        o.created_by_name = names.get(v.created_by)
        o.editable_until = v.created_at + timedelta(hours=hours)
        o.can_edit = p.can("dental.edit") and now < o.editable_until and _is_visit_doctor(db, v, p)
        o.addenda = [
            AddendumOut.model_validate(a).model_copy(
                update={"created_by_name": names.get(a.created_by)}
            )
            for a in adds
            if a.visit_id == v.id
        ]
        out.append(o)
    return out


def _check_refs(
    db: Session,
    patient_id: int,
    doctor_id: int | None,
    department_id: int | None,
    appointment_id: int | None,
) -> None:
    if doctor_id is not None:
        d = db.get(Doctor, doctor_id)
        if d is None or d.deleted_at is not None:
            raise _err("unknown_doctor")
    if department_id is not None and db.get(Department, department_id) is None:
        raise _err("unknown_department")
    if appointment_id is not None:
        a = db.get(Appointment, appointment_id)
        if a is None or a.patient_id != patient_id:
            raise _err("unknown_appointment")


@router.get("/patients/{patient_id}/dental", response_model=DentalRecord)
def dental_record(
    patient_id: int,
    db: DbSession,
    p: Principal = Viewer,
    department_id: int | None = None,
    tooth: int | None = None,
    q: str | None = Query(None, max_length=100),
) -> DentalRecord:
    """Visit history newest first plus chart findings. Opening the dental record is a logged read."""
    _patient(db, patient_id)
    query = select(DentalVisit).where(
        DentalVisit.patient_id == patient_id, DentalVisit.deleted_at.is_(None)
    )
    if department_id:
        query = query.where(DentalVisit.department_id == department_id)
    if tooth:
        query = query.where(DentalVisit.teeth.contains([tooth]))
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            func.concat_ws(" ", *[getattr(DentalVisit, f) for f in TEXT_FIELDS]).ilike(like)
        )
    visits = list(db.scalars(query.order_by(DentalVisit.visit_at.desc(), DentalVisit.id.desc())))
    findings = list(
        db.scalars(
            select(ToothFinding)
            .where(ToothFinding.patient_id == patient_id, ToothFinding.deleted_at.is_(None))
            .order_by(ToothFinding.created_at)
        )
    )
    log_event(db, "read", "patients", patient_id, new={"section": "dental"})
    db.commit()
    hours = get_dental_settings(db).edit_hours
    return DentalRecord(
        visits=_visits_out(db, visits, p, db.scalar(select(func.now())), hours),
        findings=findings,
        edit_hours=hours,
    )


@router.post("/patients/{patient_id}/dental/visits", response_model=VisitOut, status_code=201)
def create_visit(patient_id: int, body: VisitIn, db: DbSession, p: Principal = Editor) -> VisitOut:
    _patient(db, patient_id)
    _check_refs(db, patient_id, body.doctor_id, body.department_id, body.appointment_id)
    now = db.scalar(select(func.now()))
    if body.visit_at and body.visit_at > now + timedelta(minutes=5):
        raise _err("visit_in_future")
    data = body.model_dump(exclude={"visit_at"})
    for f in TEXT_FIELDS:
        data[f] = data[f].strip()
    v = DentalVisit(
        **data,
        patient_id=patient_id,
        visit_at=body.visit_at or now,
        created_by=p.user.id,
        updated_by=p.user.id,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return _visits_out(db, [v], p, now, get_dental_settings(db).edit_hours)[0]


def _visit(db: Session, visit_id: int) -> DentalVisit:
    v = db.get(DentalVisit, visit_id)
    if v is None or v.deleted_at is not None:
        raise not_found()
    return v


@router.patch("/dental-visits/{visit_id}", response_model=VisitOut)
def update_visit(visit_id: int, body: VisitPatch, db: DbSession, p: Principal = Editor) -> VisitOut:
    """Only the visit's doctor, and only within the edit window (default 24 hours)."""
    v = _visit(db, visit_id)
    now = db.scalar(select(func.now()))
    hours = get_dental_settings(db).edit_hours
    if not _is_visit_doctor(db, v, p):
        raise _err("not_visit_doctor", status.HTTP_403_FORBIDDEN)
    if now >= v.created_at + timedelta(hours=hours):
        raise _err("visit_locked", status.HTTP_409_CONFLICT, hours=hours)
    check_version(v.version, body.version, updater_name(db, v), v.updated_at)
    changes = body.model_dump(exclude_unset=True, exclude={"version"})
    _check_refs(db, v.patient_id, None, changes.get("department_id"), None)
    for k, val in changes.items():
        setattr(v, k, val.strip() if isinstance(val, str) else val)
    v.updated_by = p.user.id
    db.commit()
    db.refresh(v)
    return _visits_out(db, [v], p, now, hours)[0]


@router.post("/dental-visits/{visit_id}/addenda", response_model=VisitOut, status_code=201)
def add_addendum(visit_id: int, body: AddendumIn, db: DbSession, p: Principal = Editor) -> VisitOut:
    v = _visit(db, visit_id)
    db.add(DentalVisitAddendum(visit_id=v.id, text=body.text.strip(), created_by=p.user.id))
    db.commit()
    return _visits_out(
        db, [v], p, db.scalar(select(func.now())), get_dental_settings(db).edit_hours
    )[0]


@router.post("/patients/{patient_id}/dental/findings", response_model=FindingOut, status_code=201)
def add_finding(
    patient_id: int, body: FindingIn, db: DbSession, p: Principal = Editor
) -> ToothFinding:
    _patient(db, patient_id)
    if body.visit_id is not None:
        v = db.get(DentalVisit, body.visit_id)
        if v is None or v.patient_id != patient_id:
            raise _err("unknown_visit")
    f = ToothFinding(
        **body.model_dump(), patient_id=patient_id, created_by=p.user.id, updated_by=p.user.id
    )
    f.description = f.description.strip()
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


@router.delete("/dental-findings/{finding_id}", status_code=204)
def remove_finding(finding_id: int, db: DbSession, p: Principal = Editor) -> None:
    f = db.get(ToothFinding, finding_id)
    if f is None or f.deleted_at is not None:
        raise not_found()
    f.deleted_at = db.scalar(select(func.now()))
    f.deleted_by = p.user.id
    f.updated_by = p.user.id
    db.commit()


@router.get("/settings/dental", response_model=DentalSettings)
def read_dental_settings(db: DbSession, _: Principal = Viewer) -> DentalSettings:
    return get_dental_settings(db)


@router.put("/settings/dental", response_model=DentalSettings)
def write_dental_settings(
    body: DentalSettings, db: DbSession, p: Principal = Depends(require("settings.manage"))
) -> DentalSettings:
    save_setting(db, DENTAL_KEY, body, p.user.id)
    db.commit()
    return get_dental_settings(db)
