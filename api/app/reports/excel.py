"""Excel export with bilingual headers and the clinic letterhead (SPEC 11)."""

from datetime import date, datetime
from decimal import Decimal
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.reports.engine import RIYADH, Col, Report, Spec

HEAD = PatternFill("solid", fgColor="E6F2EF")
BOLD = Font(bold=True)
FORMATS = {
    "money": "#,##0.00",
    "number": "0.0",
    "pct": "0.0",
    "int": "0",
    "date": "dd/mm/yyyy",
    "datetime": "dd/mm/yyyy hh:mm AM/PM",
    "time": "hh:mm AM/PM",
}


def _cell(value, col: Col):
    if value is None:
        return None
    if col.type in ("money", "number", "pct"):
        return float(Decimal(value))  # Excel stores numbers as doubles; values are already rounded
    if col.type in ("datetime", "time") and isinstance(value, datetime):
        return value.astimezone(RIYADH).replace(tzinfo=None)
    if col.type == "date" and isinstance(value, datetime):
        return value.astimezone(RIYADH).date()
    if isinstance(value, (date, int)):
        return value
    return str(value)


def to_xlsx(
    spec: Spec, rep: Report, clinic: dict, period: str, lang: str, generated: datetime
) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = spec.key[:31]
    ws.sheet_view.rightToLeft = lang == "ar"
    widths: dict[int, int] = {}
    r = 1
    for text in (
        f"{clinic.get('name_ar', '')} / {clinic.get('name_en', '')}".strip(" /"),
        f"{spec.ar} / {spec.en}",
        period,
        f"{generated.astimezone(RIYADH):%d/%m/%Y %I:%M %p}",
    ):
        ws.cell(r, 1, text).font = Font(bold=r <= 2, size=14 if r == 1 else 11)
        r += 1
    r += 1
    for sec in rep.sections:
        ws.cell(r, 1, f"{sec.ar} / {sec.en}").font = Font(bold=True, size=12)
        r += 1
        for i, col in enumerate(sec.columns, start=1):
            c = ws.cell(r, i, f"{col.ar}\n{col.en}")
            c.font, c.fill = BOLD, HEAD
            c.alignment = Alignment(wrap_text=True, vertical="top")
            widths[i] = max(widths.get(i, 10), min(40, len(col.en) + 4))
        r += 1
        for row in sec.rows:
            for i, col in enumerate(sec.columns, start=1):
                key = col.key
                twin = key[:-3] + "_en" if key.endswith("_ar") else key + "_en"
                if lang == "en" and row.get(twin):
                    key = twin
                c = ws.cell(r, i, _cell(row.get(key), col))
                if col.type in FORMATS:
                    c.number_format = FORMATS[col.type]
                v = row.get(key)
                if isinstance(v, str):
                    widths[i] = max(widths.get(i, 10), min(50, len(v) + 2))
            r += 1
        if sec.totals:
            ws.cell(r, 1, "الإجمالي / Total").font = BOLD
            for i, col in enumerate(sec.columns, start=1):
                if col.key in sec.totals:
                    c = ws.cell(r, i, _cell(sec.totals[col.key], col))
                    c.font, c.number_format = BOLD, FORMATS.get(col.type, "General")
            r += 1
        r += 1
    if rep.summary:
        ws.cell(r, 1, "الملخص / Summary").font = Font(bold=True, size=12)
        r += 1
        for item in rep.summary:
            ws.cell(r, 1, f"{item.ar} / {item.en}")
            c = ws.cell(r, 2, _cell(item.value, Col("v", "", "", item.type)))
            c.number_format = FORMATS.get(item.type, "General")
            r += 1
        widths[1] = max(widths.get(1, 10), 40)
    for ar, en in zip(rep.notes_ar, rep.notes_en, strict=False):
        r += 1
        ws.cell(r, 1, f"{ar} / {en}")
    for i, w in widths.items():
        ws.column_dimensions[get_column_letter(i)].width = w
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
