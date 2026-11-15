"""Patients (SPEC 5): list and search, profile, health (logged reads), export, assignments."""

import io
from datetime import date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from sqlalchemy import Select, String, cast, func, or_, select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.crud import not_found, updater_name
from app.deps import CurrentUser, DbSession, Principal, check_version, require
from app.models import (
    AuditLog,
    Doctor,
    InsuranceCompany,
    Patient,
    PatientAssignment,
    PatientInsurance,
    User,
)
from app.schemas import AuditOut
from app.schemas_patients import (
    AssignmentIn,
    AssignmentOut,
    DuplicateOut,
    HealthIn,
    HealthOut,
    InsuranceOut,
    PatientCreate,
    PatientListItem,
    PatientOut,
    PatientPage,
    PatientQuick,
    PatientUpdate,
)
from app.services.patient_search import apply_search, base_query

router = APIRouter(prefix="/patients", tags=["patients"])
assignments_router = APIRouter(prefix="/assignments", tags=["assignments"])

Viewer = Depends(require("patient.view"))
SortKey = Literal[
    "file_no",
    "-file_no",
    "name",
    "-name",
    "created_at",
    "-created_at",
    "last_visit_at",
    "-last_visit_at",
]

RIYADH = ZoneInfo("Asia/Riyadh")


def _err(code: str, http: int = status.HTTP_422_UNPROCESSABLE_CONTENT, **extra) -> HTTPException:
    return HTTPException(http, detail={"code": code, **extra})


def _get(db: Session, patient_id: int, *, deleted_ok: bool = False) -> Patient:
    p = db.get(Patient, patient_id)
    if p is None or (p.deleted_at is not None and not deleted_ok):
        raise not_found()
    return p


def _out(db: Session, p: Patient) -> PatientOut:
    o = PatientOut.model_validate(p)
    if p.insurance:
        c = db.get(InsuranceCompany, p.insurance.company_id)
        o.insurance = InsuranceOut.model_validate(p.insurance).model_copy(
            update={
                "company_name_ar": c.name_ar if c else None,
                "company_name_en": c.name_en if c else None,
            }
        )
    return o


def _filtered(
    q: Select,
    *,
    search: str | None,
    doctor_id: int | None,
    insurance_company_id: int | None,
    has_balance: bool | None,
    created_from: date | None,
    created_to: date | None,
    include_inactive: bool,
) -> tuple[Select, list]:
    order: list = []
    if search:
        q, order = apply_search(q, search)
    if not include_inactive:
        q = q.where(Patient.is_active)
    if doctor_id:
        q = q.where(Patient.default_doctor_id == doctor_id)
    if insurance_company_id:
        q = q.where(
            Patient.id.in_(
                select(PatientInsurance.patient_id).where(
                    PatientInsurance.company_id == insurance_company_id
                )
            )
        )
    if has_balance is not None:
        q = q.where(Patient.balance > 0 if has_balance else Patient.balance <= 0)
    # Dates are clinic-local days (server time zone Asia/Riyadh).
    if created_from:
        q = q.where(
            Patient.created_at
            >= func.timezone("Asia/Riyadh", datetime.combine(created_from, time()))
        )
    if created_to:
        q = q.where(
            Patient.created_at
            < func.timezone("Asia/Riyadh", datetime.combine(created_to + timedelta(days=1), time()))
        )
    return q, order


SORTS = {
    "file_no": Patient.file_no,
    "name": Patient.name_ar,
    "created_at": Patient.created_at,
    "last_visit_at": Patient.last_visit_at,
}


def _sort(key: str | None):
    if not key:
        return []
    col = SORTS[key.lstrip("-")]
    return [col.desc().nulls_last() if key.startswith("-") else col.asc().nulls_last()]


def _list_items(db: Session, q: Select) -> list[PatientListItem]:
    patients = list(db.scalars(q))
    ins = dict(
        db.execute(
            select(PatientInsurance.patient_id, PatientInsurance.company_id).where(
                PatientInsurance.patient_id.in_([p.id for p in patients])
            )
        ).all()
    )
    return [
        PatientListItem.model_validate(p).model_copy(update={"insurance_company_id": ins.get(p.id)})
        for p in patients
    ]


@router.get("", response_model=PatientPage)
def list_patients(
    db: DbSession,
    _: Principal = Viewer,
    q: str | None = Query(None, max_length=100),
    doctor_id: int | None = None,
    insurance_company_id: int | None = None,
    has_balance: bool | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    include_inactive: bool = False,
    sort: SortKey | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> PatientPage:
    query, rank = _filtered(
        base_query(),
        search=q,
        doctor_id=doctor_id,
        insurance_company_id=insurance_company_id,
        has_balance=has_balance,
        created_from=created_from,
        created_to=created_to,
        include_inactive=include_inactive,
    )
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    order = _sort(sort) or rank or [Patient.file_no.desc()]
    items = _list_items(
        db, query.order_by(*order, Patient.id).offset((page - 1) * page_size).limit(page_size)
    )
    return PatientPage(items=items, total=total)


@router.get("/search", response_model=list[PatientQuick])
def quick_search(
    db: DbSession,
    _: Principal = Viewer,
    q: str = Query(min_length=1, max_length=100),
    limit: int = Query(8, ge=1, le=20),
) -> list[Patient]:
    """As-you-type search for the top bar and the Ctrl+K palette."""
    query, rank = apply_search(base_query(), q)
    return list(db.scalars(query.order_by(*rank, Patient.id).limit(limit)))


@router.get("/duplicates", response_model=list[DuplicateOut])
def find_duplicates(
    db: DbSession,
    _: Principal = Viewer,
    national_id: str | None = None,
    mobile: str | None = None,
    exclude_id: int | None = None,
) -> list[DuplicateOut]:
    return _duplicates(db, national_id, mobile, exclude_id)


def _duplicates(
    db: Session, national_id: str | None, mobile: str | None, exclude_id: int | None
) -> list[DuplicateOut]:
    conds = []
    if national_id:
        conds.append(Patient.national_id == national_id)
    if mobile:
        conds.append(Patient.mobile == mobile)
    if not conds:
        return []
    q = base_query().where(or_(*conds))
    if exclude_id:
        q = q.where(Patient.id != exclude_id)
    out = []
    for p in db.scalars(q.order_by(Patient.file_no).limit(10)):
        matched = [
            k
            for k, v in (("national_id", national_id), ("mobile", mobile))
            if v and getattr(p, k) == v
        ]
        out.append(
            DuplicateOut(
                id=p.id, file_no=p.file_no, name_ar=p.name_ar, name_en=p.name_en, matched_on=matched
            )
        )
    return out


def _check_class(db: Session, ins) -> None:
    if ins is None or ins.class_id is None:
        return
    from app.models import InsuranceClass

    c = db.get(InsuranceClass, ins.class_id)
    if c is None or c.company_id != ins.company_id:
        raise _err("insurance_class_mismatch")


def _check_refs(db: Session, doctor_id: int | None, company_id: int | None) -> None:
    if doctor_id is not None:
        d = db.get(Doctor, doctor_id)
        if d is None or d.deleted_at is not None:
            raise _err("unknown_doctor")
    if company_id is not None:
        c = db.get(InsuranceCompany, company_id)
        if c is None or c.deleted_at is not None:
            raise _err("unknown_insurance_company")


@router.post("", response_model=PatientOut, status_code=201)
def create_patient(
    body: PatientCreate, db: DbSession, p: Principal = Depends(require("patient.create"))
) -> PatientOut:
    if not body.allow_duplicate:
        dups = _duplicates(db, body.national_id, body.mobile, None)
        if dups:
            raise _err(
                "possible_duplicate",
                status.HTTP_409_CONFLICT,
                matches=[d.model_dump() for d in dups],
            )
    _check_refs(db, body.default_doctor_id, body.insurance.company_id if body.insurance else None)
    _check_class(db, body.insurance)
    data = body.model_dump(exclude={"allow_duplicate", "insurance"}, exclude_none=True)
    patient = Patient(**data, created_by=p.user.id, updated_by=p.user.id)
    if body.insurance:
        patient.insurance = PatientInsurance(
            **body.insurance.model_dump(), created_by=p.user.id, updated_by=p.user.id
        )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return _out(db, patient)


@router.get("/{patient_id}", response_model=PatientOut)
def get_patient(patient_id: int, db: DbSession, principal: Principal = Viewer) -> PatientOut:
    return _out(db, _get(db, patient_id, deleted_ok=principal.can("record.view_deleted")))


@router.patch("/{patient_id}", response_model=PatientOut)
def update_patient(
    patient_id: int,
    body: PatientUpdate,
    db: DbSession,
    p: Principal = Depends(require("patient.edit")),
) -> PatientOut:
    patient = _get(db, patient_id)
    check_version(patient.version, body.version, updater_name(db, patient), patient.updated_at)
    fields = body.model_dump(
        exclude_unset=True, exclude={"version", "insurance", "clear_insurance"}
    )
    if "name_ar" in fields and not fields["name_ar"]:
        raise _err("name_required")
    _check_refs(
        db, fields.get("default_doctor_id"), body.insurance.company_id if body.insurance else None
    )
    _check_class(db, body.insurance)
    for k, v in fields.items():
        # Clearing a text field stores an empty string; nullable columns store NULL.
        setattr(
            patient,
            k,
            "" if v is None and k in ("name_en", "chronic_diseases", "allergies", "notes") else v,
        )
    if body.clear_insurance and patient.insurance:
        patient.insurance = None
    elif body.insurance:
        if patient.insurance:
            for k, v in body.insurance.model_dump().items():
                setattr(patient.insurance, k, v)
            patient.insurance.updated_by = p.user.id
        else:
            patient.insurance = PatientInsurance(
                **body.insurance.model_dump(), created_by=p.user.id, updated_by=p.user.id
            )
    patient.updated_by = p.user.id
    patient.updated_at = func.now()
    db.commit()
    db.refresh(patient)
    return _out(db, patient)


@router.get("/{patient_id}/health", response_model=HealthOut)
def read_health(
    patient_id: int, db: DbSession, p: Principal = Depends(require("patient.medical_view"))
) -> Patient:
    """Opening the medical file is logged for privacy reviews (SPEC 3.4)."""
    patient = _get(db, patient_id)
    log_event(db, "read", "patients", patient.id, new={"section": "health"})
    db.commit()
    return patient


@router.put("/{patient_id}/health", response_model=HealthOut)
def write_health(
    patient_id: int,
    body: HealthIn,
    db: DbSession,
    p: Principal = Depends(require("patient.medical_view")),
) -> Patient:
    if not (p.can("patient.edit") or p.can("dental.edit")):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "missing": ["patient.edit"]}
        )
    patient = _get(db, patient_id)
    check_version(patient.version, body.version, updater_name(db, patient), patient.updated_at)
    for k, v in body.model_dump(exclude={"version"}).items():
        setattr(patient, k, v.strip())
    patient.updated_by = p.user.id
    db.commit()
    db.refresh(patient)
    return patient


def _set_active(db: Session, patient_id: int, active: bool, p: Principal) -> PatientOut:
    patient = _get(db, patient_id)
    patient.is_active = active
    patient.updated_by = p.user.id
    db.commit()
    db.refresh(patient)
    return _out(db, patient)


@router.post("/{patient_id}/deactivate", response_model=PatientOut)
def deactivate(
    patient_id: int, db: DbSession, p: Principal = Depends(require("patient.edit"))
) -> PatientOut:
    return _set_active(db, patient_id, False, p)


@router.post("/{patient_id}/activate", response_model=PatientOut)
def activate(
    patient_id: int, db: DbSession, p: Principal = Depends(require("patient.edit"))
) -> PatientOut:
    return _set_active(db, patient_id, True, p)


@router.delete("/{patient_id}", status_code=204)
def delete_patient(
    patient_id: int, db: DbSession, p: Principal = Depends(require("patient.delete"))
) -> None:
    patient = _get(db, patient_id)
    patient.deleted_at = db.scalar(select(func.now()))
    patient.deleted_by = p.user.id
    patient.updated_by = p.user.id
    db.commit()


@router.post("/{patient_id}/restore", response_model=PatientOut)
def restore_patient(
    patient_id: int, db: DbSession, p: Principal = Depends(require("patient.delete"))
) -> PatientOut:
    patient = _get(db, patient_id, deleted_ok=True)
    patient.deleted_at = None
    patient.deleted_by = None
    patient.updated_by = p.user.id
    db.commit()
    db.refresh(patient)
    return _out(db, patient)


@router.get("/{patient_id}/activity", response_model=list[AuditOut])
def patient_activity(
    patient_id: int, db: DbSession, _: Principal = Depends(require("audit.view"))
) -> list[AuditOut]:
    """Audit trail for this patient (SPEC 5.2 tab 10): record changes, insurance, assignments, reads."""
    _get(db, patient_id, deleted_ok=True)
    ins_ids = select(cast(PatientInsurance.id, String)).where(
        PatientInsurance.patient_id == patient_id
    )
    asg_ids = select(cast(PatientAssignment.id, String)).where(
        PatientAssignment.patient_id == patient_id
    )
    q = (
        select(AuditLog, User.full_name_ar, User.username)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(
            or_(
                (AuditLog.table_name == "patients") & (AuditLog.record_id == str(patient_id)),
                (AuditLog.table_name == "patient_insurance") & AuditLog.record_id.in_(ins_ids),
                (AuditLog.table_name == "patient_assignments") & AuditLog.record_id.in_(asg_ids),
            )
        )
        .order_by(AuditLog.id.desc())
        .limit(500)
    )
    return [
        AuditOut.model_validate(a).model_copy(update={"user_name": n or u})
        for a, n, u in db.execute(q).all()
    ]


@router.get("/export/xlsx")
def export_patients(
    db: DbSession,
    p: Principal = Depends(require("patient.export")),
    q: str | None = Query(None, max_length=100),
    doctor_id: int | None = None,
    insurance_company_id: int | None = None,
    has_balance: bool | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    include_inactive: bool = False,
) -> StreamingResponse:
    """Excel export of the filtered list (SPEC 5.1), bilingual headers. The export itself is audited."""
    query, rank = _filtered(
        base_query(),
        search=q,
        doctor_id=doctor_id,
        insurance_company_id=insurance_company_id,
        has_balance=has_balance,
        created_from=created_from,
        created_to=created_to,
        include_inactive=include_inactive,
    )
    patients = list(db.scalars(query.order_by(*(rank or [Patient.file_no]))))
    doctors = {d.id: d.name_ar for d in db.scalars(select(Doctor))}
    companies = {c.id: c.name_ar for c in db.scalars(select(InsuranceCompany))}
    ins = dict(db.execute(select(PatientInsurance.patient_id, PatientInsurance.company_id)).all())

    wb = Workbook()
    ws = wb.active
    ws.title = "Patients"
    ws.sheet_view.rightToLeft = True
    headers = [
        ("رقم الملف", "File no."),
        ("الاسم", "Name (Arabic)"),
        ("Name", "Name (English)"),
        ("الجوال", "Mobile"),
        ("رقم الهوية", "National ID"),
        ("الطبيب المعالج", "Treating doctor"),
        ("شركة التأمين", "Insurance"),
        ("الرصيد", "Balance"),
        ("آخر زيارة", "Last visit"),
        ("تاريخ التسجيل", "Registered"),
    ]
    ws.append([f"{ar} / {en}" for ar, en in headers])
    for c in ws[1]:
        c.font = Font(bold=True)
        c.alignment = Alignment(wrap_text=True)

    def local(dt: datetime | None) -> datetime | None:
        # Excel has no time zones: write clinic-local wall time.
        return dt.astimezone(RIYADH).replace(tzinfo=None) if dt else None

    for pt in patients:
        ws.append(
            [
                pt.file_no,
                pt.name_ar,
                pt.name_en,
                pt.mobile,
                pt.national_id,
                doctors.get(pt.default_doctor_id),
                companies.get(ins.get(pt.id)),
                pt.balance,
                local(pt.last_visit_at),
                local(pt.created_at),
            ]
        )
    for row in ws.iter_rows(min_row=2):
        row[7].number_format = "#,##0.00"
        row[8].number_format = row[9].number_format = "dd/mm/yyyy hh:mm AM/PM"
    for col, width in zip("ABCDEFGHIJ", (10, 28, 28, 14, 14, 22, 22, 12, 18, 18), strict=True):
        ws.column_dimensions[col].width = width
    ws.freeze_panes = "A2"

    log_event(db, "export", "patients", None, new={"rows": len(patients), "q": q})
    db.commit()
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    stamp = db.scalar(select(func.to_char(func.now(), "YYYYMMDD-HH24MI")))
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="patients-{stamp}.xlsx"'},
    )


# ---- assignments (SPEC 5.4) ----
def _assignment_out(db: Session, a: PatientAssignment) -> AssignmentOut:
    pt = db.get(Patient, a.patient_id)
    to, by = db.get(User, a.assigned_to), db.get(User, a.assigned_by)
    return AssignmentOut.model_validate(a).model_copy(
        update={
            "patient_name_ar": pt.name_ar if pt else None,
            "patient_name_en": pt.name_en if pt else None,
            "patient_file_no": pt.file_no if pt else None,
            "assigned_to_name": to.full_name_ar if to else None,
            "assigned_by_name": by.full_name_ar if by else None,
        }
    )


@router.get("/{patient_id}/assignments", response_model=list[AssignmentOut])
def list_patient_assignments(
    patient_id: int, db: DbSession, _: Principal = Viewer
) -> list[AssignmentOut]:
    _get(db, patient_id)
    rows = db.scalars(
        select(PatientAssignment)
        .where(PatientAssignment.patient_id == patient_id)
        .order_by(PatientAssignment.id.desc())
    )
    return [_assignment_out(db, a) for a in rows]


@router.post("/{patient_id}/assignments", response_model=AssignmentOut, status_code=201)
def assign_patient(
    patient_id: int,
    body: AssignmentIn,
    db: DbSession,
    p: Principal = Depends(require("patient.assign")),
) -> AssignmentOut:
    _get(db, patient_id)
    to = db.get(User, body.assigned_to)
    if to is None or not to.is_active or to.deleted_at is not None:
        raise _err("unknown_user")
    a = PatientAssignment(
        patient_id=patient_id, assigned_to=to.id, assigned_by=p.user.id, note=body.note.strip()
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _assignment_out(db, a)


@assignments_router.get("/mine", response_model=list[AssignmentOut])
def my_assignments(db: DbSession, p: CurrentUser) -> list[AssignmentOut]:
    """Open assignments for the signed-in user (top bar notifications)."""
    rows = db.scalars(
        select(PatientAssignment)
        .where(PatientAssignment.assigned_to == p.user.id, PatientAssignment.done_at.is_(None))
        .order_by(PatientAssignment.id.desc())
    )
    return [_assignment_out(db, a) for a in rows]


@assignments_router.post("/{assignment_id}/done", response_model=AssignmentOut)
def mark_done(assignment_id: int, db: DbSession, p: CurrentUser) -> AssignmentOut:
    a = db.get(PatientAssignment, assignment_id)
    if a is None:
        raise not_found()
    if a.assigned_to != p.user.id and not p.can("patient.assign"):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "missing": ["patient.assign"]}
        )
    if a.done_at is None:
        a.done_at = db.scalar(select(func.now()))
        a.done_by = p.user.id
        db.commit()
        db.refresh(a)
    return _assignment_out(db, a)
