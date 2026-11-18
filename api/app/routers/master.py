"""Settings lists: clinics, departments, appointment statuses, visit types, saved phrases, services."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.crud import master_router
from app.models import (
    AppointmentStatus,
    Clinic,
    Department,
    InsuranceCompany,
    ReferralSource,
    SavedPhrase,
    Service,
    VisitType,
)
from app.schemas_master import (
    ClinicIn,
    ClinicOut,
    ClinicPatch,
    DepartmentIn,
    DepartmentOut,
    DepartmentPatch,
    PhraseIn,
    PhraseOut,
    PhrasePatch,
    ReferralSourceIn,
    ReferralSourceOut,
    ReferralSourcePatch,
    ServiceIn,
    ServiceOut,
    ServicePatch,
    StatusIn,
    StatusOut,
    StatusPatch,
    VisitTypeIn,
    VisitTypeOut,
    VisitTypePatch,
)
from app.schemas_patients import InsuranceCompanyIn, InsuranceCompanyOut, InsuranceCompanyPatch


def _err(code: str, http: int = status.HTTP_422_UNPROCESSABLE_CONTENT, **extra) -> HTTPException:
    return HTTPException(http, detail={"code": code, **extra})


def _check_ref(db: Session, model, ref_id: int | None, code: str) -> None:
    if ref_id is not None:
        obj = db.get(model, ref_id)
        if obj is None or obj.deleted_at is not None:
            raise _err(code)


def _validate_department(db: Session, d: Department) -> None:
    _check_ref(db, Clinic, d.clinic_id, "unknown_clinic")


def _protect_status(s: AppointmentStatus, action: str) -> None:
    # The statuses the system acts on (arrived, cancelled, …) cannot be removed or switched off.
    if s.is_system and (action == "delete" or "is_active" in action):
        raise _err("system_status", status.HTTP_409_CONFLICT)


def _validate_service(db: Session, s: Service) -> None:
    _check_ref(db, Department, s.department_id, "unknown_department")
    if not (s.min_price <= s.sale_price <= s.max_price):
        raise _err("price_range")
    if s.number is None:
        s.number = (db.scalar(select(func.max(Service.number))) or 0) + 1


def _phrase_filter(q, f):
    return q.where(SavedPhrase.field_key == f["field_key"]) if f.get("field_key") else q


router = APIRouter()
router.include_router(
    master_router(
        Clinic, "/clinics", out=ClinicOut, create=ClinicIn, update=ClinicPatch, tag="clinics"
    )
)
router.include_router(
    master_router(
        Department,
        "/departments",
        out=DepartmentOut,
        create=DepartmentIn,
        update=DepartmentPatch,
        tag="departments",
        validate=_validate_department,
    )
)
router.include_router(
    master_router(
        AppointmentStatus,
        "/appointment-statuses",
        out=StatusOut,
        create=StatusIn,
        update=StatusPatch,
        tag="appointment-statuses",
        protect=_protect_status,
    )
)
router.include_router(
    master_router(
        VisitType,
        "/visit-types",
        out=VisitTypeOut,
        create=VisitTypeIn,
        update=VisitTypePatch,
        tag="visit-types",
    )
)
router.include_router(
    master_router(
        ReferralSource,
        "/referral-sources",
        out=ReferralSourceOut,
        create=ReferralSourceIn,
        update=ReferralSourcePatch,
        tag="referral-sources",
    )
)
router.include_router(
    master_router(
        SavedPhrase,
        "/saved-phrases",
        out=PhraseOut,
        create=PhraseIn,
        update=PhrasePatch,
        tag="saved-phrases",
        filters=_phrase_filter,
        order_by=(SavedPhrase.field_key, SavedPhrase.sort_order, SavedPhrase.id),
    )
)
router.include_router(
    master_router(
        Service,
        "/services",
        out=ServiceOut,
        create=ServiceIn,
        update=ServicePatch,
        tag="services",
        validate=_validate_service,
        order_by=(Service.number,),
    )
)
router.include_router(
    master_router(
        InsuranceCompany,
        "/insurance-companies",
        out=InsuranceCompanyOut,
        create=InsuranceCompanyIn,
        update=InsuranceCompanyPatch,
        tag="insurance-companies",
    )
)
