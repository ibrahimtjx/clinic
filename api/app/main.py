from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.config import get_settings
from app.db import get_db
from app.routers import audit, auth, roles, users
from app.routers import settings as settings_router

settings = get_settings()

# Served behind Caddy at /api (prefix stripped; uvicorn runs with --root-path /api).
app = FastAPI(title="Clinic API", version=settings.app_version)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(roles.router)
app.include_router(settings_router.router)
app.include_router(audit.router)

DbSession = Annotated[Session, Depends(get_db)]


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
