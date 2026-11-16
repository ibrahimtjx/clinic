from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.settings import SecuritySettings


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RoleOut(ORM):
    id: int
    key: str
    name_ar: str
    name_en: str
    is_system: bool
    permissions: list[str] = Field(validation_alias="permission_keys")
    version: int


class RoleRef(ORM):
    id: int
    key: str
    name_ar: str
    name_en: str


class Preferences(BaseModel):
    lang: Literal["ar", "en"] | None = None
    theme: Literal["light", "dark"] | None = None
    digits: Literal["latn", "arab"] | None = None


class MeOut(BaseModel):
    id: int
    username: str
    full_name_ar: str
    full_name_en: str
    roles: list[RoleRef]
    permissions: list[str]
    has_pin: bool
    must_change_password: bool
    preferences: Preferences
    security: SecuritySettings


class TokenOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: MeOut


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=200)


class PinLoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    pin: str = Field(min_length=1, max_length=10)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(max_length=200)


class SetPinIn(BaseModel):
    password: str = Field(max_length=200)
    pin: str = Field(max_length=10)


class UserOut(ORM):
    id: int
    username: str
    full_name_ar: str
    full_name_en: str
    is_active: bool
    department_id: int | None
    roles: list[RoleRef]
    has_pin: bool
    locked_until: datetime | None
    failed_logins: int
    must_change_password: bool
    created_at: datetime
    updated_at: datetime
    version: int


class DirectoryEntry(ORM):
    id: int
    full_name_ar: str
    full_name_en: str
    roles: list[RoleRef]


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9._-]+$")
    full_name_ar: str = Field(min_length=1, max_length=150)
    full_name_en: str = Field("", max_length=150)
    password: str = Field(max_length=200)
    role_ids: list[int] = Field(min_length=1)
    department_id: int | None = None

    @field_validator("full_name_ar", "full_name_en")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


class UserUpdate(BaseModel):
    version: int
    full_name_ar: str | None = Field(None, min_length=1, max_length=150)
    full_name_en: str | None = Field(None, max_length=150)
    role_ids: list[int] | None = Field(None, min_length=1)
    department_id: int | None = None  # send null to clear


class ResetPasswordIn(BaseModel):
    new_password: str = Field(max_length=200)


class RoleCreate(BaseModel):
    key: str = Field(min_length=2, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    name_ar: str = Field(min_length=1, max_length=100)
    name_en: str = Field(min_length=1, max_length=100)
    permissions: list[str] = []


class RoleUpdate(BaseModel):
    version: int
    name_ar: str | None = Field(None, min_length=1, max_length=100)
    name_en: str | None = Field(None, min_length=1, max_length=100)
    permissions: list[str] | None = None


class PermissionOut(BaseModel):
    key: str
    group: str


class AuditOut(ORM):
    id: int
    at: datetime
    user_id: int | None
    user_name: str | None = None
    machine: str | None
    ip: str | None
    table_name: str
    record_id: str | None
    action: str
    old_json: dict | None
    new_json: dict | None


class Page[T](BaseModel):
    items: list[T]
    next_cursor: int | None = None
