"""Reports API (SPEC 11): catalog, filter options, run, Excel export. PDF comes from the print view."""

from datetime import date
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import ValidationError
from sqlalchemy import func, select

from app.audit import log_event
from app.deps import DbSession, Principal, require
from app.models import Clinic, Doctor, InsuranceCompany, Patient, Receipt, User
from app.reports import financial, operational  # noqa: F401  (registers the reports)
from app.reports.engine import REGISTRY, Filters, Report, Spec, fmt
from app.reports.excel import to_xlsx
from app.services.settings import get_clinic_info

router = APIRouter(prefix="/reports", tags=["reports"])
REPORT_PERMS = ("report.revenue", "report.financial", "report.clinical", "report.operational")


def _any(p: Principal, perms: tuple[str, ...]) -> bool:
    return any(p.can(x) for x in perms)


def _spec(key: str, p: Principal) -> Spec:
    spec = REGISTRY.get(key)
    if spec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})
    if not _any(p, spec.perms):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "missing": list(spec.perms)}
        )
    return spec


@router.get("")
def catalog(p: Principal = Depends(require())) -> list[dict]:
    return [
        {
            "key": s.key,
            "title_ar": s.ar,
            "title_en": s.en,
            "group": s.group,
            "filters": list(s.filters),
            "description_ar": s.description_ar,
            "description_en": s.description_en,
        }
        for s in REGISTRY.values()
        if _any(p, s.perms)
    ]


@router.get("/options")
def options(db: DbSession, p: Principal = Depends(require())) -> dict:
    """Choices for the filter panel."""
    if not _any(p, REPORT_PERMS) and not p.can("invoice.view"):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "missing": list(REPORT_PERMS)}
        )
    cashiers = select(Receipt.received_by).distinct()
    return {
        "users": [
            {"id": i, "name_ar": a, "name_en": e}
            for i, a, e in db.execute(
                select(User.id, User.full_name_ar, User.full_name_en)
                .where(User.id.in_(cashiers))
                .order_by(User.full_name_ar)
            )
        ],
        "doctors": [
            {"id": i, "name_ar": a, "name_en": e}
            for i, a, e in db.execute(
                select(Doctor.id, Doctor.name_ar, Doctor.name_en)
                .where(Doctor.deleted_at.is_(None))
                .order_by(Doctor.sort_order)
            )
        ],
        "clinics": [
            {"id": i, "name_ar": a, "name_en": e}
            for i, a, e in db.execute(
                select(Clinic.id, Clinic.name_ar, Clinic.name_en)
                .where(Clinic.deleted_at.is_(None))
                .order_by(Clinic.sort_order)
            )
        ],
        "companies": [
            {"id": i, "name_ar": a, "name_en": e}
            for i, a, e in db.execute(
                select(InsuranceCompany.id, InsuranceCompany.name_ar, InsuranceCompany.name_en)
                .where(InsuranceCompany.deleted_at.is_(None))
                .order_by(InsuranceCompany.sort_order)
            )
        ],
    }


def _filters(
    date_from: date | None = None,
    date_to: date | None = None,
    user_id: int | None = None,
    doctor_id: int | None = None,
    patient_id: int | None = None,
    clinic_id: int | None = None,
    method: str | None = None,
    company_id: int | None = None,
) -> Filters:
    try:
        return Filters(
            date_from=date_from,
            date_to=date_to,
            user_id=user_id,
            doctor_id=doctor_id,
            patient_id=patient_id,
            clinic_id=clinic_id,
            method=method,
            company_id=company_id,
        )
    except ValidationError as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "invalid_filters",
                "errors": e.errors(include_url=False, include_context=False),
            },
        ) from None


def _run(db, spec: Spec, f: Filters) -> Report:
    if "patient_required" in spec.filters and not f.patient_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": "patient_required"}
        )
    if "day" in spec.filters and f.date_from and not f.date_to:
        f.date_to = f.date_from
    return spec.run(db, f)


def _period(f: Filters) -> str:
    if f.date_from and f.date_to and f.date_from == f.date_to:
        return f"{f.date_from:%d/%m/%Y}"
    if f.date_from or f.date_to:
        a = f"{f.date_from:%d/%m/%Y}" if f.date_from else "…"
        b = f"{f.date_to:%d/%m/%Y}" if f.date_to else "…"
        return f"{a} – {b}"
    return ""


def _row(r: dict, cols) -> dict:
    """Every field of the row; columns get their type, extra fields (e.g. *_en twins) are text."""
    types = {c.key: c.type for c in cols}
    return {k: fmt(v, types.get(k, "text")) for k, v in r.items()}


@router.get("/{key}")
def run_report(
    key: str, db: DbSession, f: Filters = Depends(_filters), p: Principal = Depends(require())
) -> dict:
    spec = _spec(key, p)
    rep = _run(db, spec, f)
    patient = db.get(Patient, f.patient_id) if f.patient_id else None
    return {
        "key": spec.key,
        "title_ar": spec.ar,
        "title_en": spec.en,
        "period": _period(f),
        "patient": {"id": patient.id, "name_ar": patient.name_ar, "file_no": patient.file_no}
        if patient
        else None,
        "generated_at": db.scalar(select(func.now())).isoformat(),
        "sections": [
            {
                "key": s.key,
                "title_ar": s.ar,
                "title_en": s.en,
                "columns": [
                    {"key": c.key, "ar": c.ar, "en": c.en, "type": c.type} for c in s.columns
                ],
                "rows": [_row(r, s.columns) for r in s.rows],
                "totals": {
                    c.key: fmt(s.totals[c.key], c.type)
                    for c in s.columns
                    if s.totals and c.key in s.totals
                }
                if s.totals
                else None,
            }
            for s in rep.sections
        ],
        "summary": [
            {"ar": i.ar, "en": i.en, "type": i.type, "value": fmt(i.value, i.type)}
            for i in rep.summary
        ],
        "notes_ar": rep.notes_ar,
        "notes_en": rep.notes_en,
    }


@router.get("/{key}/excel")
def export_excel(
    key: str,
    db: DbSession,
    f: Filters = Depends(_filters),
    lang: Literal["ar", "en"] = Query("ar"),
    p: Principal = Depends(require()),
) -> Response:
    spec = _spec(key, p)
    rep = _run(db, spec, f)
    now = db.scalar(select(func.now()))
    data = to_xlsx(spec, rep, get_clinic_info(db).model_dump(), _period(f), lang, now)
    # Exports leave the system with patient data: record who took what (SPEC 3.4).
    log_event(
        db,
        "report_export",
        "reports",
        None,
        new={"report": key, **f.model_dump(mode="json", exclude_none=True)},
    )
    db.commit()
    name = f"{spec.en.replace(' ', '-').lower()}-{now:%Y%m%d}.xlsx"
    return Response(
        data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
    )
