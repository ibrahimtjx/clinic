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
