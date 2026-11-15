"""Document numbering (SPEC 10.2).

`allocate()` must be called inside the transaction that issues the document. The sequence row is
locked FOR UPDATE until that transaction ends, so concurrent issuers queue up and a rollback
returns the number: no gaps, no duplicates.
"""

from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import NumberSequence, Setting

DocType = Literal["quotation", "payment_order", "invoice", "credit_note", "receipt"]
DOC_TYPES: tuple[DocType, ...] = ("quotation", "payment_order", "invoice", "credit_note", "receipt")


class NumberFormat(BaseModel):
    prefix: str = Field(min_length=1, max_length=10, pattern=r"^[A-Z0-9]+$")
    yearly_reset: bool = True
    padding: int = Field(6, ge=3, le=10)


class NumberFormats(BaseModel):
    quotation: NumberFormat = NumberFormat(prefix="Q")
    payment_order: NumberFormat = NumberFormat(prefix="PO")
    invoice: NumberFormat = NumberFormat(prefix="INV")
    credit_note: NumberFormat = NumberFormat(prefix="CN")
    receipt: NumberFormat = NumberFormat(prefix="RC")


KEY = "numbering"


def get_formats(db: Session) -> NumberFormats:
    row = db.get(Setting, KEY)
    return NumberFormats(**(row.value_json if row else {}))


def format_number(fmt: NumberFormat, year: int, value: int) -> str:
    n = str(value).zfill(fmt.padding)
    return f"{fmt.prefix}-{year}-{n}" if fmt.yearly_reset else f"{fmt.prefix}-{n}"


def current_year(db: Session) -> int:
    """Year by the server clock in the clinic time zone (the DB session runs in Asia/Riyadh)."""
    return int(db.scalar(select(func.extract("year", func.now()))))


def allocate(db: Session, doc_type: DocType) -> str:
    fmt = getattr(get_formats(db), doc_type)
    year = current_year(db) if fmt.yearly_reset else 0
    # Create the row for a new year if needed, then lock it.
    db.execute(insert(NumberSequence).values(doc_type=doc_type, year=year, next_value=1).on_conflict_do_nothing())
    seq = db.execute(
        select(NumberSequence).where(NumberSequence.doc_type == doc_type, NumberSequence.year == year).with_for_update()
    ).scalar_one()
    value = seq.next_value
    seq.next_value = value + 1
    db.flush()
    return format_number(fmt, current_year(db), value)


def preview(db: Session) -> dict[str, dict]:
    """Next number per document type, without allocating (for the settings screen)."""
    formats = get_formats(db)
    year = current_year(db)
    out = {}
    for dt in DOC_TYPES:
        fmt = getattr(formats, dt)
        y = year if fmt.yearly_reset else 0
        nxt = db.scalar(select(NumberSequence.next_value).where(NumberSequence.doc_type == dt, NumberSequence.year == y))
        out[dt] = {"format": fmt.model_dump(), "next_number": format_number(fmt, year, nxt or 1), "issued": (nxt or 1) - 1}
    return out
