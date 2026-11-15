"""Working hours and free slots (SPEC 6.3, 6.5). All calendar logic runs in clinic local time."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Appointment, Doctor

TZ = ZoneInfo("Asia/Riyadh")


def local(dt: datetime) -> datetime:
    return dt.astimezone(TZ)


def weekday_sun0(d: date) -> int:
    """0 = Sunday … 6 = Saturday (the schedule convention)."""
    return (d.weekday() + 1) % 7


@dataclass(frozen=True)
class Span:
    start: datetime
    end: datetime

    def overlaps(self, other: "Span") -> bool:
        return self.start < other.end and other.start < self.end


def day_spans(doctor: Doctor, day: date) -> tuple[list[Span], list[Span]]:
    """(working periods, breaks) for `doctor` on local date `day`."""
    wd = weekday_sun0(day)
    work, breaks = [], []
    for s in doctor.schedules:
        if s.weekday != wd:
            continue
        span = Span(datetime.combine(day, s.start_time, TZ), datetime.combine(day, s.end_time, TZ))
        (work if s.kind == "work" else breaks).append(span)
    return work, breaks


def within_hours(doctor: Doctor, start: datetime, end: datetime) -> bool:
    """True when [start, end) lies inside one working period and touches no break."""
    s, e = local(start), local(end)
    if s.date() != (e - timedelta(microseconds=1)).date():
        return False
    work, breaks = day_spans(doctor, s.date())
    span = Span(s, e)
    return any(w.start <= s and e <= w.end for w in work) and not any(
        b.overlaps(span) for b in breaks
    )


def busy_spans(
    db: Session,
    doctor_ids: Iterable[int],
    start: datetime,
    end: datetime,
    exclude_id: int | None = None,
) -> dict[int, list[Span]]:
    q = select(Appointment.doctor_id, Appointment.starts_at, Appointment.ends_at).where(
        Appointment.doctor_id.in_(list(doctor_ids)),
        Appointment.blocks_slot,
        Appointment.deleted_at.is_(None),
        Appointment.starts_at < end,
        Appointment.ends_at > start,
    )
    if exclude_id:
        q = q.where(Appointment.id != exclude_id)
    out: dict[int, list[Span]] = {}
    for doc, s, e in db.execute(q):
        out.setdefault(doc, []).append(Span(local(s), local(e)))
    return out


@dataclass
class FreeSlot:
    doctor_id: int
    starts_at: datetime
    ends_at: datetime


def free_slots(
    db: Session,
    doctors: list[Doctor],
    duration: timedelta,
    *,
    now: datetime,
    from_date: date,
    to_date: date,
    preferred_from: time | None = None,
    preferred_to: time | None = None,
    weekdays: set[int] | None = None,
    limit: int = 20,
) -> list[FreeSlot]:
    """Earliest free slots across `doctors`, stepping by each doctor's slot length, never in the past."""
    start = datetime.combine(from_date, time(), TZ)
    end = datetime.combine(to_date + timedelta(days=1), time(), TZ)
    busy = busy_spans(db, [d.id for d in doctors], start, end)
    found: list[FreeSlot] = []
    day = from_date
    while day <= to_date and len(found) < limit:
        if weekdays is None or weekday_sun0(day) in weekdays:
            for d in doctors:
                step = timedelta(minutes=d.slot_minutes)
                work, breaks = day_spans(d, day)
                blocked = breaks + busy.get(d.id, [])
                for w in sorted(work, key=lambda x: x.start):
                    t = w.start
                    while t + duration <= w.end:
                        cand = Span(t, t + duration)
                        ok = (
                            t >= now
                            and (preferred_from is None or t.time() >= preferred_from)
                            and (preferred_to is None or (t + duration).time() <= preferred_to)
                            and not any(b.overlaps(cand) for b in blocked)
                        )
                        if ok:
                            found.append(FreeSlot(d.id, t, t + duration))
                        t += step
        day += timedelta(days=1)
    found.sort(key=lambda f: (f.starts_at, f.doctor_id))
    return found[:limit]


def load_doctors(db: Session, ids: list[int] | None) -> list[Doctor]:
    q = select(Doctor).where(Doctor.deleted_at.is_(None), Doctor.is_active)
    if ids:
        q = q.where(Doctor.id.in_(ids))
    return list(db.scalars(q.order_by(Doctor.sort_order, Doctor.id)))
