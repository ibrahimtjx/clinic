# ruff: noqa: F811
"""Edge cases for bills, payments, deposits and credit notes (owner request 2026-11-16: not the happy path)."""

from decimal import Decimal

from app.models import Patient
from tests.conftest import login
from tests.test_billing_docs import line, setup  # noqa: F401
from tests.test_ledger import bal, cash, collect, send_po


def po_body(setup, lines, who="saudi"):
    return {"patient_id": setup[who].id, "lines": lines}


def test_bad_lines_are_refused(client, setup):
    login(client, "reem")
    cons = setup["cons"]
    cases = {
        "no lines": [],
        "zero qty": [line(cons, qty="0")],
        "negative price": [line(cons, price="-5")],
        "discount over 100%": [line(cons, discount_pct="150")],
        "unknown service": [{"service_id": 999999, "price": "10"}],
        "bad tooth": [line(cons, teeth=[99])],
        "huge price": [line(cons, price="1" + "0" * 15)],
        "three decimals": [line(cons, price="200.555")],
    }
    for name, lines in cases.items():
        res = client.post("/payment-orders", json=po_body(setup, lines, "resident"))
        assert res.status_code == 422, (name, res.status_code, res.text)


def test_discount_amount_larger_than_line_is_refused(client, setup):
    login(client, "reem")
    res = client.post(
        "/payment-orders",
        json=po_body(setup, [line(setup["cons"], discount_amount="500")], "resident"),
    )
    assert res.status_code == 422, res.text


def test_full_discount_gives_zero_bill_that_can_be_closed(client, setup, db):
    po = send_po(client, setup["resident"], [line(setup["cons"], discount_pct="100")])
    assert po["patient_share"] == "0.00" and po["total"] == "0.00"
    res = collect(client, po, [])
    assert res.status_code == 201, res.text
    assert res.json()["invoice"]["total"] == "0.00"
    assert bal(db, setup["resident"]) == ("0.00", "0.00")


def test_collect_twice_and_after_cancel(client, setup):
    po = send_po(client, setup["resident"], [line(setup["xray"])])
    assert collect(client, po, [cash(po["patient_share"])]).status_code == 201
    again = collect(client, po, [cash(po["patient_share"])])
    assert again.status_code in (409, 422), again.text
    po2 = send_po(client, setup["resident"], [line(setup["xray"])])
    login(client, "reem")
    c = client.post(f"/payment-orders/{po2['id']}/cancel", json={"version": po2["version"]})
    assert c.status_code == 200, c.text
    res = collect(client, c.json(), [cash(po2["patient_share"])])
    assert res.status_code in (409, 422), res.text


def test_paid_order_cannot_be_edited_or_cancelled(client, setup):
    po = send_po(client, setup["resident"], [line(setup["xray"])])
    collect(client, po, [cash(po["patient_share"])])
    login(client, "reem")
    cur = client.get(f"/payment-orders/{po['id']}").json()
    ed = client.patch(
        f"/payment-orders/{po['id']}",
        json={"version": cur["version"], "lines": [line(setup["cons"])]},
    )
    assert ed.status_code in (409, 422), ed.text
    cn = client.post(f"/payment-orders/{po['id']}/cancel", json={"version": cur["version"]})
    assert cn.status_code in (409, 422), cn.text


def test_price_changed_after_send_is_caught_at_collect(client, setup):
    po = send_po(client, setup["resident"], [line(setup["xray"])])
    login(client, "amal")
    res = client.post(
        f"/payment-orders/{po['id']}/collect",
        json={
            "version": po["version"],
            "expected_patient_share": "1.00",
            "payments": [cash("1.00")],
        },
    )
    assert res.status_code in (409, 422), res.text


def test_payments_more_than_balance_and_bad_amounts(client, setup, db):
    po = send_po(client, setup["resident"], [line(setup["veneer"])])  # not covered: 1380
    collect(client, po, [cash("50")])  # part paid: the rest is owed
    owed = bal(db, setup["resident"])[0]
    assert Decimal(owed) > 0
    login(client, "amal")
    pid = setup["resident"].id
    over = client.post(f"/patients/{pid}/payments", json={"payments": [cash(Decimal(owed) + 1)]})
    assert over.status_code == 422, over.text
    zero = client.post(f"/patients/{pid}/payments", json={"payments": [cash("0")]})
    assert zero.status_code == 422
    neg = client.post(f"/patients/{pid}/deposits", json={"payments": [cash("-10")]})
    assert neg.status_code == 422
    empty = client.post(f"/patients/{pid}/payments", json={"payments": []})
    assert empty.status_code == 422, empty.text
    ok = client.post(f"/patients/{pid}/payments", json={"payments": [cash(owed)]})
    assert ok.status_code == 201, ok.text
    assert bal(db, setup["resident"])[0] == "0.00"


def test_deposit_spending_and_refund_limits(client, setup, db, make_user):
    make_user("faisal", ["cashier"])
    login(client, "amal")
    pid = setup["resident"].id
    assert (
        client.post(f"/patients/{pid}/deposits", json={"payments": [cash("100")]}).status_code
        == 201
    )
    # A deposit cannot be paid with a deposit.
    loop = client.post(f"/patients/{pid}/deposits", json={"payments": [cash("10", "deposit")]})
    assert loop.status_code == 422, loop.text
    # Refund more than the deposit (cashier: refunds need invoice.credit_note).
    login(client, "faisal")
    big = client.post(
        f"/patients/{pid}/deposit-refunds", json={"payments": [cash("150")], "note": "طلب المريض"}
    )
    assert big.status_code == 422, big.text
    po = send_po(client, setup["resident"], [line(setup["veneer"])])
    over = collect(client, po, [cash("200", "deposit"), cash(Decimal(po["patient_share"]) - 200)])
    assert over.status_code == 422, over.text
    assert bal(db, setup["resident"])[1] == "100.00"


def test_credit_note_limits(client, setup, db):
    po = send_po(client, setup["resident"], [line(setup["xray"], qty="2")])
    res = collect(client, po, [cash(po["patient_share"])]).json()
    inv = res["invoice"]
    login(client, "amal")
    lid = inv["lines"][0]["id"]
    # More than invoiced, unknown line, too-short reason.
    for body in [
        {"reason": "خطأ في الكمية", "lines": [{"invoice_line_id": lid, "qty": "3"}]},
        {"reason": "خطأ", "lines": [{"invoice_line_id": 999999, "qty": "1"}]},
        {"reason": "x", "lines": None},
    ]:
        r = client.post(f"/invoices/{inv['id']}/credit-notes", json=body)
        assert r.status_code in (403, 422), (body, r.status_code, r.text)
    login(client, "reem")  # doctor: no invoice.credit_note
    assert (
        client.post(
            f"/invoices/{inv['id']}/credit-notes", json={"reason": "طلب المريض"}
        ).status_code
        == 403
    )


def test_credit_note_twice_cannot_exceed_invoice(client, setup, db, make_user):
    make_user("boss", ["admin"])
    po = send_po(client, setup["resident"], [line(setup["xray"], qty="2")])
    inv = collect(client, po, [cash(po["patient_share"])]).json()["invoice"]
    login(client, "boss")
    lid = inv["lines"][0]["id"]
    one = client.post(
        f"/invoices/{inv['id']}/credit-notes",
        json={
            "reason": "سن واحد فقط",
            "lines": [{"invoice_line_id": lid, "qty": "1"}],
            "refund": {"to_deposit": True},
        },
    )
    assert one.status_code == 201, one.text
    two = client.post(
        f"/invoices/{inv['id']}/credit-notes",
        json={
            "reason": "مرة أخرى",
            "lines": [{"invoice_line_id": lid, "qty": "2"}],
            "refund": {"to_deposit": True},
        },
    )
    assert two.status_code == 422, two.text
    full = client.post(
        f"/invoices/{inv['id']}/credit-notes",
        json={"reason": "الباقي", "refund": {"to_deposit": True}},
    )
    assert full.status_code == 201, full.text
    none_left = client.post(
        f"/invoices/{inv['id']}/credit-notes",
        json={"reason": "مرة ثالثة", "refund": {"to_deposit": True}},
    )
    assert none_left.status_code == 422, none_left.text


def test_bill_for_deleted_or_unknown_patient(client, setup, db):
    login(client, "reem")
    assert client.post(
        "/payment-orders", json={"patient_id": 999999, "lines": [line(setup["cons"])]}
    ).status_code in (404, 422)
    p = db.get(Patient, setup["resident"].id)
    p.deleted_at = db.scalar(__import__("sqlalchemy").select(__import__("sqlalchemy").func.now()))
    db.commit()
    res = client.post("/payment-orders", json=po_body(setup, [line(setup["cons"])], "resident"))
    assert res.status_code in (404, 409, 422), res.text


def test_plan_installments_validation(client, setup):
    login(client, "reem")
    doc = client.get("/doctors").json()[0]["id"]
    base = {"patient_id": setup["resident"].id, "doctor_id": doc, "title": "زراعة"}
    over = client.post("/treatment-plans", json={**base, "total_price": "1000", "discount": "1500"})
    assert over.status_code == 422, over.text
    plan = client.post("/treatment-plans", json={**base, "total_price": "1000"}).json()
    plan = client.post(
        f"/treatment-plans/{plan['id']}/accept", json={"version": plan["version"]}
    ).json()
    dp = client.post(
        f"/treatment-plans/{plan['id']}/installments/generate",
        json={
            "version": plan["version"],
            "count": 3,
            "first_due": "2027-01-01",
            "down_payment": "1200",
        },
    )
    assert dp.status_code == 422, dp.text


def test_quotation_and_plan_steps_out_of_order(client, setup, db):
    from sqlalchemy import text

    login(client, "reem")
    q = client.post("/quotations", json=po_body(setup, [line(setup["cons"])], "resident")).json()
    conv = client.post(f"/quotations/{q['id']}/convert", json={"version": q["version"]})
    assert conv.status_code == 201, conv.text
    q2 = client.get(f"/quotations/{q['id']}").json()
    again = client.post(f"/quotations/{q['id']}/convert", json={"version": q2["version"]})
    assert again.status_code in (409, 422), ("converted twice", again.text)
    # An expired quotation cannot be accepted or converted.
    e = client.post("/quotations", json=po_body(setup, [line(setup["cons"])], "resident")).json()
    db.execute(
        text("update quotations set valid_until = current_date - 1 where id = :i"), {"i": e["id"]}
    )
    db.commit()
    e = client.get(f"/quotations/{e['id']}").json()
    for action in ("accept", "convert"):
        r = client.post(f"/quotations/{e['id']}/{action}", json={"version": e["version"]})
        assert r.status_code in (409, 422), (
            f"{action} an expired quotation",
            r.status_code,
            r.text,
        )
    # Cancelled cannot be sent.
    c = client.post("/quotations", json=po_body(setup, [line(setup["cons"])], "resident")).json()
    c = client.post(f"/quotations/{c['id']}/cancel", json={"version": c["version"]}).json()
    assert (
        client.post(f"/quotations/{c['id']}/send", json={"version": c["version"]}).status_code
        == 409
    )

    doc = client.get("/doctors").json()[0]["id"]
    plan = client.post(
        "/treatment-plans",
        json={
            "patient_id": setup["resident"].id,
            "doctor_id": doc,
            "title": "تقويم",
            "total_price": "3000",
        },
    ).json()
    plan = client.post(
        f"/treatment-plans/{plan['id']}/accept", json={"version": plan["version"]}
    ).json()
    twice = client.post(f"/treatment-plans/{plan['id']}/accept", json={"version": plan["version"]})
    assert twice.status_code in (409, 422), ("accepted twice", twice.text)
    plan = client.post(
        f"/treatment-plans/{plan['id']}/installments/generate",
        json={"version": plan["version"], "count": 3, "first_due": "2027-01-01"},
    ).json()
    iid = plan["installments"][0]["id"]
    a = client.post(f"/treatment-plans/{plan['id']}/installments/{iid}/payment-order", json={})
    assert a.status_code == 201, a.text
    b = client.post(f"/treatment-plans/{plan['id']}/installments/{iid}/payment-order", json={})
    assert b.status_code in (200, 409, 422), b.text
    if b.status_code == 200:
        assert b.json()["id"] == a.json()["id"], "second bill for the same installment"
    cur = client.get(f"/treatment-plans/{plan['id']}").json()
    edit = client.patch(
        f"/treatment-plans/{plan['id']}", json={"version": cur["version"], "total_price": "1"}
    )
    assert edit.status_code in (409, 422), ("price changed after acceptance", edit.text)
