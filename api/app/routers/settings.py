from fastapi import APIRouter, Depends

from app.deps import CurrentUser, DbSession, Principal, require
from app.services.settings import SecuritySettings, get_security, save_security

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/security", response_model=SecuritySettings)
def read_security(db: DbSession, _: CurrentUser) -> SecuritySettings:
    return get_security(db)


@router.put("/security", response_model=SecuritySettings)
def write_security(
    body: SecuritySettings, db: DbSession, p: Principal = Depends(require("settings.manage"))
) -> SecuritySettings:
    save_security(db, body, p.user.id)
    db.commit()
    return get_security(db)
