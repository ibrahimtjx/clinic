from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

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
