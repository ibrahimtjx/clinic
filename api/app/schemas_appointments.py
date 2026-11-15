"""Appointment schemas (SPEC 6)."""

from datetime import datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Warning = Literal["same_day", "outside_hours"]


class AppointmentIn(BaseModel):
    patient_id: int
    doctor_id: int
    starts_at: datetime
    ends_at: datetime
    visit_type_id: int | None = None
    service_id: int | None = None
    status_id: int | None = None  # default: Unconfirmed
    is_waiting_list: bool = False
    note: str = Field("", max_length=2000)
    exclude_sms: bool = False
    # Warnings the user has seen and chosen to continue past (SPEC 6.3).
    acknowledge: list[Warning] = []

    @model_validator(mode="after")
    def _times(self):
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError("times must include a UTC offset")
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        if (self.ends_at - self.starts_at).total_seconds() > 8 * 3600:
            raise ValueError("appointment longer than 8 hours")
        return self


class AppointmentPatch(BaseModel):
    version: int
    doctor_id: int | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    visit_type_id: int | None = None
    service_id: int | None = None
    is_waiting_list: bool | None = None
    note: str | None = Field(None, max_length=2000)
    exclude_sms: bool | None = None
    acknowledge: list[Warning] = []

    @field_validator("starts_at", "ends_at")
    @classmethod
    def _tz(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("times must include a UTC offset")
        return v


class StatusChange(BaseModel):
    version: int
    status_id: int
    cancel_reason: str | None = Field(None, max_length=1000)
    acknowledge: list[Warning] = []


class PatientBrief(BaseModel):
    id: int
    file_no: int
    name_ar: str
    name_en: str
    mobile: str | None
    is_insured: bool
    has_balance: bool
    is_new: bool
    appointment_count: int


class AppointmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_id: int
    doctor_id: int
    clinic_id: int | None
    starts_at: datetime
    ends_at: datetime
    status_id: int
    blocks_slot: bool
    visit_type_id: int | None
    service_id: int | None
    is_waiting_list: bool
    note: str
    exclude_sms: bool
    confirmed_by: int | None
    confirmed_at: datetime | None
    cancel_reason: str | None
    created_by: int | None
    created_at: datetime
    updated_at: datetime
    version: int
    deleted_at: datetime | None
    patient: PatientBrief | None = None
    created_by_name: str | None = None
    confirmed_by_name: str | None = None


class FreeSlotOut(BaseModel):
    doctor_id: int
    starts_at: datetime
    ends_at: datetime


class WaitingFromAppointment(BaseModel):
    doctor_id: int | None = None
    preferred_days: list[int] = Field(default_factory=list)
    preferred_from: time | None = None
    preferred_to: time | None = None
    note: str = Field("", max_length=1000)

    @field_validator("preferred_days")
    @classmethod
    def _days(cls, v):
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("weekday 0-6")
        return sorted(set(v))


class WaitingIn(WaitingFromAppointment):
    patient_id: int
    appointment_id: int | None = None


class WaitingOut(BaseModel):
    id: int
    patient_id: int
    patient_name_ar: str
    patient_name_en: str
    patient_file_no: int
    patient_mobile: str | None
    doctor_id: int | None
    appointment_id: int | None
    appointment_starts_at: datetime | None
    preferred_days: list[int]
    preferred_from: str | None
    preferred_to: str | None
    note: str
    created_at: datetime
    resolved_at: datetime | None
    version: int
