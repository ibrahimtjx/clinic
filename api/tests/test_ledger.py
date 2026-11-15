# ruff: noqa: F811  (the `setup` fixture is shared with test_billing_docs)
"""M8: paying payment orders, final invoices, receipts, credit notes, deposits, cash box."""

import base64

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.models import Invoice, NumberSequence, Patient
from app.services.ledger import GENESIS_HASH
from tests.conftest import login
from tests.test_billing_docs import line, setup  # noqa: F401  (setup is a fixture)


def send_po(client, patient, lines, **kw):
    login(client, "reem")
    po = client.post("/payment-orders", json={"patient_id": patient.id, "lines": lines, **kw}).json()
    po = client.post(f"/payment-orders/{po['id']}/send", json={"version": po["version"], "reception_note": "اليوم"}).json()
    assert po["status"] == "sent", po
    return po


def collect(client, po, payments, user="amal", **kw):
    login(client, user)
    return client.post(
        f"/payment-orders/{po['id']}/collect",
        json={"version": po["version"], "expected_patient_share": po["patient_share"], "payments": payments, **kw},
    )


def cash(amount, method="cash", ref=""):
    return {"method": method, "amount": str(amount), "reference": ref}


def bal(db, patient):
    db.expire_all()
    p = db.get(Patient, patient.id)
    return str(p.balance), str(p.deposit_balance)


def test_collect_issues_invoice_and_receipt_with_chain_and_qr(client, setup, db):
    # Resident, insured class B: consultation 200 + panoramic 150, VAT 15%.
    po = send_po(client, setup["resident"], [line(setup["cons"]), line(setup["xray"])])
    assert po["patient_share"] == "126.50"
    res = collect(client, po, [cash("100"), cash("26.50", "mada", "AUTH-7781")])
    assert res.status_code == 201, res.text
    inv, rc = res.json()["invoice"], res.json()["receipt"]
    assert inv["invoice_no"].startswith("INV-") and inv["previous_hash"] == GENESIS_HASH and len(inv["hash"]) == 64
    assert (inv["total"], inv["vat"], inv["patient_share"], inv["outstanding"]) == ("402.50", "52.50", "126.50", "0.00")
    assert [ln["description_en"] for ln in inv["lines"]] == ["Specialist consultation", "Panoramic"]
    assert rc["receipt_no"].startswith("RC-") and rc["kind"] == "payment" and rc["total"] == "126.50"
    assert [p["method"] for p in rc["payments"]] == ["cash", "mada"] and rc["payments"][1]["reference"] == "AUTH-7781"
    assert rc["allocations"][0]["invoice_no"] == inv["invoice_no"] and rc["balance_after"] == "0.00"
    tlv = base64.b64decode(inv["qr_payload"])
    assert tlv[0] == 1 and b"402.50" in tlv and b"52.50" in tlv
    got = client.get(f"/payment-orders/{po['id']}").json()
    assert got["status"] == "paid" and got["invoice_no"] == inv["invoice_no"]
    # Paid orders cannot be paid or edited again.
    assert collect(client, got, [cash(1)]).status_code == 409
    # The next invoice continues the chain.
    po2 = send_po(client, setup["saudi"], [line(setup["xray"])])
    inv2 = collect(client, po2, []).json()["invoice"]
    assert inv2["previous_hash"] == inv["hash"]
    assert int(inv2["invoice_no"][-6:]) == int(inv["invoice_no"][-6:]) + 1


def test_partial_payment_balance_and_later_payment(client, setup, db):
    po = send_po(client, setup["resident"], [line(setup["veneer"])])  # excluded: patient pays 1380
    inv = collect(client, po, [cash("500")]).json()["invoice"]
    assert inv["outstanding"] == "880.00" and bal(db, setup["resident"]) == ("880.00", "0.00")
    acct = client.get(f"/patients/{setup['resident'].id}/account").json()
    assert [u["invoice_no"] for u in acct["unpaid"]] == [inv["invoice_no"]] and acct["balance"] == "880.00"
    over = client.post(f"/patients/{setup['resident'].id}/payments", json={"payments": [cash("900")]})
    assert over.json()["detail"] == {"code": "overpaid", "due": "880.00"}
    r = client.post(f"/patients/{setup['resident'].id}/payments", json={"payments": [cash("880", "credit_card")]}).json()
    assert r["kind"] == "payment" and r["balance_after"] == "0.00" and r["vat"] == "114.78"
    assert client.get(f"/invoices/{inv['id']}").json()["outstanding"] == "0.00"
    assert client.get(f"/patients/{setup['resident'].id}/account").json()["unpaid"] == []


def test_overpay_rejected_without_using_a_number(client, setup, db):
    po = send_po(client, setup["saudi"], [line(setup["xray"])])  # patient pays 30
    login(client, "amal")
    before = db.scalar(select(NumberSequence.next_value).where(NumberSequence.doc_type == "invoice"))
    res = collect(client, po, [cash("31")])
    assert res.json()["detail"]["code"] == "overpaid"
    db.expire_all()
    assert db.scalar(select(NumberSequence.next_value).where(NumberSequence.doc_type == "invoice")) == before
    assert collect(client, po, [cash("30")]).status_code == 201


def test_deposit_then_pay_with_deposit(client, setup, db):
    login(client, "amal")
    pid = setup["resident"].id
    d = client.post(f"/patients/{pid}/deposits", json={"payments": [cash("200")], "note": "دفعة مقدمة"}).json()
    assert d["kind"] == "deposit" and d["deposit_after"] == "200.00"
    bad = client.post(f"/patients/{pid}/deposits", json={"payments": [cash("10", "deposit")]})
    assert bad.json()["detail"]["code"] == "deposit_method_not_allowed"
    po = send_po(client, setup["resident"], [line(setup["veneer"])])
    res = collect(client, po, [cash("300", "deposit")])
    assert res.json()["detail"]["code"] == "insufficient_deposit"
    res = collect(client, po, [cash("200", "deposit"), cash("1180")])
    assert res.status_code == 201
    assert bal(db, setup["resident"]) == ("0.00", "0.00")


def test_issued_documents_are_immutable(client, setup, db):
    po = send_po(client, setup["saudi"], [line(setup["xray"])])
    inv = collect(client, po, [cash("30")]).json()["invoice"]
    assert client.patch(f"/invoices/{inv['id']}", json={"total": "1"}).status_code == 405
    assert client.delete(f"/invoices/{inv['id']}").status_code == 405
    for sql in (
        "UPDATE invoices SET total = 1 WHERE id = :i",
        "DELETE FROM invoice_lines WHERE invoice_id = :i",
        "UPDATE receipts SET total = 1 WHERE invoice_id = :i",
    ):
        with pytest.raises(DBAPIError, match="append-only"), db.begin_nested():
            db.execute(text(sql), {"i": inv["id"]})


def test_credit_note_on_unpaid_invoice_lowers_balance(client, setup, db, make_user):
    make_user("faisal", ["cashier"])
    po = send_po(client, setup["resident"], [line(setup["veneer"], qty="2")])  # 2760 patient
    inv = collect(client, po, [cash("1000")]).json()["invoice"]
    lid = inv["lines"][0]["id"]
    forbidden = client.post(f"/invoices/{inv['id']}/credit-notes", json={"reason": "خطأ", "lines": [{"invoice_line_id": lid, "qty": "1"}]})
    assert forbidden.status_code == 403  # reception has no invoice.credit_note
    login(client, "faisal")
    cn = client.post(f"/invoices/{inv['id']}/credit-notes", json={"reason": "سن واحد فقط", "lines": [{"invoice_line_id": lid, "qty": "1"}]}).json()
    assert cn["credit_note_no"].startswith("CN-") and cn["total"] == "1380.00" and cn["balance_reduced"] == "1380.00"
    assert cn["refunded"] == "0.00" and cn["previous_hash"] == inv["hash"] and cn["invoice_no"] == inv["invoice_no"]
    assert bal(db, setup["resident"]) == ("380.00", "0.00")
    full = client.get(f"/invoices/{inv['id']}").json()
    assert full["lines"][0]["credited_qty"] == "1.00" and full["outstanding"] == "380.00" and full["credited"] == "1380.00"
    too_much = client.post(f"/invoices/{inv['id']}/credit-notes", json={"reason": "مرة أخرى", "lines": [{"invoice_line_id": lid, "qty": "2"}]})
    assert too_much.json()["detail"]["code"] == "credit_exceeds_line"


def test_credit_note_on_paid_invoice_refunds_or_keeps_on_account(client, setup, db, make_user):
    make_user("faisal", ["cashier"])
    po = send_po(client, setup["resident"], [line(setup["veneer"]), line(setup["xray"])])
    inv = collect(client, po, [cash(po["patient_share"])]).json()["invoice"]
    veneer_line, xray_line = (ln["id"] for ln in inv["lines"])
    login(client, "faisal")
    need = client.post(f"/invoices/{inv['id']}/credit-notes", json={"reason": "إلغاء الفينير", "lines": [{"invoice_line_id": veneer_line, "qty": "1"}]})
    assert need.json()["detail"] == {"code": "refund_amount_mismatch", "due": "1380.00"}
    cn = client.post(
        f"/invoices/{inv['id']}/credit-notes",
        json={"reason": "إلغاء الفينير", "lines": [{"invoice_line_id": veneer_line, "qty": "1"}], "refund": {"payments": [cash("1380")]}},
    ).json()
    assert cn["refunded"] == "1380.00" and cn["refund_receipt_id"]
    refund = client.get(f"/receipts/{cn['refund_receipt_id']}").json()
    assert refund["kind"] == "refund" and refund["vat"] == "180.00" and refund["credit_note_no"] == cn["credit_note_no"]
    # The rest of the invoice: keep the patient's money on account.
    rest = client.post(f"/invoices/{inv['id']}/credit-notes", json={"reason": "إلغاء الأشعة", "refund": {"to_deposit": True}}).json()
    assert rest["lines"][0]["invoice_line_id"] == xray_line and rest["refunded"] == "34.50"
    assert bal(db, setup["resident"]) == ("0.00", "34.50")
    nothing = client.post(f"/invoices/{inv['id']}/credit-notes", json={"reason": "لا شيء"})
    assert nothing.json()["detail"]["code"] == "nothing_to_credit"
    # Give money on account back.
    back = client.post(f"/patients/{setup['resident'].id}/deposit-refunds", json={"payments": [cash("34.50")], "note": "طلب المريض"}).json()
    assert back["kind"] == "refund" and back["deposit_after"] == "0.00"


def test_daily_insurance_limit_counts_earlier_invoices(client, setup, db):
    # Class B daily limit 1500 on the insurer's net. Two orders the same day for the Saudi patient.
    big = [line(setup["xray"], qty="10")]  # net 1500: insurer 1425 (copay 75 capped)
    po1 = send_po(client, setup["saudi"], big)
    po2 = send_po(client, setup["saudi"], big)
    assert po1["insurance_share"] == po2["insurance_share"] == "1425.00"
    assert collect(client, po1, [cash("75")]).status_code == 201
    stale = collect(client, po2, [cash("75")])
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "totals_changed"
    assert stale.json()["detail"]["patient_share"] == "1425.00"  # only 75 left for the insurer
    fresh = client.get(f"/payment-orders/{po2['id']}").json()
    assert fresh["insurance_share"] == "75.00"
    assert collect(client, fresh, [cash("1425")]).status_code == 201


def test_installment_payment_updates_plan(client, setup, db):
    login(client, "reem")
    plan = client.post("/treatment-plans", json={"patient_id": setup["saudi"].id, "doctor_id": setup["doc"].id, "title": "تقويم", "options": [{"title": "ثابت", "price": "6000"}]}).json()
    acc = client.post(f"/treatment-plans/{plan['id']}/accept", json={"version": plan["version"], "option_id": plan["options"][0]["id"]}).json()
    gen = client.post(f"/treatment-plans/{plan['id']}/installments/generate", json={"version": acc["version"], "count": 3, "first_due": "2027-01-31"}).json()
    first = gen["installments"][0]
    po = client.post(f"/treatment-plans/{plan['id']}/installments/{first['id']}/payment-order", json={}).json()
    rc = collect(client, po, [cash("2000")]).json()["receipt"]
    assert rc["kind"] == "installment" and rc["plan_id"] == plan["id"]
    login(client, "reem")
    after = client.get(f"/treatment-plans/{plan['id']}").json()["installments"][0]
    assert after["paid_amount"] == "2000.00"


def test_cash_box_shift_totals_and_close(client, setup, db, make_user):
    make_user("faisal", ["cashier"])
    po = send_po(client, setup["resident"], [line(setup["veneer"])])
    collect(client, po, [cash("1000"), cash("380", "mada")])
    client.post(f"/patients/{setup['saudi'].id}/deposits", json={"payments": [cash("100")]})
    box = client.get("/cash-box/current").json()
    t = box["totals"]
    cash_row = next(m for m in t["methods"] if m["method"] == "cash")
    assert cash_row["in"]["total"] == "1100.00" and t["in"]["total"] == "1480.00" and t["deposits_taken"] == "100.00"
    assert t["in"]["vat"] == "180.00" and t["net"]["net"] == "1300.00" and t["count"] == 3
    assert client.get("/cash-box/current", params={"user_id": 1}).status_code == 403
    assert client.get("/cash-box/open").status_code == 403
    closed = client.post("/cash-box/close", json={"note": "نهاية الوردية"}).json()
    assert closed["totals_json"]["in"]["total"] == "1480.00" and closed["note"] == "نهاية الوردية"
    # The next payment belongs to the next shift.
    client.post(f"/patients/{setup['saudi'].id}/deposits", json={"payments": [cash("50")]})
    nxt = client.get("/cash-box/current").json()
    assert nxt["totals"]["in"]["total"] == "50.00" and nxt["last_closing"]["id"] == closed["id"]
    login(client, "faisal")
    opened = client.get("/cash-box/open").json()
    assert [(o["user_name"], o["net_total"], o["count"]) for o in opened] == [("مستخدم amal", "50.00", 1)]
    amal = opened[0]["user_id"]
    assert client.post("/cash-box/close", json={"user_id": amal}).json()["totals_json"]["in"]["total"] == "50.00"
    assert len(client.get("/cash-box/closings", params={"user_id": amal}).json()) == 2


def test_invoice_list_and_search(client, setup, db):
    po = send_po(client, setup["resident"], [line(setup["xray"])])
    inv = collect(client, po, []).json()["invoice"]
    login(client, "amal")
    found = client.get("/invoices", params={"q": inv["invoice_no"][-6:]}).json()
    assert [i["id"] for i in found] == [inv["id"]]
    assert [i["id"] for i in client.get("/invoices", params={"unpaid": True}).json()] == [inv["id"]]
    assert db.scalar(select(Invoice.buyer_nationality).where(Invoice.id == inv["id"])) == "GB"
