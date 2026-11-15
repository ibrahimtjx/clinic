"""Patient queue (SPEC 7): send to doctor → call → start → finish, board data and report."""

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.crud import not_found
from app.deps import DbSession, Principal, require
from app.models import (
    Appointment,
    AppointmentStatus,
    Doctor,
    NumberSequence,
    Patient,
    QueueEntry,
    User,
)
from app.services.scheduling import local
from app.services.settings import QUEUE_KEY, QueueSettings, get_queue_settings, save_setting

router = APIRouter(prefix="/queue", tags=["queue"])
Viewer = Depends(require("queue.view"))
Manager = Depends(require("queue.manage"))


class SendIn(BaseModel):
    patient_id: int
    doctor_id: int
    appointment_id: int | None = None
    note: str = Field("", max_length=1000)


class TransferIn(BaseModel):
    doctor_id: int


class NoteIn(BaseModel):
    note: str = Field(max_length=1000)


class QueueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    day: date
    queue_no: int
    patient_id: int
    doctor_id: int
    clinic_id: int | None
    appointment_id: int | None
    received_at: datetime
    received_by: int
    called_at: datetime | None
    called_by: int | None
    entered_at: datetime | None
    entered_by: int | None
    exited_at: datetime | None
    exited_by: int | None
    postponed: bool
    note: str
    cancelled_at: datetime | None
    version: int
    stage: str = "waiting"
    waited_minutes: int = 0
    patient_name_ar: str = ""
    patient_name_en: str = ""
    patient_file_no: int = 0
    visit_type_id: int | None = None
    user_names: dict[str, str | None] = {}


class QueueReport(BaseModel):
    items: list[QueueOut]
    total: int
    seen: int
    not_seen: int
    average_wait_minutes: float | None


def _err(code: str, http: int = status.HTTP_409_CONFLICT, **extra) -> HTTPException:
    return HTTPException(http, detail={"code": code, **extra})


def _stage(q: QueueEntry) -> str:
    if q.cancelled_at:
        return "left"
    if q.exited_at:
        return "done"
    if q.entered_at:
        return "with_doctor"
    if q.called_at:
        return "called"
    return "waiting"


def _out(db: Session, rows: list[QueueEntry], now: datetime) -> list[QueueOut]:
    pats = (
        {
            p.id: p
            for p in db.scalars(select(Patient).where(Patient.id.in_({r.patient_id for r in rows})))
        }
        if rows
        else {}
    )
    appt_types = (
        dict(
            db.execute(
                select(Appointment.id, Appointment.visit_type_id).where(
                    Appointment.id.in_({r.appointment_id for r in rows if r.appointment_id})
                )
            ).all()
        )
        if rows
        else {}
    )
    uids = {u for r in rows for u in (r.received_by, r.called_by, r.entered_by, r.exited_by) if u}
    names = (
        dict(db.execute(select(User.id, User.full_name_ar).where(User.id.in_(uids))).all())
        if uids
        else {}
    )
    out = []
    for r in rows:
        o = QueueOut.model_validate(r)
        o.stage = _stage(r)
        # Minutes waited: until the doctor started, or until now while still waiting.
        end = r.entered_at or r.cancelled_at or now
        o.waited_minutes = max(0, int((end - r.received_at).total_seconds() // 60))
        p = pats.get(r.patient_id)
        if p:
            o.patient_name_ar, o.patient_name_en, o.patient_file_no = (
                p.name_ar,
                p.name_en,
                p.file_no,
            )
        o.visit_type_id = appt_types.get(r.appointment_id)
        o.user_names = {
            k: names.get(getattr(r, k))
            for k in ("received_by", "called_by", "entered_by", "exited_by")
        }
        out.append(o)
    return out


def _now(db: Session) -> datetime:
    return db.scalar(select(func.now()))


def _next_no(db: Session, day: date) -> int:
    """Daily queue number, allocated under a row lock (same scheme as document numbers)."""
    key = f"queue-{day:%Y%m%d}"
    db.execute(
        insert(NumberSequence).values(doc_type=key, year=0, next_value=1).on_conflict_do_nothing()
    )
    seq = db.execute(
        select(NumberSequence)
        .where(NumberSequence.doc_type == key, NumberSequence.year == 0)
        .with_for_update()
    ).scalar_one()
    n = seq.next_value
    seq.next_value = n + 1
    return n


def _set_appt_status(
    db: Session, appt_id: int | None, key: str, user_id: int, only_from: set[str] | None = None
) -> None:
    """Keep the linked appointment in step with the queue (Arrived → With doctor → Completed)."""
    if not appt_id:
        return
    a = db.get(Appointment, appt_id)
    st = db.scalar(select(AppointmentStatus).where(AppointmentStatus.key == key))
    if a is None or a.deleted_at is not None or st is None:
        return
    current = db.get(AppointmentStatus, a.status_id)
    if current.key in ("cancelled", "no_show") or (
        only_from is not None and current.key not in only_from
    ):
        return
    a.status_id = st.id
    a.blocks_slot = st.blocks_slot
    a.updated_by = user_id
    if key == "completed":
        p = db.get(Patient, a.patient_id)
        if p.last_visit_at is None or p.last_visit_at < a.starts_at:
            p.last_visit_at = a.starts_at


def _get(db: Session, entry_id: int) -> QueueEntry:
    q = db.get(QueueEntry, entry_id)
    if q is None:
        raise not_found()
    return q


@router.get("", response_model=list[QueueOut])
def board(
    db: DbSession, _: Principal = Viewer, day: date | None = None, doctor_id: int | None = None
) -> list[QueueOut]:
    now = _now(db)
    d = day or local(now).date()
    q = select(QueueEntry).where(QueueEntry.day == d)
    if doctor_id:
        q = q.where(QueueEntry.doctor_id == doctor_id)
    # Postponed patients go to the back of the waiting line.
    rows = list(db.scalars(q.order_by(QueueEntry.postponed, QueueEntry.queue_no)))
    return _out(db, rows, now)


@router.get("/report", response_model=QueueReport)
def report(
    db: DbSession,
    _: Principal = Viewer,
    from_day: date = Query(alias="from"),
    to_day: date = Query(alias="to"),
    doctor_id: int | None = None,
    clinic_id: int | None = None,
    user_id: int | None = None,
) -> QueueReport:
    """Table view and waiting-time totals (SPEC 7.2, 11.2)."""
    if (to_day - from_day).days > 366:
        raise _err("range_too_long", status.HTTP_422_UNPROCESSABLE_CONTENT)
    q = select(QueueEntry).where(QueueEntry.day >= from_day, QueueEntry.day <= to_day)
    if doctor_id:
        q = q.where(QueueEntry.doctor_id == doctor_id)
    if clinic_id:
        q = q.where(QueueEntry.clinic_id == clinic_id)
    if user_id:
        q = q.where(QueueEntry.received_by == user_id)
    rows = list(db.scalars(q.order_by(QueueEntry.day, QueueEntry.queue_no)))
    items = _out(db, rows, _now(db))
    seen = [i for i in items if i.entered_at]
    waits = [i.waited_minutes for i in seen]
    return QueueReport(
        items=items,
        total=len(items),
        seen=len(seen),
        not_seen=len(items) - len(seen),
        average_wait_minutes=round(sum(waits) / len(waits), 1) if waits else None,
    )


@router.post("", response_model=QueueOut, status_code=201)
def send_to_doctor(body: SendIn, db: DbSession, p: Principal = Manager) -> QueueOut:
    """Reception sends a patient to a doctor: from an appointment, the profile, or a walk-in (SPEC 7.3)."""
    now = _now(db)
    day = local(now).date()
    patient = db.get(Patient, body.patient_id)
    if patient is None or patient.deleted_at is not None:
        raise _err("unknown_patient", status.HTTP_422_UNPROCESSABLE_CONTENT)
    doctor = db.get(Doctor, body.doctor_id)
    if doctor is None or doctor.deleted_at is not None or not doctor.is_active:
        raise _err("unknown_doctor", status.HTTP_422_UNPROCESSABLE_CONTENT)
    if body.appointment_id:
        a = db.get(Appointment, body.appointment_id)
        if a is None or a.patient_id != patient.id or a.deleted_at is not None:
            raise _err("unknown_appointment", status.HTTP_422_UNPROCESSABLE_CONTENT)
    already = db.scalar(
        select(QueueEntry).where(
            QueueEntry.day == day,
            QueueEntry.patient_id == patient.id,
            QueueEntry.exited_at.is_(None),
            QueueEntry.cancelled_at.is_(None),
        )
    )
    if already:
        raise _err("already_in_queue", queue_no=already.queue_no, entry_id=already.id)
    q = QueueEntry(
        day=day,
        queue_no=_next_no(db, day),
        patient_id=patient.id,
        doctor_id=doctor.id,
        clinic_id=doctor.clinic_id,
        appointment_id=body.appointment_id,
        received_at=now,
        received_by=p.user.id,
        note=body.note.strip(),
        created_by=p.user.id,
        updated_by=p.user.id,
    )
    db.add(q)
    _set_appt_status(
        db,
        body.appointment_id,
        "arrived",
        p.user.id,
        only_from={"unconfirmed", "confirmed", "postponed"},
    )
    db.commit()
    db.refresh(q)
    return _out(db, [q], now)[0]


def _step(db: Session, entry_id: int, p: Principal, action: str) -> QueueOut:
    q = _get(db, entry_id)
    now = _now(db)
    if q.cancelled_at or q.exited_at:
        raise _err("queue_closed")
    if action == "call":
        q.called_at, q.called_by = now, p.user.id
        q.postponed = False
    elif action == "start":
        if q.entered_at is None:
            q.entered_at, q.entered_by = now, p.user.id
            if q.called_at is None:
                q.called_at, q.called_by = now, p.user.id
            _set_appt_status(db, q.appointment_id, "with_doctor", p.user.id)
    elif action == "finish":
        if q.entered_at is None:
            raise _err("not_started")
        q.exited_at, q.exited_by = now, p.user.id
        _set_appt_status(db, q.appointment_id, "completed", p.user.id)
    elif action == "postpone":
        if q.entered_at:
            raise _err("already_with_doctor")
        q.postponed = True
        q.called_at = q.called_by = None
    elif action == "left":
        if q.entered_at:
            raise _err("already_with_doctor")
        q.cancelled_at = now
    q.updated_by = p.user.id
    db.commit()
    db.refresh(q)
    return _out(db, [q], now)[0]


@router.post("/{entry_id}/call", response_model=QueueOut)
def call(entry_id: int, db: DbSession, p: Principal = Manager) -> QueueOut:
    return _step(db, entry_id, p, "call")


@router.post("/{entry_id}/start", response_model=QueueOut)
def start(entry_id: int, db: DbSession, p: Principal = Manager) -> QueueOut:
    return _step(db, entry_id, p, "start")


@router.post("/{entry_id}/finish", response_model=QueueOut)
def finish(entry_id: int, db: DbSession, p: Principal = Manager) -> QueueOut:
    return _step(db, entry_id, p, "finish")


@router.post("/{entry_id}/postpone", response_model=QueueOut)
def postpone(entry_id: int, db: DbSession, p: Principal = Manager) -> QueueOut:
    return _step(db, entry_id, p, "postpone")


@router.post("/{entry_id}/left", response_model=QueueOut)
def left_without_being_seen(entry_id: int, db: DbSession, p: Principal = Manager) -> QueueOut:
    return _step(db, entry_id, p, "left")


@router.post("/{entry_id}/transfer", response_model=QueueOut)
def transfer(entry_id: int, body: TransferIn, db: DbSession, p: Principal = Manager) -> QueueOut:
    """Send to another doctor: back to Waiting for that doctor (SPEC 7.1)."""
    q = _get(db, entry_id)
    if q.cancelled_at or q.exited_at or q.entered_at:
        raise _err("queue_closed")
    doctor = db.get(Doctor, body.doctor_id)
    if doctor is None or doctor.deleted_at is not None or not doctor.is_active:
        raise _err("unknown_doctor", status.HTTP_422_UNPROCESSABLE_CONTENT)
    q.doctor_id, q.clinic_id = doctor.id, doctor.clinic_id
    q.called_at = q.called_by = None
    q.updated_by = p.user.id
    db.commit()
    db.refresh(q)
    return _out(db, [q], _now(db))[0]


@router.post("/{entry_id}/note", response_model=QueueOut)
def add_note(entry_id: int, body: NoteIn, db: DbSession, p: Principal = Manager) -> QueueOut:
    q = _get(db, entry_id)
    q.note = body.note.strip()
    q.updated_by = p.user.id
    db.commit()
    db.refresh(q)
    return _out(db, [q], _now(db))[0]


settings_router = APIRouter(prefix="/settings", tags=["settings"])


@settings_router.get("/queue", response_model=QueueSettings)
def read_queue_settings(db: DbSession, _: Principal = Viewer) -> QueueSettings:
    return get_queue_settings(db)


@settings_router.put("/queue", response_model=QueueSettings)
def write_queue_settings(
    body: QueueSettings, db: DbSession, p: Principal = Depends(require("settings.manage"))
) -> QueueSettings:
    if body.late_minutes <= body.warn_minutes:
        raise _err("late_before_warn", status.HTTP_422_UNPROCESSABLE_CONTENT)
    save_setting(db, QUEUE_KEY, body, p.user.id)
    db.commit()
    return get_queue_settings(db)
