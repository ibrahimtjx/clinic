"""Patient search (SPEC 5.1, 3.9): one box matching file number, names (Arabic or English, partial),
mobile, emergency number and national ID, fast at 50,000 patients.

Text is matched against `search_text` (names normalized by clinic_normalize) and digits against
`search_digits`; both have trigram GIN indexes, so `LIKE '%…%'` uses an index.
"""

import re

from sqlalchemy import Select, and_, case, func, literal, or_, select

from app.models import Patient

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_LIKE_ESCAPE = str.maketrans({"%": r"\%", "_": r"\_", "\\": r"\\"})


def _like(term: str) -> str:
    return f"%{term.translate(_LIKE_ESCAPE)}%"


def apply_search(q: Select, text: str) -> tuple[Select, list]:
    """Adds the search filter to `q` and returns ORDER BY terms ranking the best matches first."""
    raw = text.strip().translate(_AR_DIGITS)
    if not raw:
        return q, []
    compact = re.sub(r"[\s\-]", "", raw)
    if compact.isdigit():
        # Numbers: exact file number first, then any number field containing the digits.
        exact = Patient.file_no == int(compact) if len(compact) <= 18 else literal(False)
        if len(compact) < 3:  # too short for a trigram index: file number only
            return q.where(exact), []
        q = q.where(or_(exact, Patient.search_digits.like(_like(compact))))
        return q, [case((exact, 0), else_=1), Patient.file_no]
    words = [w for w in re.split(r"\s+", raw) if w]
    conds = [
        Patient.search_text.like(
            func.concat("%", func.clinic_normalize(w.translate(_LIKE_ESCAPE)), "%")
        )
        for w in words
    ]
    q = q.where(and_(*conds))
    norm = func.clinic_normalize(raw)
    starts = or_(
        func.clinic_normalize(Patient.name_ar).like(func.concat(norm, "%")),
        func.lower(Patient.name_en).like(func.concat(func.lower(raw), "%")),
    )
    return q, [case((starts, 0), else_=1), func.length(Patient.name_ar), Patient.file_no]


def base_query() -> Select:
    return select(Patient).where(Patient.deleted_at.is_(None))
