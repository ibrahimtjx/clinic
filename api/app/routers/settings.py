from fastapi import APIRouter, Depends

from app.deps import CurrentUser, DbSession, Principal, require
from app.services import numbering
from app.services.settings import (
    CLINIC_KEY,
    WHATSAPP_KEY,
    ClinicInfo,
    SecuritySettings,
    WhatsAppSettings,
    get_clinic_info,
    get_security,
    get_whatsapp_settings,
    save_security,
    save_setting,
)

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


@router.get("/clinic", response_model=ClinicInfo)
def read_clinic(db: DbSession, _: CurrentUser) -> ClinicInfo:
    return get_clinic_info(db)


@router.put("/clinic", response_model=ClinicInfo)
def write_clinic(
    body: ClinicInfo, db: DbSession, p: Principal = Depends(require("settings.manage"))
) -> ClinicInfo:
    save_setting(db, CLINIC_KEY, body, p.user.id)
    db.commit()
    return get_clinic_info(db)


@router.get("/numbering")
def read_numbering(db: DbSession, _: Principal = Depends(require("settings.manage"))) -> dict:
    """Formats and the next number per document type (read-only counters)."""
    return numbering.preview(db)


@router.put("/numbering")
def write_numbering(
    body: numbering.NumberFormats, db: DbSession, p: Principal = Depends(require("settings.manage"))
) -> dict:
    save_setting(db, numbering.KEY, body, p.user.id)
    db.commit()
    return numbering.preview(db)


@router.get("/whatsapp", response_model=WhatsAppSettings)
def read_whatsapp(db: DbSession, _: CurrentUser) -> WhatsAppSettings:
    return get_whatsapp_settings(db)


@router.put("/whatsapp", response_model=WhatsAppSettings)
def write_whatsapp(
    body: WhatsAppSettings, db: DbSession, p: Principal = Depends(require("settings.manage"))
) -> WhatsAppSettings:
    save_setting(db, WHATSAPP_KEY, body, p.user.id)
    db.commit()
    return get_whatsapp_settings(db)
