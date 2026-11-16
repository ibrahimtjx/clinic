from datetime import date, time
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from app.models import (
    Appointment,
    AppointmentStatus,
    Doctor,
    DoctorSchedule,
    InsuranceClass,
    InsuranceCompany,
    Patient,
    PatientInsurance,
    Service,
)
from tests.conftest import login


@pytest.fixture
def setup(db, make_user, client):
    make_user("reem", ["doctor"])
    make_user("amal", ["reception"])
    doc = Doctor(name_ar="د. ريم")
    doc.schedules = [
        DoctorSchedule(weekday=d, start_time=time(0), end_time=time(23, 59)) for d in range(7)
    ]
    cons = Service(
        number=900,
        code="T-CONS",
        name_ar="كشف أخصائي",
        name_en="Specialist consultation",
        sale_price=Decimal(200),
        min_price=Decimal(150),
        max_price=Decimal(250),
        is_consultation=True,
    )
    xray = Service(
        number=901,
        code="T-PANO",
        name_ar="بانوراما",
        name_en="Panoramic",
        sale_price=Decimal(150),
        min_price=Decimal(150),
        max_price=Decimal(150),
    )
    veneer = Service(
        number=902,
        code="T-VEN",
        name_ar="فينير",
        name_en="Veneer",
        sale_price=Decimal(1200),
        min_price=Decimal(1000),
        max_price=Decimal(1500),
    )
    company = InsuranceCompany(code="TAW", name_ar="التعاونية", name_en="Tawuniya")
    db.add_all([doc, cons, xray, veneer, company])
    db.flush()
    cls_b = InsuranceClass(
        company_id=company.id,
        name="B",
        patient_share_pct=Decimal(20),
        max_patient_share_per_invoice=Decimal(75),
        consultation_max_covered=Decimal(150),
        daily_limit=Decimal(1500),
        excluded_service_ids=[veneer.id],
    )
    saudi = Patient(name_ar="سارة", nationality="SA", national_id="1012345678")
    resident = Patient(name_ar="جون", nationality="GB", national_id="2012345678")
    db.add_all([cls_b, saudi, resident])
    db.flush()
    saudi.insurance = PatientInsurance(
        company_id=company.id, class_id=cls_b.id, class_name="B", expiry=date(2030, 1, 1)
    )
    resident.insurance = PatientInsurance(
        company_id=company.id, class_id=cls_b.id, class_name="B", expiry=date(2030, 1, 1)
    )
    db.commit()
    login(client, "reem")
    return {
        "doc": doc,
        "cons": cons,
        "xray": xray,
        "veneer": veneer,
        "cls": cls_b,
        "saudi": saudi,
        "resident": resident,
    }


def line(svc, price=None, **kw):
    return {
        "service_id": svc.id,
        "price": str(price if price is not None else svc.sale_price),
        **kw,
    }


def test_preview_matches_worked_example_1(client, setup):
    res = client.post(
        "/pricing/preview",
        json={"patient_id": setup["saudi"].id, "lines": [line(setup["cons"]), line(setup["xray"])]},
    ).json()
    assert (res["total"], res["vat"], res["patient_share"], res["insurance_share"]) == (
        "350.00",
        "0.00",
        "110.00",
        "240.00",
    )
    assert res["saudi"] is True and res["insurance"]["class_name"] == "B"
    assert [ln["description_en"] for ln in res["lines"]] == ["Specialist consultation", "Panoramic"]


def test_quotation_numbering_totals_and_server_recalculation(client, setup):
    body = {
        "patient_id": setup["resident"].id,
        "doctor_id": setup["doc"].id,
        "lines": [line(setup["veneer"], teeth=[11, 21], qty="2"), line(setup["xray"])],
    }
    q = client.post("/quotations", json=body).json()
    assert q["quotation_no"].startswith("Q-") and q["status"] == "draft"
    # Veneer excluded (patient pays 2400 + 360 VAT); X-ray 150 + 22.50 VAT, patient 20% = 34.50.
    assert (q["total"], q["vat"]) == ("2932.50", "382.50")
    assert q["patient_share"] == "2794.50" and q["insurance_share"] == "138.00"
    assert q["lines"][0]["teeth"] == [11, 21] and q["valid_until"]
    # Client-sent totals do not exist in the API; editing recalculates.
    upd = client.patch(
        f"/quotations/{q['id']}", json={"version": q["version"], "lines": [line(setup["xray"])]}
    ).json()
    assert upd["total"] == "172.50" and len(upd["lines"]) == 1


def test_price_limits_and_override(client, setup, make_user):
    res = client.post(
        "/quotations",
        json={"patient_id": setup["saudi"].id, "lines": [line(setup["cons"], price="300")]},
    )
    assert res.status_code == 422 and res.json()["detail"]["code"] == "price_out_of_range"
    free = client.post(
        "/quotations",
        json={
            "patient_id": setup["saudi"].id,
            "lines": [{"description_ar": "خدمة خاصة", "price": "50"}],
        },
    )
    assert free.json()["detail"]["code"] == "free_line_needs_override"
    make_user("boss", ["admin"])
    login(client, "boss")
    ok = client.post(
        "/quotations",
        json={"patient_id": setup["saudi"].id, "lines": [line(setup["cons"], price="300")]},
    ).json()
    assert ok["lines"][0]["price_overridden"] is True


def test_cash_choice_and_class_override_needs_permission(client, setup, db):
    cash = client.post(
        "/pricing/preview",
        json={
            "patient_id": setup["resident"].id,
            "lines": [line(setup["xray"])],
            "insurance": {"use_insurance": False},
        },
    ).json()
    assert (cash["patient_share"], cash["insurance"]) == ("172.50", None)
    other = InsuranceClass(
        company_id=setup["cls"].company_id, name="VIP", patient_share_pct=Decimal(0)
    )
    db.add(other)
    db.commit()
    res = client.post(
        "/pricing/preview",
        json={
            "patient_id": setup["resident"].id,
            "lines": [line(setup["xray"])],
            "insurance": {"class_id": other.id},
        },
    )
    assert res.status_code == 403


def test_quotation_lifecycle_and_convert(client, setup):
    q = client.post(
        "/quotations",
        json={
            "patient_id": setup["saudi"].id,
            "doctor_id": setup["doc"].id,
            "lines": [line(setup["cons"])],
        },
    ).json()
    sent = client.post(f"/quotations/{q['id']}/send", json={"version": q["version"]}).json()
    assert sent["status"] == "sent"
    po = client.post(f"/quotations/{q['id']}/convert", json={"version": sent["version"]}).json()
    assert (
        po["order_no"].startswith("PO-")
        and po["quotation_id"] == q["id"]
        and po["total"] == q["total"]
    )
    again = client.get(f"/quotations/{q['id']}").json()
    assert again["status"] == "converted"
    assert (
        client.patch(
            f"/quotations/{q['id']}", json={"version": again["version"], "notes": "x"}
        ).json()["detail"]["code"]
        == "document_closed"
    )


def test_quotation_expires(client, setup, db):
    q = client.post(
        "/quotations", json={"patient_id": setup["saudi"].id, "lines": [line(setup["cons"])]}
    ).json()
    db.execute(
        text("UPDATE quotations SET valid_until = current_date - 1 WHERE id = :i"), {"i": q["id"]}
    )
    db.commit()
    assert client.get(f"/quotations/{q['id']}").json()["status"] == "expired"


def test_payment_order_send_to_reception_inbox(client, setup):
    po = client.post(
        "/payment-orders",
        json={
            "patient_id": setup["saudi"].id,
            "doctor_id": setup["doc"].id,
            "lines": [line(setup["xray"])],
        },
    ).json()
    assert po["status"] == "draft"
    sent = client.post(
        f"/payment-orders/{po['id']}/send",
        json={"version": po["version"], "reception_note": "عاجل"},
    ).json()
    assert sent["status"] == "sent" and sent["sent_by_name"] == "مستخدم reem"
    login(client, "amal")  # reception: payment.collect, no quotation.edit
    inbox = client.get("/payment-orders", params={"status": "sent"}).json()
    assert [x["order_no"] for x in inbox] == [po["order_no"]] and inbox[0][
        "reception_note"
    ] == "عاجل"
    assert client.get("/payment-orders/waiting-count").json() == {"count": 1}
    assert (
        client.post(
            "/payment-orders",
            json={"patient_id": setup["saudi"].id, "lines": [line(setup["xray"])]},
        ).status_code
        == 403
    )


def test_plan_options_accept_installments_and_overdue(client, setup, db):
    body = {
        "patient_id": setup["resident"].id,
        "doctor_id": setup["doc"].id,
        "title": "تقويم",
        "options": [
            {"title": "تقويم ثابت", "price": "9000"},
            {"title": "تقويم شفاف", "price": "15000"},
        ],
        "sessions": [{"description": "تركيب", "teeth": [11]}, {"description": "متابعة 1"}],
    }
    plan = client.post("/treatment-plans", json=body).json()
    assert plan["status"] == "draft" and [s["seq"] for s in plan["sessions"]] == [1, 2]
    assert (
        client.post(
            f"/treatment-plans/{plan['id']}/accept", json={"version": plan["version"]}
        ).json()["detail"]["code"]
        == "option_required"
    )
    acc = client.post(
        f"/treatment-plans/{plan['id']}/accept",
        json={"version": plan["version"], "option_id": plan["options"][1]["id"]},
    ).json()
    assert (
        acc["status"] == "accepted"
        and acc["total_price"] == "15000.00"
        and acc["accepted_option_id"] == plan["options"][1]["id"]
    )
    locked = client.patch(
        f"/treatment-plans/{plan['id']}", json={"version": acc["version"], "total_price": "1"}
    )
    assert locked.json()["detail"]["code"] == "plan_price_locked"
    gen = client.post(
        f"/treatment-plans/{plan['id']}/installments/generate",
        json={
            "version": acc["version"],
            "count": 7,
            "first_due": "2027-01-31",
            "down_payment": "3000",
        },
    ).json()
    amounts = [Decimal(i["amount"]) for i in gen["installments"]]
    assert sum(amounts) == Decimal(15000) and amounts[0] == Decimal(3000) and len(amounts) == 8
    assert [i["due_date"] for i in gen["installments"]][1:3] == [
        "2027-01-31",
        "2027-02-28",
    ]  # month-end clamps
    assert gen["remaining"] == "15000.00"
    # Make the first installment overdue.
    first = gen["installments"][0]["id"]
    db.execute(
        text("UPDATE treatment_plan_installments SET due_date = current_date - 5 WHERE id = :i"),
        {"i": first},
    )
    db.commit()
    overdue = client.get("/treatment-plans/overdue-installments").json()
    assert [(o["installment_id"], o["days_overdue"]) for o in overdue] == [(first, 5)]
    po = client.post(
        f"/treatment-plans/{plan['id']}/installments/{first}/payment-order", json={}
    ).json()
    assert (
        po["status"] == "sent"
        and po["installment_id"] == first
        and po["net"] == "3000.00"
        and po["vat"] == "450.00"
    )
    dup = client.post(f"/treatment-plans/{plan['id']}/installments/{first}/payment-order", json={})
    assert dup.json()["detail"]["code"] == "installment_order_exists"


def test_plan_session_links_to_appointment_and_completes(client, setup, db, make_user):
    plan = client.post(
        "/treatment-plans",
        json={
            "patient_id": setup["saudi"].id,
            "doctor_id": setup["doc"].id,
            "title": "خطة",
            "sessions": [{"description": "حشوة"}],
        },
    ).json()
    sid = plan["sessions"][0]["id"]
    make_user("boss", ["admin"])
    login(client, "boss")
    start = "2031-03-03T10:00:00+03:00"
    a = client.post(
        "/appointments",
        json={
            "patient_id": setup["saudi"].id,
            "doctor_id": setup["doc"].id,
            "starts_at": start,
            "ends_at": "2031-03-03T10:30:00+03:00",
            "plan_session_id": sid,
        },
    ).json()
    assert a["plan_session_id"] == sid
    assert client.get(f"/treatment-plans/{plan['id']}").json()["sessions"][0]["status"] == "booked"
    done = db.scalar(select(AppointmentStatus.id).where(AppointmentStatus.key == "completed"))
    client.post(
        f"/appointments/{a['id']}/status", json={"version": a["version"], "status_id": done}
    )
    assert client.get(f"/treatment-plans/{plan['id']}").json()["sessions"][0]["status"] == "done"
    other = client.post(
        "/appointments",
        json={
            "patient_id": setup["resident"].id,
            "doctor_id": setup["doc"].id,
            "starts_at": "2031-03-04T10:00:00+03:00",
            "ends_at": "2031-03-04T10:30:00+03:00",
            "plan_session_id": sid,
        },
    )
    assert other.json()["detail"]["code"] == "unknown_plan_session"
    assert db.scalar(select(Appointment.id).where(Appointment.plan_session_id == sid))


def test_insurance_class_crud_and_patient_class_link(client, setup, make_user):
    make_user("boss", ["admin"])
    login(client, "boss")
    c = client.post(
        "/insurance-classes",
        json={
            "company_id": setup["cls"].company_id,
            "name": "A",
            "patient_share_pct": "10",
            "max_patient_share_per_invoice": "50",
        },
    )
    assert c.status_code == 201 and c.json()["patient_share_pct"] == "10.00"
    other_company = client.post(
        "/insurance-companies", json={"code": "BUPA", "name_ar": "بوبا", "name_en": "Bupa"}
    ).json()
    p = client.get(f"/patients/{setup['saudi'].id}").json()
    bad = client.patch(
        f"/patients/{p['id']}",
        json={
            "version": p["version"],
            "insurance": {"company_id": other_company["id"], "class_id": c.json()["id"]},
        },
    )
    assert bad.json()["detail"]["code"] == "insurance_class_mismatch"


def test_billing_settings_and_permissions(client, setup, make_user):
    default = client.get("/settings/billing").json()
    assert Decimal(default["vat_rate"]) == Decimal(15) and default["quotation_valid_days"] == 30
    login(client, "amal")
    assert (
        client.post(
            "/quotations", json={"patient_id": setup["saudi"].id, "lines": [line(setup["cons"])]}
        ).status_code
        == 403
    )
    assert client.get("/treatment-plans").status_code == 403
    make_user("boss", ["admin"])
    login(client, "boss")
    assert (
        client.put("/settings/billing", json={"vat_rate": "5", "quotation_valid_days": 10}).json()[
            "quotation_valid_days"
        ]
        == 10
    )
    res = client.post(
        "/pricing/preview",
        json={
            "patient_id": setup["resident"].id,
            "lines": [line(setup["xray"])],
            "insurance": {"use_insurance": False},
        },
    ).json()
    assert res["vat"] == "7.50"
