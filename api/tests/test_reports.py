# ruff: noqa: F811  (the `setup` fixture is shared with test_billing_docs)
"""M9 reports: numbers agree with the ledger, filters, permissions, Excel export."""

from datetime import datetime, timedelta
from decimal import Decimal
from io import BytesIO
from zoneinfo import ZoneInfo

from openpyxl import load_workbook
from sqlalchemy import select

from app.models import AuditLog, DoctorCommissionRule, Patient
from tests.conftest import login
from tests.test_billing_docs import line, setup  # noqa: F401
from tests.test_ledger import cash, collect, send_po

TODAY = datetime.now(ZoneInfo("Asia/Riyadh")).date()
RANGE = {"date_from": str(TODAY - timedelta(days=1)), "date_to": str(TODAY + timedelta(days=1))}


def run(client, key, **params):
    res = client.get(f"/reports/{key}", params={**RANGE, **params})
    assert res.status_code == 200, res.text
    return res.json()


def summary(rep):
    return {i["en"]: i["value"] for i in rep["summary"]}


def section(rep, key):
    return next(s for s in rep["sections"] if s["key"] == key)


def _activity(client, setup, make_user):
    """Resident: veneer 1380 paid 1000 cash + 380 Mada. Saudi: x-ray (patient 30) on balance.
    Deposit 100 for the Saudi patient. Cashier credits the resident's invoice fully, refund 1380 cash."""
    make_user("faisal", ["cashier"])
    po = send_po(client, setup["resident"], [line(setup["veneer"])])
    inv1 = collect(client, po, [cash("1000"), cash("380", "mada", "A1")]).json()["invoice"]
    po2 = send_po(client, setup["saudi"], [line(setup["xray"])])
    inv2 = collect(client, po2, []).json()["invoice"]
    client.post(f"/patients/{setup['saudi'].id}/deposits", json={"payments": [cash("100")]})
    login(client, "faisal")
    client.post(f"/invoices/{inv1['id']}/credit-notes", json={"reason": "إلغاء", "refund": {"payments": [cash("1380")]}})
    return inv1, inv2


def test_catalog_depends_on_permissions(client, setup, make_user):
    make_user("faisal", ["cashier"])
    login(client, "amal")  # reception: operational reports
    keys = {r["key"] for r in client.get("/reports").json()}
    # Operational reports, plus the account statement (reception can view invoices).
    assert keys == {"daily_schedule", "no_shows", "new_patients", "queue_waits", "account_statement"}
    assert client.get("/reports/revenue", params=RANGE).status_code == 403
    login(client, "faisal")
    keys = {r["key"] for r in client.get("/reports").json()}
    assert {"revenue", "doctor_production", "account_statement", "outstanding", "insurance", "services_sold"} <= keys
    assert client.get("/reports/nope").status_code == 404


def test_revenue_detail_methods_and_summary(client, setup, make_user):
    inv1, _ = _activity(client, setup, make_user)
    rep = run(client, "revenue")
    detail = section(rep, "detail")
    kinds = [(r["receipt_no"][:3], r["kind_en"], r["amount"]) for r in detail["rows"]]
    assert kinds == [("RC-", "Payment", "1380.00"), ("RC-", "Deposit", "100.00"), ("RC-", "Refund", "-1380.00")]
    assert detail["rows"][0]["invoice_no"] == inv1["invoice_no"] and "cash" in detail["rows"][0]["method_en"].lower()
    assert detail["rows"][0]["vat_rate"] == "15%" and detail["rows"][0]["vat"] == "180.00"
    assert detail["totals"]["amount"] == "100.00"
    methods = {r["method_en"]: (r["in"], r["out"]) for r in section(rep, "methods")["rows"]}
    assert methods == {"Cash": ("1100.00", "1380.00"), "Mada": ("380.00", "0.00")}
    s = summary(rep)
    assert s["Invoice count"] == 2 and s["Invoices total"] == "1530.00" and s["VAT"] == "180.00"
    assert s["Total collected"] == "1480.00" and s["Refunds paid out"] == "1380.00" and s["Deposits received"] == "100.00"
    assert s["Credit notes (count)"] == 1 and s["Credit notes (value)"] == "1380.00"
    mada = run(client, "revenue", method="mada")
    assert [r["amount"] for r in section(mada, "detail")["rows"]] == ["1380.00"]


def test_account_statement_matches_balances(client, setup, make_user, db):
    _activity(client, setup, make_user)
    login(client, "faisal")
    for pt in (setup["saudi"], setup["resident"]):
        rep = run(client, "account_statement", patient_id=pt.id)
        db.expire_all()
        p = db.get(Patient, pt.id)
        s = summary(rep)
        assert s["Closing balance owed"] == f"{p.balance:.2f}"
        assert s["Closing on account"] == f"{p.deposit_balance:.2f}"
    rows = section(run(client, "account_statement", patient_id=setup["saudi"].id), "statement")["rows"]
    assert [(r["debit"], r["owed"], r["acct"]) for r in rows] == [("30.00", "30.00", "0.00"), (None, "30.00", "100.00")]
    later = run(client, "account_statement", patient_id=setup["saudi"].id, date_from=str(TODAY + timedelta(days=2)), date_to=str(TODAY + timedelta(days=3)))
    assert section(later, "statement")["rows"] == [] and summary(later)["Opening balance owed"] == "30.00"
    assert client.get("/reports/account_statement", params=RANGE).json()["detail"]["code"] == "patient_required"


def test_doctor_commission_on_collected_minus_refunds(client, setup, make_user, db):
    db.add(DoctorCommissionRule(doctor_id=setup["doc"].id, percent=Decimal(30)))
    db.commit()
    make_user("faisal", ["cashier"])
    po = send_po(client, setup["resident"], [line(setup["veneer"]), line(setup["xray"])], doctor_id=setup["doc"].id)
    collect(client, po, [cash(po["patient_share"])])
    login(client, "faisal")
    row = section(run(client, "doctor_production"), "doctors")["rows"][0]
    # Collected without VAT: veneer 1200 + x-ray patient part 30 → base 1230, commission 30% = 369.
    assert (row["invoices"], row["collected"], row["base"], row["commission"]) == (1, "1230.00", "1230.00", "369.00")
    assert row["insurance_net"] == "120.00"


def test_outstanding_insurance_and_services(client, setup, make_user):
    _activity(client, setup, make_user)
    login(client, "faisal")
    out = run(client, "outstanding")
    bal = section(out, "balances")["rows"]
    assert [(r["patient"], r["balance"], r["invoices"]) for r in bal] == [("سارة", "30.00", 1)]
    ins = run(client, "insurance")
    co = section(ins, "companies")["rows"][0]
    # Resident veneer is excluded (insurer 0); Saudi x-ray insurer 120.
    assert (co["count"], co["insurance"], co["claim"]) == (2, "120.00", "120.00")
    svc = {r["code"]: r for r in section(run(client, "services_sold"), "services")["rows"]}
    assert svc["T-VEN"]["qty"] == "1.0" and svc["T-VEN"]["cr_qty"] == "1.0" and svc["T-VEN"]["net_after"] == "0.00"
    assert svc["T-PANO"]["net_after"] == "150.00"


def test_operational_reports_run(client, setup, make_user):
    login(client, "amal")
    for key in ("daily_schedule", "no_shows", "new_patients", "queue_waits"):
        rep = run(client, key)
        assert rep["title_en"] and isinstance(rep["sections"], list)
    np = run(client, "new_patients")
    assert summary(np)["New patients"] >= 2


def test_excel_export_bilingual_and_audited(client, setup, make_user, db):
    _activity(client, setup, make_user)
    login(client, "faisal")
    res = client.get("/reports/revenue/excel", params={**RANGE, "lang": "en"})
    assert res.status_code == 200 and "spreadsheetml" in res.headers["content-type"]
    ws = load_workbook(BytesIO(res.content)).active
    values = [c.value for row in ws.iter_rows() for c in row if c.value is not None]
    assert "Revenue report" in " ".join(str(v) for v in values if isinstance(v, str))
    assert "رقم السند\nReceipt no." in values and 1380.0 in values and -1380.0 in values
    assert ws.sheet_view.rightToLeft is False
    ar = load_workbook(BytesIO(client.get("/reports/revenue/excel", params=RANGE).content)).active
    assert ar.sheet_view.rightToLeft is True
    db.expire_all()
    assert db.scalar(select(AuditLog.id).where(AuditLog.action == "report_export"))
