"""Server-side PDF of a report with WeasyPrint (SPEC 2 default stack, SPEC 11), Arabic shaped by
Pango/HarfBuzz. Same data as the screen and Excel; A4 landscape with the clinic letterhead."""

from datetime import datetime
from html import escape

from app.reports.engine import RIYADH, Col, Report, Spec, fmt

CSS = """
@page { size: A4 landscape; margin: 10mm; @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; color: #666; } }
body { font-family: "Noto Sans Arabic", "Noto Naskh Arabic", "DejaVu Sans", sans-serif; font-size: 8.5pt; color: #111; }
.head { border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 8px; }
.head h1 { font-size: 14pt; margin: 0; }
.head h2 { font-size: 11pt; margin: 2px 0; }
.meta { color: #555; font-size: 8pt; }
h3 { font-size: 10pt; margin: 10px 0 4px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #ccc; padding: 2px 4px; vertical-align: top; }
th { background: #e6f2ef; font-weight: 600; }
td.num, th.num { text-align: end; white-space: nowrap; direction: ltr; }
tfoot td { font-weight: 700; }
.summary { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.summary div { border: 1px solid #ccc; border-radius: 4px; padding: 3px 6px; min-width: 32%; }
.summary span { display: block; color: #555; font-size: 7.5pt; }
.note { color: #555; font-size: 7.5pt; margin-top: 4px; }
"""

NUMERIC = ("money", "int", "number", "pct")


def _text(value, col: Col, lang: str) -> str:
    v = fmt(value, col.type)
    if v is None or v == "":
        return ""
    if col.type == "money":
        n = _group(str(v))
        return f"{n} ر.س" if lang == "ar" else f"SAR {n}"
    if col.type in ("datetime", "time", "date"):
        dt = datetime.fromisoformat(str(v))
        if col.type == "date":
            return dt.strftime("%d/%m/%Y")
        local = dt.astimezone(RIYADH)
        period = (
            ("ص" if local.hour < 12 else "م")
            if lang == "ar"
            else ("AM" if local.hour < 12 else "PM")
        )
        t = f"{local:%I:%M} {period}"
        return t if col.type == "time" else f"{local:%d/%m/%Y} {t}"
    if col.type == "pct":
        return f"{v}%"
    return str(v)


def _group(s: str) -> str:
    """1234567.50 → 1,234,567.50 from the decimal string (no floats)."""
    neg = s.startswith("-")
    whole, _, frac = s.lstrip("-").partition(".")
    out = f"{int(whole):,}"
    return f"{'-' if neg else ''}{out}.{frac or '00'}"


def _cell(row: dict, col: Col, lang: str) -> str:
    key = col.key
    if lang == "en" and col.type == "text":
        twin = key[:-3] + "_en" if key.endswith("_ar") else key + "_en"
        if row.get(twin):
            key = twin
    return escape(_text(row.get(key), col, lang))


def to_html(
    spec: Spec,
    rep: Report,
    clinic: dict,
    period: str,
    lang: str,
    generated: datetime,
    patient: str = "",
) -> str:
    ar = lang == "ar"
    name = clinic.get("name_ar" if ar else "name_en") or clinic.get("name_ar") or ""
    bits = [period, patient, f"{generated.astimezone(RIYADH):%d/%m/%Y %H:%M}"]
    if clinic.get("vat_number"):
        bits.append(f"VAT {clinic['vat_number']}")
    meta = " · ".join(b for b in bits if b)
    parts = [
        f'<!doctype html><html lang="{lang}" dir="{"rtl" if ar else "ltr"}"><head><meta charset="utf-8"><style>{CSS}</style></head><body>',
        '<div class="head">',
        f"<h1>{escape(name)}</h1>",
        f"<h2>{escape(spec.ar)} / {escape(spec.en)}</h2>",
        f'<div class="meta">{escape(meta)}</div>',
        "</div>",
    ]
    for sec in rep.sections:
        if len(rep.sections) > 1 or sec.key.startswith("doctor-"):
            parts.append(f"<h3>{escape(sec.ar if ar else sec.en)}</h3>")
        parts.append("<table><thead><tr>")
        for c in sec.columns:
            cls = ' class="num"' if c.type in NUMERIC else ""
            parts.append(f"<th{cls}>{escape(c.ar if ar else c.en)}</th>")
        parts.append("</tr></thead><tbody>")
        for row in sec.rows:
            parts.append("<tr>")
            for c in sec.columns:
                cls = ' class="num"' if c.type in NUMERIC else ""
                parts.append(f"<td{cls}>{_cell(row, c, lang)}</td>")
            parts.append("</tr>")
        if not sec.rows:
            parts.append(f'<tr><td colspan="{len(sec.columns)}">—</td></tr>')
        parts.append("</tbody>")
        if sec.totals and sec.rows:
            parts.append("<tfoot><tr>")
            for i, c in enumerate(sec.columns):
                cls = ' class="num"' if c.type in NUMERIC else ""
                if c.key in sec.totals:
                    parts.append(f"<td{cls}>{escape(_text(sec.totals[c.key], c, lang))}</td>")
                else:
                    parts.append(f"<td>{('الإجمالي' if ar else 'Total') if i == 0 else ''}</td>")
            parts.append("</tr></tfoot>")
        parts.append("</table>")
    if rep.summary:
        parts.append(f'<h3>{"الملخص" if ar else "Summary"}</h3><div class="summary">')
        for item in rep.summary:
            label = item.ar if ar else item.en
            parts.append(
                f"<div><span>{escape(label)}</span>{escape(_text(item.value, Col('v', '', '', item.type), lang))}</div>"
            )
        parts.append("</div>")
    for note in rep.notes_ar if ar else rep.notes_en:
        parts.append(f'<div class="note">{escape(note)}</div>')
    parts.append("</body></html>")
    return "".join(parts)


def to_pdf(html: str) -> bytes:
    from weasyprint import HTML  # imported lazily: needs Pango, only in the API image

    return HTML(string=html).write_pdf()
