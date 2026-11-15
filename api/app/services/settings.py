from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.models import Setting


class SecuritySettings(BaseModel):
    """SPEC 3.3 defaults; editable in Settings → Security."""

    auto_lock_minutes: int = Field(5, ge=1, le=120)
    lockout_attempts: int = Field(5, ge=3, le=20)
    lockout_minutes: int = Field(15, ge=1, le=240)


SECURITY_KEY = "security"


def get_security(db: Session) -> SecuritySettings:
    row = db.get(Setting, SECURITY_KEY)
    return SecuritySettings(**(row.value_json if row else {}))


def save_security(db: Session, value: SecuritySettings, user_id: int) -> Setting:
    row = db.get(Setting, SECURITY_KEY)
    if row is None:
        row = Setting(key=SECURITY_KEY, value_json=value.model_dump(), updated_by=user_id)
        db.add(row)
    else:
        row.value_json = value.model_dump()
        row.updated_by = user_id
    return row


class ClinicInfo(BaseModel):
    """Clinic details for the app header, letterhead and invoices (SPEC 12, 10.7)."""

    name_ar: str = Field("", max_length=200)
    name_en: str = Field("", max_length=200)
    address_ar: str = Field("", max_length=500)
    address_en: str = Field("", max_length=500)
    phone: str = Field("", max_length=40)
    email: str = Field("", max_length=120)
    vat_number: str = Field("", max_length=15, pattern=r"^(\d{15})?$")
    cr_number: str = Field("", max_length=20, pattern=r"^(\d{10})?$")


CLINIC_KEY = "clinic"


def get_clinic_info(db: Session) -> ClinicInfo:
    row = db.get(Setting, CLINIC_KEY)
    return ClinicInfo(**(row.value_json if row else {}))


def save_setting(db: Session, key: str, value: BaseModel, user_id: int) -> None:
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value_json=value.model_dump(), updated_by=user_id))
    else:
        row.value_json = value.model_dump()
        row.updated_by = user_id


class QueueSettings(BaseModel):
    """Wait-time colors on the queue board (SPEC 7.1)."""

    warn_minutes: int = Field(15, ge=1, le=240)
    late_minutes: int = Field(30, ge=2, le=480)


QUEUE_KEY = "queue"


def get_queue_settings(db: Session) -> QueueSettings:
    row = db.get(Setting, QUEUE_KEY)
    return QueueSettings(**(row.value_json if row else {}))
