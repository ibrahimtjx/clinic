from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.config import get_settings
from app.db import get_db
from app.routers import (
    appointments,
    audit,
    auth,
    billing,
    dental,
    doctors,
    master,
    patients,
    queue,
    roles,
    users,
)
from app.routers import settings as settings_router

settings = get_settings()

# Served behind Caddy at /api (prefix stripped; uvicorn runs with --root-path /api).
app = FastAPI(title="Clinic API", version=settings.app_version)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(roles.router)
app.include_router(settings_router.router)
app.include_router(audit.router)
app.include_router(master.router)
app.include_router(doctors.router)
app.include_router(patients.router)
app.include_router(patients.assignments_router)
app.include_router(appointments.router)
app.include_router(appointments.waiting_router)
app.include_router(queue.router)
app.include_router(queue.settings_router)
app.include_router(dental.router)
app.include_router(billing.router)

DbSession = Annotated[Session, Depends(get_db)]


@app.exception_handler(IntegrityError)
async def _integrity(_request: Request, exc: IntegrityError) -> JSONResponse:
    """Database constraints are the last line of defence; report them as client errors."""
    diag = getattr(exc.orig, "diag", None)
    constraint = getattr(diag, "constraint_name", None)
    sqlstate = getattr(exc.orig, "sqlstate", None)
    if sqlstate == "23505":
        return JSONResponse(status_code=409, content={"detail": {"code": "duplicate", "constraint": constraint}})
    if sqlstate == "23503":
        return JSONResponse(status_code=422, content={"detail": {"code": "invalid_reference", "constraint": constraint}})
    if sqlstate == "23P01":
        return JSONResponse(status_code=409, content={"detail": {"code": "overlap", "constraint": constraint}})
    return JSONResponse(status_code=422, content={"detail": {"code": "constraint", "constraint": constraint}})


@app.exception_handler(StaleDataError)
async def _stale(_request: Request, _exc: StaleDataError) -> JSONResponse:
    """Two saves of the same record raced; the later one lost (SPEC 3.6)."""
    return JSONResponse(status_code=409, content={"detail": {"code": "stale_record", "updated_by": None}})


@app.get("/health")
def health(db: DbSession) -> dict:
    row = db.execute(text("SELECT now() AS now, current_setting('TimeZone') AS tz")).one()
    return {
        "status": "ok",
        "version": settings.app_version,
        "database": "ok",
        "server_time": row.now.isoformat(),
        "timezone": row.tz,
    }
