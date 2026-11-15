"""Schemas for settings and master data (M2)."""

from datetime import datetime, time
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator

# Theme color names the UI can render as soft tints (SPEC 4.2: no hard-coded colors).
Color = Literal[
    "neutral", "red", "pink", "grape", "violet", "indigo", "blue", "cyan", "teal", "green", "lime", "yellow", "orange"
]

# Money travels as a decimal string with 2 places (SPEC 2: never float).
Money = Annotated[
    Decimal,
    Field(ge=0, max_digits=12, decimal_places=2),
    PlainSerializer(lambda v: f"{v:.2f}", return_type=str),
]
Percent = Annotated[
    Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2), PlainSerializer(lambda v: f"{v:.2f}", return_type=str)
]

Name = Annotated[str, Field(min_length=1, max_length=150)]

PHRASE_FIELDS = (
    "appointment_note",
    "chief_complaint",
    "diagnosis",
    "procedure",
    "preventive_advice",
    "complications",
    "patient_education",
    "next_visit",
    "reception_note",
)
PhraseField = Literal[
    "appointment_note",
    "chief_complaint",
    "diagnosis",
    "procedure",
    "preventive_advice",
    "complications",
    "patient_education",
    "next_visit",
    "reception_note",
]


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    sort_order: int
    version: int
    updated_at: datetime
    deleted_at: datetime | None


class _Base(BaseModel):
    @field_validator("*", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v


# ---- clinics and departments ----
class ClinicIn(_Base):
    name_ar: Name
    name_en: Name
    is_active: bool = True


class ClinicPatch(_Base):
    version: int
    name_ar: Name | None = None
    name_en: Name | None = None
    is_active: bool | None = None


class ClinicOut(_Out):
    name_ar: str
    name_en: str


class DepartmentIn(ClinicIn):
    clinic_id: int | None = None


class DepartmentPatch(ClinicPatch):
    clinic_id: int | None = None


class DepartmentOut(ClinicOut):
    clinic_id: int | None


# ---- appointment statuses and visit types ----
class StatusIn(_Base):
    key: str = Field(min_length=2, max_length=40, pattern=r"^[a-z][a-z0-9_]*$")
    name_ar: Name
    name_en: Name
    color: Color
    blocks_slot: bool
    is_active: bool = True


class StatusPatch(_Base):
    version: int
    name_ar: Name | None = None
    name_en: Name | None = None
    color: Color | None = None
    blocks_slot: bool | None = None
    is_active: bool | None = None


class StatusOut(_Out):
    key: str
    name_ar: str
    name_en: str
    color: str
    blocks_slot: bool
    is_system: bool


class VisitTypeIn(_Base):
    name_ar: Name
    name_en: Name
    color: Color = "neutral"
    is_active: bool = True


class VisitTypePatch(_Base):
    version: int
    name_ar: Name | None = None
    name_en: Name | None = None
    color: Color | None = None
    is_active: bool | None = None


class VisitTypeOut(_Out):
    name_ar: str
    name_en: str
    color: str


# ---- saved phrases ----
class PhraseIn(_Base):
    field_key: PhraseField
    text: str = Field(min_length=1, max_length=1000)
    is_active: bool = True


class PhrasePatch(_Base):
    version: int
    text: str | None = Field(None, min_length=1, max_length=1000)
    is_active: bool | None = None


class PhraseOut(_Out):
    field_key: str
    text: str


# ---- services ----
class ServiceIn(_Base):
    code: str = Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    name_ar: str = Field(min_length=1, max_length=200)
    name_en: str = Field(min_length=1, max_length=200)
    department_id: int | None = None
    sale_price: Money = Decimal(0)
    min_price: Money = Decimal(0)
    max_price: Money = Decimal(0)
    cost_price: Money = Decimal(0)
    vat_applicable: bool = True
    is_consultation: bool = False
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()


class ServicePatch(_Base):
    version: int
    code: str | None = Field(None, min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    name_ar: str | None = Field(None, min_length=1, max_length=200)
    name_en: str | None = Field(None, min_length=1, max_length=200)
    department_id: int | None = None
    sale_price: Money | None = None
    min_price: Money | None = None
    max_price: Money | None = None
    cost_price: Money | None = None
    vat_applicable: bool | None = None
    is_consultation: bool | None = None
    is_active: bool | None = None


class ServiceOut(_Out):
    number: int
    code: str
    name_ar: str
    name_en: str
    department_id: int | None
    sale_price: Money
    min_price: Money
    max_price: Money
    cost_price: Money
    vat_applicable: bool
    is_consultation: bool


# ---- doctors ----
class ScheduleItem(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start_time: time
    end_time: time
    kind: Literal["work", "break"] = "work"


class CommissionRuleItem(BaseModel):
    department_id: int | None = None
    service_id: int | None = None
    percent: Percent


class DoctorIn(_Base):
    user_id: int | None = None
    name_ar: Name
    name_en: str = Field("", max_length=150)
    specialty_ar: str = Field("", max_length=150)
    specialty_en: str = Field("", max_length=150)
    clinic_id: int | None = None
    department_id: int | None = None
    color: Color = "blue"
    slot_minutes: int = Field(15, ge=5, le=240)
    is_active: bool = True
    schedules: list[ScheduleItem] = []
    commission_rules: list[CommissionRuleItem] = []


class DoctorPatch(_Base):
    version: int
    user_id: int | None = None
    name_ar: Name | None = None
    name_en: str | None = Field(None, max_length=150)
    specialty_ar: str | None = Field(None, max_length=150)
    specialty_en: str | None = Field(None, max_length=150)
    clinic_id: int | None = None
    department_id: int | None = None
    color: Color | None = None
    slot_minutes: int | None = Field(None, ge=5, le=240)
    is_active: bool | None = None
    schedules: list[ScheduleItem] | None = None
    commission_rules: list[CommissionRuleItem] | None = None


class ScheduleOut(ScheduleItem):
    model_config = ConfigDict(from_attributes=True)
    id: int


class CommissionRuleOut(CommissionRuleItem):
    model_config = ConfigDict(from_attributes=True)
    id: int


class DoctorOut(_Out):
    user_id: int | None
    name_ar: str
    name_en: str
    specialty_ar: str
    specialty_en: str
    clinic_id: int | None
    department_id: int | None
    color: str
    slot_minutes: int
    schedules: list[ScheduleOut]
    # Only for users with settings.manage or report.financial; null for everyone else.
    commission_rules: list[CommissionRuleOut] | None
