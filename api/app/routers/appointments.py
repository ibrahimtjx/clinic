"""Appointments (SPEC 6): calendar data, booking with warnings, moves, statuses, free slots, waiting list."""

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.crud import not_found, updater_name
from app.deps import DbSession, Principal, check_version, require
from app.models import (
    Appointment,
    AppointmentStatus,
    Doctor,
    Patient,
    PatientInsurance,
    PlanSession,
    Service,
    TreatmentPlan,
    User,
    VisitType,
    WaitingListEntry,
)
from app.schemas_appointments import (
    AppointmentIn,
    AppointmentOut,
    AppointmentPatch,
    FreeSlotOut,
    PatientBrief,
    StatusChange,
    WaitingFromAppointment,
    WaitingIn,
    WaitingOut,
)
from app.services import scheduling
from app.services.scheduling import TZ, local

router = APIRouter(prefix="/appointments", tags=["appointments"])
waiting_router = APIRouter(prefix="/waiting-list", tags=["waiting-list"])

Viewer = Depends(require("appointment.view"))
Creator = Depends(require("appointment.create"))
Editor = Depends(require("appointment.edit"))


def _err(code: str, http: int = status.HTTP_422_UNPROCESSABLE_CONTENT, **extra) -> HTTPException:
    return HTTPException(http, detail={"code": code, **extra})


def _status(db: Session, status_id: int | None = None, key: str | None = None) -> AppointmentStatus:
    q = select(AppointmentStatus).where(AppointmentStatus.deleted_at.is_(None))
    q = (
        q.where(AppointmentStatus.id == status_id)
        if status_id
        else q.where(AppointmentStatus.key == key)
    )
    s = db.scalar(q)
    if s is None or not s.is_active:
        raise _err("unknown_status")
    return s


def _get(db: Session, appt_id: int) -> Appointment:
    a = db.get(Appointment, appt_id)
    if a is None or a.deleted_at is not None:
        raise not_found()
    return a


# ---- output ----
def _briefs(
    db: Session, appts: list[Appointment]
) -> tuple[dict[int, PatientBrief], dict[int, datetime]]:
    pids = {a.patient_id for a in appts}
    if not pids:
        return {}, {}
    patients = {p.id: p for p in db.scalars(select(Patient).where(Patient.id.in_(pids)))}
    insured = set(
        db.scalars(select(PatientInsurance.patient_id).where(PatientInsurance.patient_id.in_(pids)))
    )
    counts = dict(
        db.execute(
            select(Appointment.patient_id, func.count())
            .where(Appointment.patient_id.in_(pids), Appointment.deleted_at.is_(None))
            .group_by(Appointment.patient_id)
        ).all()
    )
    first = dict(
        db.execute(
            select(Appointment.patient_id, func.min(Appointment.starts_at))
            .where(
                Appointment.patient_id.in_(pids),
                Appointment.deleted_at.is_(None),
                Appointment.blocks_slot,
            )
            .group_by(Appointment.patient_id)
        ).all()
    )
    out = {}
    for pid in pids:
        p = patients.get(pid)
        if p is None:
            continue
        out[pid] = PatientBrief(
            id=p.id,
            file_no=p.file_no,
            name_ar=p.name_ar,
            name_en=p.name_en,
            mobile=p.mobile,
            is_insured=pid in insured,
            has_balance=p.balance > 0,
            is_new=False,
            appointment_count=counts.get(pid, 0),
        )
    return out, first


def _out_many(db: Session, appts: list[Appointment]) -> list[AppointmentOut]:
    briefs, first_by_patient = _briefs(db, appts)
    uids = {u for a in appts for u in (a.created_by, a.confirmed_by) if u}
    names = (
        dict(db.execute(select(User.id, User.full_name_ar).where(User.id.in_(uids))).all())
        if uids
        else {}
    )
    out = []
    for a in appts:
        o = AppointmentOut.model_validate(a)
        b = briefs.get(a.patient_id)
        if b:
            first = first_by_patient.get(a.patient_id)
            # "New patient" icon: this is the patient's first slot-blocking appointment.
            o.patient = b.model_copy(update={"is_new": first is None or a.starts_at <= first})
        o.created_by_name = names.get(a.created_by)
        o.confirmed_by_name = names.get(a.confirmed_by)
        out.append(o)
    return out


def _out(db: Session, a: Appointment) -> AppointmentOut:
    return _out_many(db, [a])[0]


# ---- validation ----
def _link_session(db: Session, a: Appointment) -> None:
    """An appointment can book a planned session of the patient's open treatment plan (SPEC 9)."""
    if a.plan_session_id is None:
        return
    s = db.get(PlanSession, a.plan_session_id)
    plan = db.get(TreatmentPlan, s.plan_id) if s else None
    if (
        s is None
        or plan is None
        or plan.patient_id != a.patient_id
        or plan.status in ("completed", "cancelled")
    ):
        raise _err("unknown_plan_session")
    if s.status == "planned":
        s.status = "booked"


def mark_session_done(db: Session, a: Appointment) -> None:
    """Completing the visit marks the linked plan session Done (SPEC 9)."""
    if a.plan_session_id:
        s = db.get(PlanSession, a.plan_session_id)
        if s is not None:
            s.status = "done"


def _check_refs(db: Session, a: Appointment) -> Doctor:
    p = db.get(Patient, a.patient_id)
    if p is None or p.deleted_at is not None:
        raise _err("unknown_patient")
    d = db.get(Doctor, a.doctor_id)
    if d is None or d.deleted_at is not None or not d.is_active:
        raise _err("unknown_doctor")
    if a.visit_type_id is not None:
        v = db.get(VisitType, a.visit_type_id)
        if v is None or v.deleted_at is not None:
            raise _err("unknown_visit_type")
    if a.service_id is not None:
        s = db.get(Service, a.service_id)
        if s is None or s.deleted_at is not None:
            raise _err("unknown_service")
    return d


def _check_overlap(db: Session, a: Appointment) -> None:
    """Friendly pre-check naming the clashing booking. The exclusion constraint still decides races."""
    if not a.blocks_slot:
        return
    q = select(Appointment).where(
        Appointment.doctor_id == a.doctor_id,
        Appointment.blocks_slot,
        Appointment.deleted_at.is_(None),
        Appointment.starts_at < a.ends_at,
        Appointment.ends_at > a.starts_at,
    )
    if a.id:
        q = q.where(Appointment.id != a.id)
    clash = db.scalar(q.limit(1))
    if clash:
        p = db.get(Patient, clash.patient_id)
        raise _err(
            "overlap",
            status.HTTP_409_CONFLICT,
            appointment_id=clash.id,
            starts_at=clash.starts_at.isoformat(),
            ends_at=clash.ends_at.isoformat(),
            patient_name=p.name_ar if p else None,
        )


def _warnings(
    db: Session, a: Appointment, doctor: Doctor, ack: list[str], principal: Principal
) -> None:
    """SPEC 6.3: warn on another appointment the same day and outside working hours. The caller resends
    with `acknowledge` after the user confirms; outside hours also needs appointment.override_hours."""
    found = []
    if not scheduling.within_hours(doctor, a.starts_at, a.ends_at):
        if "outside_hours" in ack and not principal.can("appointment.override_hours"):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail={"code": "forbidden", "missing": ["appointment.override_hours"]},
            )
        if "outside_hours" not in ack:
            found.append("outside_hours")
    if a.blocks_slot and "same_day" not in ack:
        day = local(a.starts_at).date()
        lo = datetime.combine(day, time(), TZ)
        q = (
            select(func.count())
            .select_from(Appointment)
            .where(
                Appointment.patient_id == a.patient_id,
                Appointment.blocks_slot,
                Appointment.deleted_at.is_(None),
                Appointment.starts_at >= lo,
                Appointment.starts_at < lo + timedelta(days=1),
            )
        )
        if a.id:
            q = q.where(Appointment.id != a.id)
        if db.scalar(q):
            found.append("same_day")
    if found:
        raise _err("needs_confirmation", status.HTTP_409_CONFLICT, warnings=found)


# ---- calendar ----
@router.get("", response_model=list[AppointmentOut])
def list_appointments(
    db: DbSession,
    _: Principal = Viewer,
    start: datetime | None = None,
    end: datetime | None = None,
    doctor_ids: str | None = Query(None, description="comma separated"),
    patient_id: int | None = None,
    include_non_blocking: bool = True,
    waiting_only: bool = False,
    limit: int = Query(2000, le=5000),
) -> list[AppointmentOut]:
    q = select(Appointment).where(Appointment.deleted_at.is_(None))
    if start:
        q = q.where(Appointment.ends_at > start)
    if end:
        q = q.where(Appointment.starts_at < end)
    if doctor_ids:
        q = q.where(
            Appointment.doctor_id.in_(
                [int(x) for x in doctor_ids.split(",") if x.strip().isdigit()]
            )
        )
    if patient_id:
        q = q.where(Appointment.patient_id == patient_id)
    if not include_non_blocking:
        q = q.where(Appointment.blocks_slot)
    if waiting_only:
        q = q.where(Appointment.is_waiting_list)
    if not (start or end or patient_id):
        raise _err("range_required")
    return _out_many(
        db, list(db.scalars(q.order_by(Appointment.starts_at, Appointment.id).limit(limit)))
    )


@router.get("/free-slots", response_model=list[FreeSlotOut])
def find_free_slots(
    db: DbSession,
    _: Principal = Viewer,
    duration: int = Query(15, ge=5, le=480, description="minutes"),
    doctor_ids: str | None = None,
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    preferred_from: time | None = None,
    preferred_to: time | None = None,
    weekdays: str | None = None,
    limit: int = Query(20, ge=1, le=100),
) -> list[FreeSlotOut]:
    """Next free slots for a doctor or any doctor (SPEC 6.5)."""
    now = local(db.scalar(select(func.now())))
    start = max(from_date or now.date(), now.date())
    end = to_date or start + timedelta(days=30)
    if (end - start).days > 120:
        raise _err("range_too_long")
    ids = [int(x) for x in doctor_ids.split(",")] if doctor_ids else None
    days = {int(x) for x in weekdays.split(",")} if weekdays else None
    slots = scheduling.free_slots(
        db,
        scheduling.load_doctors(db, ids),
        timedelta(minutes=duration),
        now=now,
        from_date=start,
        to_date=end,
        preferred_from=preferred_from,
        preferred_to=preferred_to,
        weekdays=days,
        limit=limit,
    )
    return [
        FreeSlotOut(doctor_id=s.doctor_id, starts_at=s.starts_at, ends_at=s.ends_at) for s in slots
    ]


@router.get("/{appt_id}", response_model=AppointmentOut)
def get_appointment(appt_id: int, db: DbSession, _: Principal = Viewer) -> AppointmentOut:
    return _out(db, _get(db, appt_id))


@router.post("", response_model=AppointmentOut, status_code=201)
def create_appointment(
    body: AppointmentIn, db: DbSession, p: Principal = Creator
) -> AppointmentOut:
    st = _status(db, body.status_id) if body.status_id else _status(db, key="unconfirmed")
    if st.key == "cancelled":
        raise _err("cannot_create_cancelled")
    a = Appointment(
        **body.model_dump(exclude={"acknowledge", "status_id"}),
        status_id=st.id,
        blocks_slot=st.blocks_slot,
        created_by=p.user.id,
        updated_by=p.user.id,
    )
    doctor = _check_refs(db, a)
    a.clinic_id = doctor.clinic_id
    _link_session(db, a)
    if st.key == "confirmed":
        a.confirmed_by = p.user.id
        a.confirmed_at = func.now()
    _check_overlap(db, a)
    _warnings(db, a, doctor, body.acknowledge, p)
    db.add(a)
    db.commit()
    db.refresh(a)
    return _out(db, a)


@router.patch("/{appt_id}", response_model=AppointmentOut)
def update_appointment(
    appt_id: int, body: AppointmentPatch, db: DbSession, p: Principal = Editor
) -> AppointmentOut:
    """Edit, move (time or doctor) or resize. Moves re-check overlap and warnings (SPEC 6.1)."""
    a = _get(db, appt_id)
    check_version(a.version, body.version, updater_name(db, a), a.updated_at)
    changes = body.model_dump(exclude_unset=True, exclude={"version", "acknowledge"})
    for k, v in changes.items():
        setattr(a, k, v)
    if a.ends_at <= a.starts_at:
        raise _err("invalid_times")
    doctor = _check_refs(db, a)
    a.clinic_id = doctor.clinic_id
    if "plan_session_id" in changes:
        _link_session(db, a)
    if {"starts_at", "ends_at", "doctor_id"} & changes.keys():
        _check_overlap(db, a)
        _warnings(db, a, doctor, body.acknowledge, p)
    a.updated_by = p.user.id
    db.commit()
    db.refresh(a)
    return _out(db, a)


@router.post("/{appt_id}/status", response_model=AppointmentOut)
def change_status(
    appt_id: int, body: StatusChange, db: DbSession, p: Principal = Editor
) -> AppointmentOut:
    a = _get(db, appt_id)
    check_version(a.version, body.version, updater_name(db, a), a.updated_at)
    st = _status(db, body.status_id)
    if st.key == "cancelled":
        if not (body.cancel_reason or "").strip():
            raise _err("cancel_reason_required")
        a.cancel_reason = body.cancel_reason.strip()
    was_blocking = a.blocks_slot
    a.status_id = st.id
    a.blocks_slot = st.blocks_slot  # copied in the same transaction (SPEC 14)
    if st.key == "confirmed" and a.confirmed_at is None:
        a.confirmed_by = p.user.id
        a.confirmed_at = func.now()
    if st.blocks_slot and not was_blocking:
        _check_overlap(db, a)  # e.g. reinstating a cancelled booking whose slot was taken
    if st.key == "completed":
        mark_session_done(db, a)
        patient = db.get(Patient, a.patient_id)
        if patient.last_visit_at is None or patient.last_visit_at < a.starts_at:
            patient.last_visit_at = a.starts_at
    a.updated_by = p.user.id
    db.commit()
    db.refresh(a)
    return _out(db, a)


@router.delete("/{appt_id}", status_code=204)
def delete_appointment(
    appt_id: int, db: DbSession, p: Principal = Depends(require("appointment.delete"))
) -> None:
    """Soft delete for entries made by mistake; real cancellations use the Cancelled status."""
    a = _get(db, appt_id)
    a.deleted_at = db.scalar(select(func.now()))
    a.deleted_by = p.user.id
    a.updated_by = p.user.id
    db.commit()


@router.post("/{appt_id}/waiting-list", response_model=WaitingOut, status_code=201)
def move_to_waiting_list(
    appt_id: int, body: WaitingFromAppointment, db: DbSession, p: Principal = Editor
) -> WaitingOut:
    """The patient keeps this booking but wants an earlier slot (SPEC 6.2 "Move to waiting list")."""
    a = _get(db, appt_id)
    a.is_waiting_list = True
    a.updated_by = p.user.id
    w = WaitingListEntry(
        patient_id=a.patient_id,
        appointment_id=a.id,
        doctor_id=body.doctor_id or a.doctor_id,
        preferred_days=",".join(map(str, body.preferred_days)),
        preferred_from=_hhmm(body.preferred_from),
        preferred_to=_hhmm(body.preferred_to),
        note=body.note.strip(),
        created_by=p.user.id,
        updated_by=p.user.id,
    )
    db.add(w)
    db.commit()
    return _waiting_out(db, [w])[0]


# ---- waiting list (SPEC 6.6) ----
def _waiting_out(db: Session, rows: list[WaitingListEntry]) -> list[WaitingOut]:
    pats = (
        {
            p.id: p
            for p in db.scalars(select(Patient).where(Patient.id.in_({r.patient_id for r in rows})))
        }
        if rows
        else {}
    )
    appts = (
        dict(
            db.execute(
                select(Appointment.id, Appointment.starts_at).where(
                    Appointment.id.in_({r.appointment_id for r in rows if r.appointment_id})
                )
            ).all()
        )
        if rows
        else {}
    )
    out = []
    for r in rows:
        p = pats[r.patient_id]
        out.append(
            WaitingOut(
                id=r.id,
                patient_id=r.patient_id,
                patient_name_ar=p.name_ar,
                patient_name_en=p.name_en,
                patient_file_no=p.file_no,
                patient_mobile=p.mobile,
                doctor_id=r.doctor_id,
                appointment_id=r.appointment_id,
                appointment_starts_at=appts.get(r.appointment_id),
                preferred_days=[int(x) for x in r.preferred_days.split(",") if x],
                preferred_from=r.preferred_from,
                preferred_to=r.preferred_to,
                note=r.note,
                created_at=r.created_at,
                resolved_at=r.resolved_at,
                version=r.version,
            )
        )
    return out


def _hhmm(t: time | None) -> str | None:
    return t.strftime("%H:%M") if t else None


@waiting_router.get("", response_model=list[WaitingOut])
def list_waiting(
    db: DbSession,
    _: Principal = Viewer,
    include_resolved: bool = False,
    doctor_id: int | None = None,
) -> list[WaitingOut]:
    q = select(WaitingListEntry)
    if not include_resolved:
        q = q.where(WaitingListEntry.resolved_at.is_(None))
    if doctor_id:
        q = q.where(
            or_(WaitingListEntry.doctor_id == doctor_id, WaitingListEntry.doctor_id.is_(None))
        )
    return _waiting_out(db, list(db.scalars(q.order_by(WaitingListEntry.created_at))))


@waiting_router.post("", response_model=WaitingOut, status_code=201)
def add_waiting(body: WaitingIn, db: DbSession, p: Principal = Creator) -> WaitingOut:
    pt = db.get(Patient, body.patient_id)
    if pt is None or pt.deleted_at is not None:
        raise _err("unknown_patient")
    if body.doctor_id is not None and db.get(Doctor, body.doctor_id) is None:
        raise _err("unknown_doctor")
    w = WaitingListEntry(
        patient_id=body.patient_id,
        doctor_id=body.doctor_id,
        appointment_id=body.appointment_id,
        preferred_days=",".join(map(str, body.preferred_days)),
        preferred_from=_hhmm(body.preferred_from),
        preferred_to=_hhmm(body.preferred_to),
        note=body.note.strip(),
        created_by=p.user.id,
        updated_by=p.user.id,
    )
    db.add(w)
    db.commit()
    return _waiting_out(db, [w])[0]


@waiting_router.post("/{entry_id}/resolve", response_model=WaitingOut)
def resolve_waiting(entry_id: int, db: DbSession, p: Principal = Creator) -> WaitingOut:
    w = db.get(WaitingListEntry, entry_id)
    if w is None:
        raise not_found()
    if w.resolved_at is None:
        w.resolved_at = db.scalar(select(func.now()))
        w.resolved_by = p.user.id
        if w.appointment_id:
            a = db.get(Appointment, w.appointment_id)
            if a:
                a.is_waiting_list = False
        db.commit()
    return _waiting_out(db, [w])[0]


@waiting_router.get("/matches", response_model=list[WaitingOut])
def matches_for_slot(
    db: DbSession,
    _: Principal = Viewer,
    doctor_id: int = Query(),
    starts_at: datetime = Query(),
    ends_at: datetime = Query(),
) -> list[WaitingOut]:
    """Open entries that would take this freed slot: same doctor or any, preferred day and time (SPEC 6.6)."""
    s, e = local(starts_at), local(ends_at)
    wd = scheduling.weekday_sun0(s.date())
    rows = db.scalars(
        select(WaitingListEntry)
        .where(
            WaitingListEntry.resolved_at.is_(None),
            or_(WaitingListEntry.doctor_id == doctor_id, WaitingListEntry.doctor_id.is_(None)),
            or_(
                WaitingListEntry.preferred_days == "",
                WaitingListEntry.preferred_days.contains(str(wd)),
            ),
            or_(
                WaitingListEntry.preferred_from.is_(None),
                WaitingListEntry.preferred_from <= s.strftime("%H:%M"),
            ),
            or_(
                WaitingListEntry.preferred_to.is_(None),
                WaitingListEntry.preferred_to >= e.strftime("%H:%M"),
            ),
        )
        .order_by(WaitingListEntry.created_at)
    ).all()
    out = []
    for r in rows:
        if r.appointment_id:
            a = db.get(Appointment, r.appointment_id)
            if a and a.starts_at <= starts_at:  # already booked earlier than this slot
                continue
        out.append(r)
    return _waiting_out(db, out)
