"""Patient schemas (SPEC 5.3)."""

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator

from app.schemas_master import _Out

MoneyOut = Annotated[Decimal, PlainSerializer(lambda v: f"{v:.2f}", return_type=str)]

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def _digits(v: str | None) -> str | None:
    """Accept Arabic-Indic digits and spaces/dashes as typed; store plain Western digits."""
    if v is None:
        return None
    v = re.sub(r"[\s\-]", "", v.translate(_AR_DIGITS))
    return v or None


class InsuranceIn(BaseModel):
    company_id: int
    policy_no: str = Field("", max_length=60)
    class_name: str = Field("", max_length=60)
    class_id: int | None = None
    membership_no: str = Field("", max_length=60)
    expiry: date | None = None


class InsuranceOut(InsuranceIn):
    model_config = ConfigDict(from_attributes=True)
    company_name_ar: str | None = None
    company_name_en: str | None = None


class _PatientFields(BaseModel):
    secondary_file_no: str | None = Field(None, max_length=30)
    name_ar: str | None = Field(None, min_length=2, max_length=200)
    name_en: str | None = Field(None, max_length=200)
    national_id: str | None = None
    nationality: str | None = Field(None, pattern=r"^[A-Z]{2}$")
    gender: Literal["male", "female"] | None = None
    dob: date | None = None
    mobile: str | None = None
    phone: str | None = Field(None, max_length=20)
    emergency_name: str | None = Field(None, max_length=200)
    emergency_phone: str | None = Field(None, max_length=20)
    default_doctor_id: int | None = None
    is_external: bool | None = None
    sms_opt_out: bool | None = None
    chronic_diseases: str | None = Field(None, max_length=2000)
    allergies: str | None = Field(None, max_length=2000)
    referral_source: str | None = Field(None, max_length=100)
    notes: str | None = Field(None, max_length=4000)
    insurance: InsuranceIn | None = None

    @field_validator("*", mode="before")
    @classmethod
    def _strip(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("national_id", "mobile", "phone", "emergency_phone", mode="before")
    @classmethod
    def _norm_digits(cls, v):
        return _digits(v) if isinstance(v, str) else v

    @field_validator("national_id")
    @classmethod
    def _nid(cls, v):
        if v is not None and not re.fullmatch(r"\d{10}", v):
            raise ValueError("national_id must be 10 digits")
        return v

    @field_validator("mobile")
    @classmethod
    def _mobile(cls, v):
        if v is not None and not re.fullmatch(r"05\d{8}", v):
            raise ValueError("mobile must be 05XXXXXXXX")
        return v

    @field_validator("dob")
    @classmethod
    def _dob(cls, v):
        if v is not None and (v > date.today() or v.year < 1900):
            raise ValueError("date of birth out of range")
        return v


class PatientCreate(_PatientFields):
    name_ar: str = Field(min_length=2, max_length=200)
    # SPEC 5.3: warn on a duplicate ID or mobile; the user may confirm and continue.
    allow_duplicate: bool = False


class PatientUpdate(_PatientFields):
    version: int
    clear_insurance: bool = False


class HealthIn(BaseModel):
    version: int
    chronic_diseases: str = Field("", max_length=2000)
    allergies: str = Field("", max_length=2000)
    medications: str = Field("", max_length=4000)
    medical_history: str = Field("", max_length=8000)


class HealthOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    chronic_diseases: str
    allergies: str
    medications: str
    medical_history: str
    version: int


class PatientListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    file_no: int
    name_ar: str
    name_en: str
    mobile: str | None
    national_id: str | None
    default_doctor_id: int | None
    insurance_company_id: int | None = None
    balance: MoneyOut
    last_visit_at: datetime | None
    created_at: datetime
    is_active: bool


class PatientPage(BaseModel):
    items: list[PatientListItem]
    total: int


class PatientQuick(BaseModel):
    """Compact row for the global search and command palette."""

    model_config = ConfigDict(from_attributes=True)
    id: int
    file_no: int
    name_ar: str
    name_en: str
    mobile: str | None
    national_id: str | None
    is_active: bool


class PatientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    version: int
    updated_at: datetime
    deleted_at: datetime | None
    file_no: int
    secondary_file_no: str | None
    name_ar: str
    name_en: str
    national_id: str | None
    nationality: str | None
    gender: str | None
    dob: date | None
    mobile: str | None
    phone: str | None
    emergency_name: str | None
    emergency_phone: str | None
    default_doctor_id: int | None
    is_external: bool
    sms_opt_out: bool
    chronic_diseases: str
    allergies: str
    referral_source: str | None
    notes: str
    balance: MoneyOut
    deposit_balance: MoneyOut
    last_visit_at: datetime | None
    created_at: datetime
    created_by: int | None
    insurance: InsuranceOut | None


class DuplicateOut(BaseModel):
    id: int
    file_no: int
    name_ar: str
    name_en: str
    matched_on: list[Literal["national_id", "mobile"]]


class AssignmentIn(BaseModel):
    assigned_to: int
    note: str = Field(min_length=1, max_length=1000)


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_id: int
    patient_name_ar: str | None = None
    patient_name_en: str | None = None
    patient_file_no: int | None = None
    assigned_to: int
    assigned_to_name: str | None = None
    assigned_by: int
    assigned_by_name: str | None = None
    note: str
    created_at: datetime
    done_at: datetime | None


class InsuranceCompanyIn(BaseModel):
    code: str = Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    name_ar: str = Field(min_length=1, max_length=200)
    name_en: str = Field(min_length=1, max_length=200)
    is_active: bool = True


class InsuranceCompanyPatch(BaseModel):
    version: int
    code: str | None = Field(None, min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    name_ar: str | None = Field(None, min_length=1, max_length=200)
    name_en: str | None = Field(None, min_length=1, max_length=200)
    is_active: bool | None = None


class InsuranceCompanyOut(_Out):
    code: str
    name_ar: str
    name_en: str
