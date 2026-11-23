"""Doctors work with their own patients and documents only (owner, 2026-11-23).

A user linked to a doctor record is limited to that doctor unless they hold `appointment.view_all`
("see every doctor's appointments and data", e.g. a doctor who also manages the clinic). Staff who are
not doctors (reception, accountant, manager, admin) are not limited by this.

A doctor's patients: anyone with an appointment, a queue entry, a visit, a bill, a quotation or a
treatment plan with that doctor, or whose usual doctor they are.
"""

from fastapi import HTTPException, status
from sqlalchemy import exists, select, union
from sqlalchemy.orm import Session

from app.deps import Principal
from app.models import (
    Appointment,
    DentalVisit,
    Doctor,
    Patient,
    PaymentOrder,
    QueueEntry,
    Quotation,
    TreatmentPlan,
)


def scoped_doctor(db: Session, p: Principal) -> int | None:
    """The doctor id this user is limited to, or None for the whole clinic."""
    if p.can("appointment.view_all"):
        return None
    return db.scalar(
        select(Doctor.id).where(Doctor.user_id == p.user.id, Doctor.deleted_at.is_(None))
    )


def doctor_patient_ids(doctor_id: int):
    return union(
        select(Appointment.patient_id).where(
            Appointment.doctor_id == doctor_id, Appointment.deleted_at.is_(None)
        ),
        select(QueueEntry.patient_id).where(QueueEntry.doctor_id == doctor_id),
        select(DentalVisit.patient_id).where(DentalVisit.doctor_id == doctor_id),
        select(PaymentOrder.patient_id).where(PaymentOrder.doctor_id == doctor_id),
        select(Quotation.patient_id).where(Quotation.doctor_id == doctor_id),
        select(TreatmentPlan.patient_id).where(TreatmentPlan.doctor_id == doctor_id),
        select(Patient.id).where(Patient.default_doctor_id == doctor_id),
    )


def patient_scope(db: Session, p: Principal):
    """A where-clause limiting Patient rows to this user's patients, or None."""
    d = scoped_doctor(db, p)
    return None if d is None else Patient.id.in_(doctor_patient_ids(d))


def check_patient(db: Session, p: Principal, patient_id: int) -> None:
    """Not found for a patient who is not this doctor's (no hint that the patient exists)."""
    d = scoped_doctor(db, p)
    if d is None:
        return
    ids = doctor_patient_ids(d).subquery()
    if not db.scalar(select(exists().where(ids.c[0] == patient_id))):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})


def check_doctor(db: Session, p: Principal, doctor_id: int | None, *, hide: bool = False) -> None:
    """A document of another doctor: refused (403), or not found when `hide` (reading)."""
    d = scoped_doctor(db, p)
    if d is None or doctor_id == d:
        return
    if hide:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})
    raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "other_doctor"})


def own_doctor_id(db: Session, p: Principal, doctor_id: int | None) -> int | None:
    """The doctor a new document is written for: a doctor writes in their own name (filled in when
    left empty); anyone else may choose."""
    d = scoped_doctor(db, p)
    if d is None:
        return doctor_id
    if doctor_id is not None and doctor_id != d:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "other_doctor"})
    return d
