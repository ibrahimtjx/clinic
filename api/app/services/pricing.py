"""Document totals, VAT and the insurance split (SPEC 10.3, 10.4, 10.7).

All arithmetic is Decimal, rounded to the halala (0.01 SAR) with ROUND_HALF_UP. The server always
recalculates; totals sent by a client are ignored (SPEC 18).

Rules used until the clinic's accountant confirms them (recorded in SPEC.md Decisions):

VAT
  - Standard rate from settings (15%), stored on each line when the document is calculated.
  - Saudi citizens are exempt (0%): healthcare for citizens is zero-rated. A patient is Saudi when
    nationality is "SA" or the national ID starts with 1. Unknown nationality → VAT is charged.
  - A service marked "VAT not applicable" never carries VAT.

Insurance (per company class)
  1. Excluded services: the patient pays the whole line.
  2. Consultation lines: the insurer covers at most `consultation_max_covered` of the net; the
     patient pays the rest of that line in full.
  3. Co-payment: the patient pays `patient_share_pct` of each covered amount.
  4. Cap: the patient's co-payment on one document never exceeds `max_patient_share_per_invoice`.
  5. Daily limit: the insurer's share for the patient on one day never exceeds `daily_limit`,
     counting what earlier invoices that day already used; the excess moves to the patient.
  6. Expired or missing insurance: the patient pays everything.
  VAT on each line is split in the same proportion as the line's net amount.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
ZERO = Decimal(0)
HUNDRED = Decimal(100)


def money(x: Decimal) -> Decimal:
    return x.quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass
class LineIn:
    price: Decimal
    qty: Decimal = Decimal(1)
    discount_amount: Decimal = ZERO
    discount_pct: Decimal = ZERO
    vat_applicable: bool = True
    is_consultation: bool = False
    service_id: int | None = None


@dataclass
class InsuranceRules:
    patient_share_pct: Decimal = ZERO
    max_patient_share_per_invoice: Decimal | None = None
    consultation_max_covered: Decimal | None = None
    daily_limit: Decimal | None = None
    excluded_service_ids: frozenset[int] = frozenset()
    expiry: date | None = None


@dataclass
class LineOut:
    gross: Decimal
    discount: Decimal
    net: Decimal
    vat_rate: Decimal
    vat: Decimal
    total: Decimal
    insurance_share: Decimal
    patient_share: Decimal
    insurance_net: Decimal = ZERO  # insurer's share before VAT (for the daily limit)
    covered: bool = False


@dataclass
class Totals:
    lines: list[LineOut]
    gross: Decimal = ZERO
    discount: Decimal = ZERO
    net: Decimal = ZERO
    vat: Decimal = ZERO
    total: Decimal = ZERO
    insurance_share: Decimal = ZERO
    patient_share: Decimal = ZERO
    notes: list[str] = field(default_factory=list)


def is_saudi(nationality: str | None, national_id: str | None) -> bool:
    return nationality == "SA" or bool(national_id and national_id.startswith("1"))


def vat_rate_for(standard_rate: Decimal, saudi: bool, applicable: bool) -> Decimal:
    return ZERO if saudi or not applicable else standard_rate


def _allocate(amount: Decimal, weights: Sequence[Decimal]) -> list[Decimal]:
    """Split `amount` over `weights` in halalas; parts sum exactly to `amount` (largest remainder)."""
    total_w = sum(weights)
    if total_w <= 0 or amount == 0:
        return [ZERO for _ in weights]
    cents = int((amount / CENT).to_integral_value())
    raw = [Decimal(cents) * w / total_w for w in weights]
    base = [int(r) for r in raw]
    rest = cents - sum(base)
    order = sorted(range(len(weights)), key=lambda i: raw[i] - base[i], reverse=True)
    for i in order[:rest]:
        base[i] += 1
    return [Decimal(b) * CENT for b in base]


def calculate(
    lines: Sequence[LineIn],
    *,
    standard_vat_rate: Decimal,
    saudi: bool,
    insurance: InsuranceRules | None = None,
    on_date: date | None = None,
    insurer_used_today: Decimal = ZERO,
) -> Totals:
    out: list[LineOut] = []
    notes: list[str] = []
    active = insurance is not None and (insurance.expiry is None or on_date is None or insurance.expiry >= on_date)
    if insurance is not None and not active:
        notes.append("insurance_expired")

    # 1) Line amounts.
    copay: list[Decimal] = []  # the patient's co-payment part of the covered amount (cap applies)
    extra: list[Decimal] = []  # parts the patient always pays (exclusions, above consultation limit)
    for ln in lines:
        gross = money(ln.price * ln.qty)
        disc = money(ln.discount_amount + gross * ln.discount_pct / HUNDRED)
        disc = min(disc, gross)
        net = gross - disc
        rate = vat_rate_for(standard_vat_rate, saudi, ln.vat_applicable)
        vat = money(net * rate / HUNDRED)
        lo = LineOut(gross=gross, discount=disc, net=net, vat_rate=rate, vat=vat, total=net + vat, insurance_share=ZERO, patient_share=net + vat)
        if active and (ln.service_id is None or ln.service_id not in insurance.excluded_service_ids):
            covered = net
            if ln.is_consultation and insurance.consultation_max_covered is not None:
                covered = min(net, insurance.consultation_max_covered)
            lo.covered = True
            extra.append(net - covered)
            copay.append(money(covered * insurance.patient_share_pct / HUNDRED))
        else:
            extra.append(net)
            copay.append(ZERO)
        out.append(lo)

    if active:
        # 2) Cap on the patient's co-payment per document, shared out over the lines.
        cap = insurance.max_patient_share_per_invoice
        if cap is not None and sum(copay) > cap:
            copay = _allocate(cap, copay)
            notes.append("copay_capped")
        ins_net = [ln.net - extra[i] - copay[i] if ln.covered else ZERO for i, ln in enumerate(out)]
        # 3) Daily limit on the insurer's share (net of VAT), counting earlier invoices that day.
        if insurance.daily_limit is not None:
            room = max(ZERO, insurance.daily_limit - insurer_used_today)
            if sum(ins_net) > room:
                ins_net = _allocate(room, ins_net)
                notes.append("daily_limit_reached")
        # 4) VAT follows the net split; the patient's share is the remainder, so lines always add up.
        for i, ln in enumerate(out):
            if not ln.covered or ln.net == 0:
                continue
            ins_vat = money(ln.vat * ins_net[i] / ln.net)
            ln.insurance_net = ins_net[i]
            ln.insurance_share = ins_net[i] + ins_vat
            ln.patient_share = ln.total - ln.insurance_share

    t = Totals(lines=out, notes=notes)
    for ln in out:
        t.gross += ln.gross
        t.discount += ln.discount
        t.net += ln.net
        t.vat += ln.vat
        t.total += ln.total
        t.insurance_share += ln.insurance_share
        t.patient_share += ln.patient_share
    return t
