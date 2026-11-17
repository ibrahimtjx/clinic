"""Prescriptions, lab requests and results, medical reports (SPEC 8.6, milestone M12).

Written by doctors (dental.edit), read with dental.view. Like dental visits, a document can be changed
by its own doctor within the edit window (Settings: dental.edit_hours); after that it can only be
cancelled with a reason. Lab results can be entered at any time while the request is active.
"""

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.crud import master_router, not_found, updater_name
from app.deps import DbSession, Principal, check_version, require
from app.models import (
    DentalVisit,
    Doctor,
    LabRequest,
    LabRequestItem,
    LabTest,
    MedicalReport,
    Medication,
    Patient,
    Prescription,
    PrescriptionItem,
    User,
)
from app.schemas_master import _Out
from app.services.settings import get_dental_settings

router = APIRouter(tags=["clinical"])
Viewer = Depends(require("dental.view"))
Editor = Depends(require("dental.edit"))


# ---------------------------------------------------------------- pick lists (Settings)
class MedicationIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    form: str = Field("", max_length=60)
    dose: str = Field("", max_length=100)
    frequency: str = Field("", max_length=100)
    duration: str = Field("", max_length=100)
    instructions: str = Field("", max_length=300)
    is_active: bool = True
    sort_order: int = 0


class MedicationPatch(BaseModel):
    version: int
    name: str | None = Field(None, min_length=1, max_length=200)
    form: str | None = Field(None, max_length=60)
    dose: str | None = Field(None, max_length=100)
    frequency: str | None = Field(None, max_length=100)
    duration: str | None = Field(None, max_length=100)
    instructions: str | None = Field(None, max_length=300)
    is_active: bool | None = None
    sort_order: int | None = None


class MedicationOut(_Out):
    name: str
    form: str
    dose: str
    frequency: str
    duration: str
    instructions: str


class LabTestIn(BaseModel):
    code: str = Field("", max_length=30)
    name_ar: str = Field(min_length=1, max_length=200)
    name_en: str = Field(min_length=1, max_length=200)
    unit: str = Field("", max_length=40)
    reference_range: str = Field("", max_length=100)
    is_active: bool = True
    sort_order: int = 0


class LabTestPatch(BaseModel):
    version: int
    code: str | None = Field(None, max_length=30)
    name_ar: str | None = Field(None, min_length=1, max_length=200)
    name_en: str | None = Field(None, min_length=1, max_length=200)
    unit: str | None = Field(None, max_length=40)
    reference_range: str | None = Field(None, max_length=100)
    is_active: bool | None = None
    sort_order: int | None = None


class LabTestOut(_Out):
    code: str
    name_ar: str
    name_en: str
    unit: str
    reference_range: str


router.include_router(
    master_router(
        Medication,
        "/medications",
        out=MedicationOut,
        create=MedicationIn,
        update=MedicationPatch,
        tag="medications",
    )
)
router.include_router(
    master_router(
        LabTest,
        "/lab-tests",
        out=LabTestOut,
        create=LabTestIn,
        update=LabTestPatch,
        tag="lab-tests",
    )
)


# ---------------------------------------------------------------- shared
def _err(code: str, http: int = status.HTTP_422_UNPROCESSABLE_CONTENT, **extra) -> HTTPException:
    return HTTPException(http, detail={"code": code, **extra})


def _patient(db: Session, pid: int) -> Patient:
    p = db.get(Patient, pid)
    if p is None or p.deleted_at is not None:
        raise not_found()
    return p


def _not_blank(v: str | None) -> str | None:
    if v is not None and not v.strip():
        raise ValueError("blank")
    return v


def own_doctor_only(db: Session, doctor_id: int, p: Principal) -> None:
    """A signed-in doctor writes in their own name; staff who are not doctors may choose the doctor."""
    mine = db.scalar(
        select(Doctor.id).where(Doctor.user_id == p.user.id, Doctor.deleted_at.is_(None))
    )
    if mine is not None and mine != doctor_id:
        raise _err("other_doctor")


def _refs(
    db: Session, patient_id: int, doctor_id: int, visit_id: int | None, p: Principal | None = None
) -> None:
    d = db.get(Doctor, doctor_id)
    if d is None or d.deleted_at is not None:
        raise _err("unknown_doctor")
    if p is not None:
        own_doctor_only(db, doctor_id, p)
    if visit_id is not None:
        v = db.get(DentalVisit, visit_id)
        if v is None or v.patient_id != patient_id or v.deleted_at is not None:
            raise _err("unknown_visit")


def _now(db: Session) -> datetime:
    return db.scalar(select(func.now()))


def _own(db: Session, doc, p: Principal) -> bool:
    d = db.get(Doctor, doc.doctor_id)
    return (d is not None and d.user_id == p.user.id) or doc.created_by == p.user.id


def _editable(db: Session, doc, p: Principal, now: datetime) -> bool:
    hours = get_dental_settings(db).edit_hours
    return (
        doc.status != "cancelled"
        and p.can("dental.edit")
        and _own(db, doc, p)
        and now - doc.issued_at <= timedelta(hours=hours)
    )


def _check_edit(db: Session, doc, p: Principal) -> None:
    if doc.status == "cancelled":
        raise _err("document_closed", status.HTTP_409_CONFLICT)
    if not _own(db, doc, p):
        raise _err("not_own_document", status.HTTP_403_FORBIDDEN)
    if not _editable(db, doc, p, _now(db)):
        raise _err(
            "edit_window_closed", status.HTTP_409_CONFLICT, hours=get_dental_settings(db).edit_hours
        )


class _DocOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_id: int
    doctor_id: int
    visit_id: int | None
    issued_at: datetime
    status: str
    cancel_reason: str | None
    notes: str
    created_by: int | None
    updated_at: datetime
    version: int
    editable: bool = False
    doctor_name_ar: str = ""
    doctor_name_en: str = ""
    written_by_name: str | None = None


def _decorate(db: Session, o: _DocOut, doc, p: Principal, now: datetime):
    d = db.get(Doctor, doc.doctor_id)
    o.doctor_name_ar, o.doctor_name_en = (d.name_ar, d.name_en or d.name_ar) if d else ("", "")
    o.written_by_name = (
        db.scalar(select(User.full_name_ar).where(User.id == doc.created_by))
        if doc.created_by
        else None
    )
    o.editable = _editable(db, doc, p, now)
    return o


class CancelIn(BaseModel):
    version: int
    reason: str = Field(min_length=3, max_length=500)


def _cancel(db: Session, doc, body: CancelIn, p: Principal) -> None:
    check_version(doc.version, body.version, updater_name(db, doc), doc.updated_at)
    if doc.status == "cancelled":
        raise _err("document_closed", status.HTTP_409_CONFLICT)
    doc.status = "cancelled"
    doc.cancel_reason = body.reason.strip()
    doc.updated_by = p.user.id


# ---------------------------------------------------------------- prescriptions
class RxItemIn(BaseModel):
    drug: str = Field(min_length=1, max_length=200)
    form: str = Field("", max_length=60)
    dose: str = Field("", max_length=100)
    frequency: str = Field("", max_length=100)
    duration: str = Field("", max_length=100)
    quantity: str = Field("", max_length=60)
    instructions: str = Field("", max_length=300)


class RxIn(BaseModel):
    doctor_id: int
    visit_id: int | None = None
    diagnosis: str = Field("", max_length=1000)
    notes: str = Field("", max_length=2000)
    items: list[RxItemIn] = Field(min_length=1, max_length=20)


class RxPatch(BaseModel):
    version: int
    diagnosis: str | None = Field(None, max_length=1000)
    notes: str | None = Field(None, max_length=2000)
    items: list[RxItemIn] | None = Field(None, min_length=1, max_length=20)


class RxItemOut(RxItemIn):
    model_config = ConfigDict(from_attributes=True)
    seq: int


class RxOut(_DocOut):
    diagnosis: str
    items: list[RxItemOut]


def _rx_out(db, rx: Prescription, p, now=None) -> RxOut:
    return _decorate(db, RxOut.model_validate(rx), rx, p, now or _now(db))


def _get_rx(db: Session, rid: int) -> Prescription:
    rx = db.get(Prescription, rid)
    if rx is None or rx.deleted_at is not None:
        raise not_found()
    return rx


@router.get("/patients/{pid}/prescriptions", response_model=list[RxOut])
def list_prescriptions(pid: int, db: DbSession, p: Principal = Viewer) -> list[RxOut]:
    _patient(db, pid)
    now = _now(db)
    rows = db.scalars(
        select(Prescription)
        .where(Prescription.patient_id == pid, Prescription.deleted_at.is_(None))
        .order_by(Prescription.issued_at.desc())
    )
    log_event(db, "read", "patients", pid, new={"section": "prescriptions"})
    db.commit()
    return [_rx_out(db, r, p, now) for r in rows]


@router.get("/prescriptions/{rid}", response_model=RxOut)
def get_prescription(rid: int, db: DbSession, p: Principal = Viewer) -> RxOut:
    return _rx_out(db, _get_rx(db, rid), p)


@router.post("/patients/{pid}/prescriptions", response_model=RxOut, status_code=201)
def create_prescription(pid: int, body: RxIn, db: DbSession, p: Principal = Editor) -> RxOut:
    _patient(db, pid)
    _refs(db, pid, body.doctor_id, body.visit_id, p)
    rx = Prescription(
        patient_id=pid,
        doctor_id=body.doctor_id,
        visit_id=body.visit_id,
        issued_at=_now(db),
        diagnosis=body.diagnosis.strip(),
        notes=body.notes.strip(),
        created_by=p.user.id,
        updated_by=p.user.id,
        items=[PrescriptionItem(seq=i + 1, **it.model_dump()) for i, it in enumerate(body.items)],
    )
    db.add(rx)
    db.commit()
    db.refresh(rx)
    return _rx_out(db, rx, p)


@router.patch("/prescriptions/{rid}", response_model=RxOut)
def update_prescription(rid: int, body: RxPatch, db: DbSession, p: Principal = Editor) -> RxOut:
    rx = _get_rx(db, rid)
    check_version(rx.version, body.version, updater_name(db, rx), rx.updated_at)
    _check_edit(db, rx, p)
    if body.diagnosis is not None:
        rx.diagnosis = body.diagnosis.strip()
    if body.notes is not None:
        rx.notes = body.notes.strip()
    if body.items is not None:
        rx.items = [
            PrescriptionItem(seq=i + 1, **it.model_dump()) for i, it in enumerate(body.items)
        ]
    rx.updated_by = p.user.id
    db.commit()
    db.refresh(rx)
    return _rx_out(db, rx, p)


@router.post("/prescriptions/{rid}/cancel", response_model=RxOut)
def cancel_prescription(rid: int, body: CancelIn, db: DbSession, p: Principal = Editor) -> RxOut:
    rx = _get_rx(db, rid)
    _cancel(db, rx, body, p)
    db.commit()
    db.refresh(rx)
    return _rx_out(db, rx, p)


# ---------------------------------------------------------------- lab requests and results
Flag = Literal["normal", "low", "high", "abnormal"]


class LabItemIn(BaseModel):
    test_id: int | None = None
    name: str = Field(min_length=1, max_length=200)
    unit: str = Field("", max_length=40)
    reference_range: str = Field("", max_length=100)


class LabIn(BaseModel):
    doctor_id: int
    visit_id: int | None = None
    lab_name: str = Field("", max_length=200)
    clinical_info: str = Field("", max_length=2000)
    notes: str = Field("", max_length=2000)
    items: list[LabItemIn] = Field(min_length=1, max_length=40)


class LabPatch(BaseModel):
    version: int
    lab_name: str | None = Field(None, max_length=200)
    clinical_info: str | None = Field(None, max_length=2000)
    notes: str | None = Field(None, max_length=2000)
    items: list[LabItemIn] | None = Field(None, min_length=1, max_length=40)


class ResultIn(BaseModel):
    seq: int
    result: str = Field("", max_length=200)
    flag: Flag | None = None


class ResultsIn(BaseModel):
    version: int
    results: list[ResultIn] = Field(min_length=1, max_length=40)
    result_note: str = Field("", max_length=2000)


class LabItemOut(LabItemIn):
    model_config = ConfigDict(from_attributes=True)
    seq: int
    result: str
    flag: str | None


class LabOut(_DocOut):
    lab_name: str
    clinical_info: str
    resulted_at: datetime | None
    resulted_by: int | None
    result_note: str
    items: list[LabItemOut]
    resulted_by_name: str | None = None


def _lab_out(db, r: LabRequest, p, now=None) -> LabOut:
    o = _decorate(db, LabOut.model_validate(r), r, p, now or _now(db))
    if r.resulted_by:
        o.resulted_by_name = db.scalar(select(User.full_name_ar).where(User.id == r.resulted_by))
    return o


def _get_lab(db: Session, lid: int) -> LabRequest:
    r = db.get(LabRequest, lid)
    if r is None or r.deleted_at is not None:
        raise not_found()
    return r


def _lab_items(db: Session, items: list[LabItemIn]) -> list[LabRequestItem]:
    out = []
    for i, it in enumerate(items):
        if it.test_id is not None:
            t = db.get(LabTest, it.test_id)
            if t is None or t.deleted_at is not None:
                raise _err("unknown_lab_test", line=i)
        out.append(LabRequestItem(seq=i + 1, **it.model_dump()))
    return out


@router.get("/patients/{pid}/lab-requests", response_model=list[LabOut])
def list_lab_requests(pid: int, db: DbSession, p: Principal = Viewer) -> list[LabOut]:
    _patient(db, pid)
    now = _now(db)
    rows = db.scalars(
        select(LabRequest)
        .where(LabRequest.patient_id == pid, LabRequest.deleted_at.is_(None))
        .order_by(LabRequest.issued_at.desc())
    )
    log_event(db, "read", "patients", pid, new={"section": "lab"})
    db.commit()
    return [_lab_out(db, r, p, now) for r in rows]


@router.get("/lab-requests/{lid}", response_model=LabOut)
def get_lab_request(lid: int, db: DbSession, p: Principal = Viewer) -> LabOut:
    return _lab_out(db, _get_lab(db, lid), p)


@router.post("/patients/{pid}/lab-requests", response_model=LabOut, status_code=201)
def create_lab_request(pid: int, body: LabIn, db: DbSession, p: Principal = Editor) -> LabOut:
    _patient(db, pid)
    _refs(db, pid, body.doctor_id, body.visit_id, p)
    r = LabRequest(
        patient_id=pid,
        doctor_id=body.doctor_id,
        visit_id=body.visit_id,
        issued_at=_now(db),
        lab_name=body.lab_name.strip(),
        clinical_info=body.clinical_info.strip(),
        notes=body.notes.strip(),
        created_by=p.user.id,
        updated_by=p.user.id,
        items=_lab_items(db, body.items),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _lab_out(db, r, p)


@router.patch("/lab-requests/{lid}", response_model=LabOut)
def update_lab_request(lid: int, body: LabPatch, db: DbSession, p: Principal = Editor) -> LabOut:
    r = _get_lab(db, lid)
    check_version(r.version, body.version, updater_name(db, r), r.updated_at)
    _check_edit(db, r, p)
    if r.status == "resulted" and body.items is not None:
        raise _err("lab_already_resulted", status.HTTP_409_CONFLICT)
    for k in ("lab_name", "clinical_info", "notes"):
        v = getattr(body, k)
        if v is not None:
            setattr(r, k, v.strip())
    if body.items is not None:
        r.items = _lab_items(db, body.items)
    r.updated_by = p.user.id
    db.commit()
    db.refresh(r)
    return _lab_out(db, r, p)


@router.post("/lab-requests/{lid}/results", response_model=LabOut)
def enter_results(lid: int, body: ResultsIn, db: DbSession, p: Principal = Editor) -> LabOut:
    """Results from the lab, entered by any doctor (any time while the request is not cancelled)."""
    r = _get_lab(db, lid)
    check_version(r.version, body.version, updater_name(db, r), r.updated_at)
    if r.status == "cancelled":
        raise _err("document_closed", status.HTTP_409_CONFLICT)
    by_seq = {it.seq: it for it in r.items}
    seqs = [res.seq for res in body.results]
    if len(seqs) != len(set(seqs)):
        raise _err("duplicate_lab_item")
    for res in body.results:
        it = by_seq.get(res.seq)
        if it is None:
            raise _err("unknown_lab_item", seq=res.seq)
        it.result = res.result.strip()
        it.flag = res.flag
    r.result_note = body.result_note.strip()
    if any(it.result for it in r.items):
        r.status = "resulted"
        r.resulted_at = _now(db)
        r.resulted_by = p.user.id
    r.updated_by = p.user.id
    db.commit()
    db.refresh(r)
    return _lab_out(db, r, p)


@router.post("/lab-requests/{lid}/cancel", response_model=LabOut)
def cancel_lab_request(lid: int, body: CancelIn, db: DbSession, p: Principal = Editor) -> LabOut:
    r = _get_lab(db, lid)
    _cancel(db, r, body, p)
    db.commit()
    db.refresh(r)
    return _lab_out(db, r, p)


# ---------------------------------------------------------------- medical reports
ReportKind = Literal["report", "referral", "attendance"]


class ReportIn(BaseModel):
    doctor_id: int
    visit_id: int | None = None
    kind: ReportKind = "report"
    language: Literal["ar", "en"] = "ar"
    recipient: str = Field("", max_length=200)
    title: str = Field("", max_length=200)
    body: str = Field(min_length=1, max_length=20000)

    @field_validator("body")
    @classmethod
    def _body(cls, v: str) -> str:
        return _not_blank(v)

    notes: str = Field("", max_length=2000)


class ReportPatch(BaseModel):
    version: int
    kind: ReportKind | None = None
    language: Literal["ar", "en"] | None = None
    recipient: str | None = Field(None, max_length=200)
    title: str | None = Field(None, max_length=200)
    body: str | None = Field(None, min_length=1, max_length=20000)
    notes: str | None = Field(None, max_length=2000)

    @field_validator("body")
    @classmethod
    def _body(cls, v: str | None) -> str | None:
        return _not_blank(v)


class ReportOut(_DocOut):
    kind: str
    language: str
    recipient: str
    title: str
    body: str


def _report_out(db, r: MedicalReport, p, now=None) -> ReportOut:
    return _decorate(db, ReportOut.model_validate(r), r, p, now or _now(db))


def _get_report(db: Session, rid: int) -> MedicalReport:
    r = db.get(MedicalReport, rid)
    if r is None or r.deleted_at is not None:
        raise not_found()
    return r


@router.get("/patients/{pid}/medical-reports", response_model=list[ReportOut])
def list_reports(
    pid: int, db: DbSession, p: Principal = Viewer, kind: str | None = Query(None)
) -> list[ReportOut]:
    _patient(db, pid)
    now = _now(db)
    q = select(MedicalReport).where(
        MedicalReport.patient_id == pid, MedicalReport.deleted_at.is_(None)
    )
    if kind:
        q = q.where(MedicalReport.kind == kind)
    rows = db.scalars(q.order_by(MedicalReport.issued_at.desc()))
    log_event(db, "read", "patients", pid, new={"section": "medical_reports"})
    db.commit()
    return [_report_out(db, r, p, now) for r in rows]


@router.get("/medical-reports/{rid}", response_model=ReportOut)
def get_report(rid: int, db: DbSession, p: Principal = Viewer) -> ReportOut:
    return _report_out(db, _get_report(db, rid), p)


@router.post("/patients/{pid}/medical-reports", response_model=ReportOut, status_code=201)
def create_report(pid: int, body: ReportIn, db: DbSession, p: Principal = Editor) -> ReportOut:
    _patient(db, pid)
    _refs(db, pid, body.doctor_id, body.visit_id, p)
    r = MedicalReport(
        patient_id=pid,
        issued_at=_now(db),
        created_by=p.user.id,
        updated_by=p.user.id,
        **{k: (v.strip() if isinstance(v, str) else v) for k, v in body.model_dump().items()},
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _report_out(db, r, p)


@router.patch("/medical-reports/{rid}", response_model=ReportOut)
def update_report(rid: int, body: ReportPatch, db: DbSession, p: Principal = Editor) -> ReportOut:
    r = _get_report(db, rid)
    check_version(r.version, body.version, updater_name(db, r), r.updated_at)
    _check_edit(db, r, p)
    for k, v in body.model_dump(exclude={"version"}, exclude_none=True).items():
        setattr(r, k, v.strip() if isinstance(v, str) else v)
    r.updated_by = p.user.id
    db.commit()
    db.refresh(r)
    return _report_out(db, r, p)


@router.post("/medical-reports/{rid}/cancel", response_model=ReportOut)
def cancel_report(rid: int, body: CancelIn, db: DbSession, p: Principal = Editor) -> ReportOut:
    r = _get_report(db, rid)
    _cancel(db, r, body, p)
    db.commit()
    db.refresh(r)
    return _report_out(db, r, p)
