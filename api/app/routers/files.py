"""Patient images and documents (SPEC 8.5)."""

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import log_event
from app.crud import not_found, updater_name
from app.deps import DbSession, Principal, check_version, require
from app.models import DentalVisit, Patient, PatientFile, User
from app.models.clinical import FILE_KINDS
from app.routers.dental import valid_tooth
from app.services import files as storage
from app.services.scheduling import local

router = APIRouter(tags=["files"])
View = Depends(require("file.view"))
Upload = Depends(require("file.upload"))
Kind = Literal[FILE_KINDS]  # type: ignore[valid-type]


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_id: int
    visit_id: int | None
    tooth_fdi: int | None
    kind: str
    title: str
    taken_on: date
    original_name: str
    content_type: str
    size: int
    sha256: str
    width: int | None
    height: int | None
    has_thumb: bool
    created_at: datetime
    created_by: int | None
    updated_at: datetime
    version: int
    uploaded_by_name: str | None = None


class FilePatch(BaseModel):
    version: int
    kind: Kind | None = None
    title: str | None = Field(None, max_length=200)
    taken_on: date | None = None
    visit_id: int | None = None
    tooth_fdi: int | None = None
    clear_visit: bool = False
    clear_tooth: bool = False


def _err(code: str, http: int = status.HTTP_422_UNPROCESSABLE_CONTENT, **extra) -> HTTPException:
    return HTTPException(http, detail={"code": code, **extra})


def _patient(db: Session, pid: int) -> Patient:
    p = db.get(Patient, pid)
    if p is None or p.deleted_at is not None:
        raise not_found()
    return p


def _get(db: Session, fid: int) -> PatientFile:
    f = db.get(PatientFile, fid)
    if f is None or f.deleted_at is not None:
        raise not_found()
    return f


def _check_links(db: Session, patient_id: int, visit_id: int | None, tooth: int | None) -> None:
    if visit_id is not None:
        v = db.get(DentalVisit, visit_id)
        if v is None or v.patient_id != patient_id or v.deleted_at is not None:
            raise _err("unknown_visit")
    if tooth is not None and not valid_tooth(tooth):
        raise _err("invalid_teeth")


def _out(db: Session, rows: list[PatientFile]) -> list[FileOut]:
    ids = {r.created_by for r in rows if r.created_by}
    names = (
        dict(db.execute(select(User.id, User.full_name_ar).where(User.id.in_(ids))).all())
        if ids
        else {}
    )
    out = []
    for r in rows:
        o = FileOut.model_validate(r)
        o.uploaded_by_name = names.get(r.created_by)
        out.append(o)
    return out


@router.get("/patients/{pid}/files", response_model=list[FileOut])
def list_files(
    pid: int,
    db: DbSession,
    p: Principal = View,
    kind: str | None = None,
    visit_id: int | None = None,
    tooth: int | None = None,
) -> list[FileOut]:
    _patient(db, pid)
    q = select(PatientFile).where(PatientFile.patient_id == pid, PatientFile.deleted_at.is_(None))
    if kind:
        q = q.where(PatientFile.kind == kind)
    if visit_id:
        q = q.where(PatientFile.visit_id == visit_id)
    if tooth:
        q = q.where(PatientFile.tooth_fdi == tooth)
    rows = list(db.scalars(q.order_by(PatientFile.taken_on.desc(), PatientFile.id.desc())))
    # Medical images are part of the record: opening them is logged like the dental tab (SPEC 3.4).
    log_event(db, "read", "patients", pid, new={"section": "files"})
    db.commit()
    return _out(db, rows)


@router.post("/patients/{pid}/files", response_model=FileOut, status_code=201)
async def upload_file(
    pid: int,
    file: Annotated[UploadFile, File()],
    db: DbSession,
    p: Principal = Upload,
    kind: Annotated[Kind, Form()] = "other",
    title: Annotated[str, Form(max_length=200)] = "",
    taken_on: Annotated[date | None, Form()] = None,
    visit_id: Annotated[int | None, Form()] = None,
    tooth_fdi: Annotated[int | None, Form()] = None,
) -> FileOut:
    _patient(db, pid)
    _check_links(db, pid, visit_id, tooth_fdi)
    today = local(db.scalar(select(func.now()))).date()
    if taken_on and taken_on > today:
        raise _err("date_in_future")
    stored = await storage.store(file, today)
    row = PatientFile(
        patient_id=pid,
        visit_id=visit_id,
        tooth_fdi=tooth_fdi,
        kind=kind,
        title=title.strip(),
        taken_on=taken_on or today,
        path=stored.path,
        original_name=(file.filename or "file")[:255],
        content_type=stored.content_type,
        size=stored.size,
        sha256=stored.sha256,
        width=stored.width,
        height=stored.height,
        has_thumb=stored.has_thumb,
        created_by=p.user.id,
        updated_by=p.user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(db, [row])[0]


@router.get("/files/{fid}/content")
def file_content(
    fid: int, db: DbSession, p: Principal = View, download: bool = Query(False)
) -> FileResponse:
    f = _get(db, fid)
    path = storage.absolute(f.path)
    if not path.exists():
        raise _err("file_missing", status.HTTP_410_GONE)
    return FileResponse(
        path,
        media_type=f.content_type,
        filename=f.original_name,
        content_disposition_type="attachment" if download else "inline",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"},
    )


@router.get("/files/{fid}/thumb")
def file_thumb(fid: int, db: DbSession, p: Principal = View) -> FileResponse:
    f = _get(db, fid)
    if not f.has_thumb:
        raise not_found()
    path = storage.thumb_path(storage.absolute(f.path))
    if not path.exists():
        raise not_found()
    return FileResponse(
        path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"}
    )


@router.patch("/files/{fid}", response_model=FileOut)
def update_file(fid: int, body: FilePatch, db: DbSession, p: Principal = Upload) -> FileOut:
    f = _get(db, fid)
    check_version(f.version, body.version, updater_name(db, f), f.updated_at)
    visit = (
        None if body.clear_visit else (body.visit_id if body.visit_id is not None else f.visit_id)
    )
    tooth = (
        None
        if body.clear_tooth
        else (body.tooth_fdi if body.tooth_fdi is not None else f.tooth_fdi)
    )
    _check_links(db, f.patient_id, visit, tooth)
    f.visit_id, f.tooth_fdi = visit, tooth
    if body.kind is not None:
        f.kind = body.kind
    if body.title is not None:
        f.title = body.title.strip()
    if body.taken_on is not None:
        if body.taken_on > local(db.scalar(select(func.now()))).date():
            raise _err("date_in_future")
        f.taken_on = body.taken_on
    f.updated_by = p.user.id
    db.commit()
    db.refresh(f)
    return _out(db, [f])[0]


@router.delete("/files/{fid}", status_code=204)
def delete_file(fid: int, db: DbSession, p: Principal = Depends(require("file.delete"))) -> None:
    """Soft delete: the file stays on disk and in backups; it disappears from the patient's files."""
    f = _get(db, fid)
    f.deleted_at = db.scalar(select(func.now()))
    f.deleted_by = p.user.id
    db.commit()
