"""Owner, 2026-11-23: a doctor sees and changes only their own patients and documents; admin,
reception and the accountant see every doctor's calendar and data."""

from datetime import time, timedelta

import pytest
from sqlalchemy import func, select

from app.models import Appointment, AppointmentStatus, Doctor, DoctorSchedule, Patient, Service
from tests.conftest import login


@pytest.fixture
def two(db, make_user):
    ru, ou = make_user("reem", ["doctor"]), make_user("omar", ["doctor"])
    make_user("desk", ["reception"])
    make_user("till", ["cashier"])
    reem, omar = Doctor(name_ar="د. ريم", user_id=ru.id), Doctor(name_ar="د. عمر", user_id=ou.id)
    for d in (reem, omar):
        d.schedules = [
            DoctorSchedule(weekday=w, start_time=time(0), end_time=time(23, 59)) for w in range(7)
        ]
    svc = Service(
        number=950,
        code="SC-1",
        name_ar="كشف",
        name_en="Visit",
        sale_price=100,
        min_price=0,
        max_price=1000,
    )
    a, b = Patient(name_ar="مريضة ريم"), Patient(name_ar="مريض عمر")
    db.add_all([reem, omar, svc, a, b])
    db.flush()
    now = db.scalar(select(func.now()))
    st = db.scalar(select(AppointmentStatus.id).where(AppointmentStatus.key == "confirmed"))
    for pt, doc in ((a, reem), (b, omar)):  # each patient has an appointment with one doctor
        db.add(
            Appointment(
                patient_id=pt.id,
                doctor_id=doc.id,
                starts_at=now,
                ends_at=now + timedelta(minutes=15),
                status_id=st,
                blocks_slot=True,
            )
        )
    db.commit()
    return {"reem": reem, "omar": omar, "a": a, "b": b, "svc": svc}


def test_doctor_sees_only_own_patients(client, two):
    login(client, "reem")
    ids = [p["id"] for p in client.get("/patients").json()["items"]]
    assert two["a"].id in ids and two["b"].id not in ids
    assert [p["id"] for p in client.get("/patients/search", params={"q": "مريض"}).json()] == [
        two["a"].id
    ]
    b = two["b"].id
    for url in (
        f"/patients/{b}",
        f"/patients/{b}/health",
        f"/patients/{b}/dental",
        f"/patients/{b}/files",
        f"/patients/{b}/prescriptions",
        f"/patients/{b}/lab-requests",
        f"/patients/{b}/medical-reports",
    ):
        assert client.get(url).status_code == 404, url
    assert client.get(f"/patients/{two['a'].id}").status_code == 200
    login(client, "desk")  # reception: everyone
    ids = [p["id"] for p in client.get("/patients").json()["items"]]
    assert {two["a"].id, two["b"].id} <= set(ids)


def test_doctor_bills_only_own_patients_in_own_name(client, two):
    login(client, "reem")
    line = [{"service_id": two["svc"].id, "price": "100"}]
    mine = client.post("/payment-orders", json={"patient_id": two["a"].id, "lines": line})
    assert mine.status_code == 201 and mine.json()["doctor_id"] == two["reem"].id  # filled in
    other_doc = client.post(
        "/payment-orders",
        json={"patient_id": two["a"].id, "doctor_id": two["omar"].id, "lines": line},
    )
    assert other_doc.json()["detail"]["code"] == "other_doctor"
    assert (
        client.post("/payment-orders", json={"patient_id": two["b"].id, "lines": line}).status_code
        == 404
    )
    assert (
        client.post("/quotations", json={"patient_id": two["b"].id, "lines": line}).status_code
        == 404
    )
    plan = {
        "patient_id": two["a"].id,
        "doctor_id": two["omar"].id,
        "title": "خطة",
        "total_price": "500",
    }
    assert client.post("/treatment-plans", json=plan).json()["detail"]["code"] == "other_doctor"
    # Omar's documents: invisible to reem and closed to her changes.
    login(client, "omar")
    po = client.post("/payment-orders", json={"patient_id": two["b"].id, "lines": line}).json()
    q = client.post("/quotations", json={"patient_id": two["b"].id, "lines": line}).json()
    pl = client.post("/treatment-plans", json={**plan, "patient_id": two["b"].id}).json()
    login(client, "reem")
    assert all(o["id"] != po["id"] for o in client.get("/payment-orders").json())
    assert all(o["id"] != q["id"] for o in client.get("/quotations").json())
    assert all(o["id"] != pl["id"] for o in client.get("/treatment-plans").json())
    assert client.get(f"/payment-orders/{po['id']}").status_code == 404
    assert client.get(f"/quotations/{q['id']}").status_code == 404
    assert client.get(f"/treatment-plans/{pl['id']}").status_code == 404
    for url, body in (
        (f"/payment-orders/{po['id']}", {"version": po["version"], "notes": "x"}),
        (f"/quotations/{q['id']}", {"version": q["version"], "notes": "x"}),
        (f"/treatment-plans/{pl['id']}", {"version": pl["version"], "title": "x"}),
    ):
        assert client.patch(url, json=body).status_code == 403, url
    assert (
        client.post(f"/payment-orders/{po['id']}/send", json={"version": po["version"]}).status_code
        == 403
    )
    assert (
        client.post(
            f"/payment-orders/{po['id']}/cancel", json={"version": po["version"]}
        ).status_code
        == 403
    )
    # Reception sees and collects everyone's.
    login(client, "desk")
    assert any(o["id"] == po["id"] for o in client.get("/payment-orders").json())


def test_calendars_doctors_own_staff_all(client, two):
    params = {"start": "2000-01-01T00:00:00+03:00", "end": "2100-01-01T00:00:00+03:00"}
    login(client, "reem")
    assert {a["doctor_id"] for a in client.get("/appointments", params=params).json()} == {
        two["reem"].id
    }
    for user in ("desk", "till"):  # reception and the accountant see every doctor's calendar
        login(client, user)
        docs = {a["doctor_id"] for a in client.get("/appointments", params=params).json()}
        assert docs == {two["reem"].id, two["omar"].id}, user


def test_doctor_who_manages_sees_everything(client, two, make_user, db):
    """A doctor given 'see every doctor' (e.g. the clinic's director) is not limited."""
    from app.models import Role, RolePermission

    role = Role(key="director", name_ar="مدير طبي", name_en="Medical director")
    db.add(role)
    db.flush()
    for perm in ("patient.view", "appointment.view", "appointment.view_all"):
        db.add(RolePermission(role_id=role.id, permission=perm))
    u = make_user("chief", ["director"])
    db.add(Doctor(name_ar="د. المدير", user_id=u.id))
    db.commit()
    login(client, "chief")
    assert client.get(f"/patients/{two['b'].id}").status_code == 200
