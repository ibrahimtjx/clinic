"""The three worked examples the spec asks for (SPEC 10.4), with our assumed Saudi rules.
The accountant should check each line; if a rule differs, change the rule and these numbers."""

from datetime import date
from decimal import Decimal as D

from app.services.pricing import InsuranceRules, LineIn, calculate, is_saudi

VAT = D(15)
CLASS_B = InsuranceRules(
    patient_share_pct=D(20),
    max_patient_share_per_invoice=D(75),
    consultation_max_covered=D(150),
    daily_limit=D(1500),
    excluded_service_ids=frozenset({17}),  # veneer: cosmetic
    expiry=date(2027, 12, 31),
)


def test_example_1_saudi_insured_consultation_and_xray():
    """Saudi patient, class B. Specialist consultation 200 + panoramic X-ray 150. No VAT (citizen).
    Consultation: insurer covers up to 150 → patient pays 50 above the limit + 20% of 150 = 30.
    X-ray: patient 20% of 150 = 30. Co-payment 30+30 = 60, under the 75 cap.
    Patient: 50 + 60 = 110. Insurer: 120 + 120 = 240."""
    t = calculate(
        [LineIn(D(200), is_consultation=True, service_id=2), LineIn(D(150), service_id=5)],
        standard_vat_rate=VAT,
        saudi=True,
        insurance=CLASS_B,
        on_date=date(2026, 11, 15),
    )
    assert (t.net, t.vat, t.total) == (D("350.00"), D("0.00"), D("350.00"))
    assert [ln.patient_share for ln in t.lines] == [D("80.00"), D("30.00")]
    assert [ln.insurance_share for ln in t.lines] == [D("120.00"), D("120.00")]
    assert (t.patient_share, t.insurance_share) == (D("110.00"), D("240.00"))


def test_example_2_resident_insured_with_cap_vat_and_exclusion():
    """Non-Saudi resident, class B. Partial denture 1200 with 10% discount, veneer 1200 (excluded).
    Denture net 1080, VAT 15% = 162, total 1242. Co-payment 20% = 216 → capped at 75.
    Insurer net 1005, insurer VAT 162 × 1005/1080 = 150.75 → insurer 1155.75, patient 86.25.
    Veneer: excluded → patient pays 1200 + 180 VAT = 1380.
    Patient total 1466.25, insurer 1155.75, document total 2622.00."""
    t = calculate(
        [LineIn(D(1200), discount_pct=D(10), service_id=9), LineIn(D(1200), service_id=17)],
        standard_vat_rate=VAT,
        saudi=False,
        insurance=CLASS_B,
        on_date=date(2026, 11, 15),
    )
    den, ven = t.lines
    assert (den.net, den.vat, den.total) == (D("1080.00"), D("162.00"), D("1242.00"))
    assert (den.insurance_share, den.patient_share) == (D("1155.75"), D("86.25"))
    assert (ven.insurance_share, ven.patient_share) == (D("0.00"), D("1380.00"))
    assert (t.total, t.patient_share, t.insurance_share) == (
        D("2622.00"),
        D("1466.25"),
        D("1155.75"),
    )
    assert "copay_capped" in t.notes


def test_example_3_daily_limit_and_cash_patient():
    """Resident, class B, CBCT 600 + metal partial denture 2500 the same day after an earlier invoice
    used 400 of the 1500 daily limit. Co-payment 20% of 3100 = 620 → capped at 75 (split by weight:
    14.52 on CBCT, 60.48 on the denture). Insurer net would be 3025 but only 1100 is left today:
    1100 is split 600:2500-ish by weight. Everything above moves to the patient.
    A cash (uninsured) non-Saudi pays everything including 15% VAT."""
    lines = [LineIn(D(600), service_id=7), LineIn(D(2500), service_id=11)]
    t = calculate(
        lines,
        standard_vat_rate=VAT,
        saudi=False,
        insurance=CLASS_B,
        on_date=date(2026, 11, 15),
        insurer_used_today=D(400),
    )
    assert sum(ln.insurance_net for ln in t.lines) == D("1100.00")
    assert t.total == D("3565.00")  # 3100 + 465 VAT
    assert t.insurance_share + t.patient_share == t.total
    assert "daily_limit_reached" in t.notes
    cash = calculate(lines, standard_vat_rate=VAT, saudi=False)
    assert (cash.patient_share, cash.insurance_share, cash.vat) == (
        D("3565.00"),
        D("0.00"),
        D("465.00"),
    )


def test_expired_insurance_means_patient_pays():
    t = calculate(
        [LineIn(D(100))],
        standard_vat_rate=VAT,
        saudi=True,
        insurance=CLASS_B,
        on_date=date(2028, 1, 1),
    )
    assert t.patient_share == D("100.00") and "insurance_expired" in t.notes


def test_vat_not_applicable_service_and_saudi_detection():
    t = calculate([LineIn(D(100), vat_applicable=False)], standard_vat_rate=VAT, saudi=False)
    assert t.vat == D("0.00")
    assert is_saudi("SA", None) and is_saudi(None, "1012345678")
    assert not is_saudi("EG", "2012345678") and not is_saudi(None, None)


def test_rounding_always_adds_up():
    """Odd amounts and three-way splits: shares always sum to the line totals, to the halala."""
    lines = [
        LineIn(D("33.33"), qty=D(3), discount_amount=D("0.01")),
        LineIn(D("0.07")),
        LineIn(D("99.99"), discount_pct=D("12.5")),
    ]
    rules = InsuranceRules(
        patient_share_pct=D(17), max_patient_share_per_invoice=D("10.01"), daily_limit=D("50.03")
    )
    t = calculate(lines, standard_vat_rate=VAT, saudi=False, insurance=rules)
    for ln in t.lines:
        assert ln.insurance_share + ln.patient_share == ln.total
        assert ln.patient_share >= 0 and ln.insurance_share >= 0
    assert t.patient_share + t.insurance_share == t.total
    assert sum(ln.insurance_net for ln in t.lines) == D("50.03")
