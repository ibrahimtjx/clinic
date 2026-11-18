"""Report shapes, filters, value formatting and the registry."""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, model_validator
from sqlalchemy.orm import Session

RIYADH = ZoneInfo("Asia/Riyadh")
ColType = Literal["text", "money", "int", "number", "date", "datetime", "time", "pct"]
FilterKey = Literal[
    "date_range",
    "day",
    "user",
    "doctor",
    "patient",
    "clinic",
    "method",
    "company",
    "patient_required",
    "doctor_required",
]


class Filters(BaseModel):
    date_from: date | None = None
    date_to: date | None = None  # inclusive
    user_id: int | None = None
    doctor_id: int | None = None
    patient_id: int | None = None
    clinic_id: int | None = None
    method: Literal["cash", "mada", "credit_card", "bank_transfer", "deposit"] | None = None
    company_id: int | None = None

    @model_validator(mode="after")
    def _order(self):
        if self.date_from and self.date_to and self.date_to < self.date_from:
            raise ValueError("date_to before date_from")
        if self.date_from and self.date_to and (self.date_to - self.date_from).days > 731:
            raise ValueError("range longer than two years")
        return self

    def start(self) -> datetime | None:
        return datetime.combine(self.date_from, time(0), RIYADH) if self.date_from else None

    def end(self) -> datetime | None:
        """Exclusive end: midnight after date_to."""
        return (
            datetime.combine(self.date_to + timedelta(days=1), time(0), RIYADH)
            if self.date_to
            else None
        )


def within(col, f: Filters):
    """SQL conditions for a timestamp column inside the filter's dates."""
    out = []
    if f.start():
        out.append(col >= f.start())
    if f.end():
        out.append(col < f.end())
    return out


@dataclass
class Col:
    key: str
    ar: str
    en: str
    type: ColType = "text"


@dataclass
class Section:
    key: str
    ar: str
    en: str
    columns: list[Col]
    rows: list[dict[str, Any]] = field(default_factory=list)
    totals: dict[str, Any] | None = None


@dataclass
class Item:
    ar: str
    en: str
    value: Any
    type: ColType = "money"


@dataclass
class Report:
    sections: list[Section]
    summary: list[Item] = field(default_factory=list)
    notes_ar: list[str] = field(default_factory=list)
    notes_en: list[str] = field(default_factory=list)


@dataclass
class Spec:
    key: str
    ar: str
    en: str
    group: Literal["financial", "operational"]
    perms: tuple[str, ...]  # any of
    filters: tuple[FilterKey, ...]
    run: Callable[[Session, Filters], Report]
    description_ar: str = ""
    description_en: str = ""


REGISTRY: dict[str, Spec] = {}


def report(**kw):
    def deco(fn):
        REGISTRY[kw["key"]] = Spec(run=fn, **kw)
        return fn

    return deco


def fmt(value: Any, type_: ColType) -> Any:
    """JSON value for a cell: money and numbers as decimal strings (never floats), times in Riyadh."""
    if value is None:
        return None
    if type_ == "money":
        return f"{Decimal(value):.2f}"
    if type_ in ("number", "pct"):
        return f"{Decimal(value):.1f}"
    if type_ == "int":
        return int(value)
    if type_ in ("datetime", "time") and isinstance(value, datetime):
        return value.astimezone(RIYADH).isoformat()
    if type_ == "date" and isinstance(value, (date, datetime)):
        return (
            value.astimezone(RIYADH).date() if isinstance(value, datetime) else value
        ).isoformat()
    return str(value) if not isinstance(value, str) else value


def money_sum(rows: list[dict], key: str) -> Decimal:
    return sum((Decimal(r[key] or 0) for r in rows), Decimal(0))


def totals(rows: list[dict], keys: list[str]) -> dict:
    return {k: money_sum(rows, k) for k in keys}
