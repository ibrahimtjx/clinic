from datetime import time, timedelta

import pytest
from sqlalchemy import func, select

from app.models import Appointment, AppointmentStatus, Doctor, DoctorSchedule, Patient, QueueEntry
from tests.conftest import login


@pytest.fixture
def setup(db, make_user, client):
    make_user("amal", ["reception"])
    doc = Doctor(name_ar="د. ريم", slot_minutes=15)
    doc.schedules = [DoctorSchedule(weekday=d, start_time=time(0), end_time=time(23, 59), kind="work") for d in range(7)]
    doc2 = Doctor(name_ar="د. عمر", slot_minutes=15)
    p1, p2 = Patient(name_ar="سارة"), Patient(name_ar="نورة")
    db.add_all([doc, doc2, p1, p2])
    db.commit()
    login(client, "amal")
    return {"doc": doc, "doc2": doc2, "p1": p1, "p2": p2}


def send(client, s, patient="p1", doc="doc", **kw):
    return client.post("/queue", json={"patient_id": s[patient].id, "doctor_id": s[doc].id, **kw})


def status_key(db, appt_id):
    db.expire_all()
    a = db.get(Appointment, appt_id)
    return db.get(AppointmentStatus, a.status_id).key


def test_send_numbers_per_day_and_refuses_double(client, setup):
    a = send(client, setup).json()
    b = send(client, setup, patient="p2").json()
    assert (a["queue_no"], b["queue_no"]) == (1, 2)
    assert a["stage"] == "waiting" and a["patient_name_ar"] == "سارة" and a["user_names"]["received_by"] == "مستخدم amal"
    again = send(client, setup)
    assert again.status_code == 409 and again.json()["detail"] == {"code": "already_in_queue", "queue_no": 1, "entry_id": a["id"]}


def test_full_flow_stamps_and_syncs_appointment(client, setup, db):
    now = db.scalar(select(func.now()))
    unconf = db.scalar(select(AppointmentStatus.id).where(AppointmentStatus.key == "unconfirmed"))
    appt = Appointment(patient_id=setup["p1"].id, doctor_id=setup["doc"].id, starts_at=now, ends_at=now + timedelta(minutes=15), status_id=unconf, blocks_slot=True)
    db.add(appt)
    db.commit()
    q = send(client, setup, appointment_id=appt.id, note="أولوية").json()
    assert status_key(db, appt.id) == "arrived"
    assert client.post(f"/queue/{q['id']}/finish").json()["detail"]["code"] == "not_started"
    called = client.post(f"/queue/{q['id']}/call").json()
    assert called["stage"] == "called" and called["called_at"]
    started = client.post(f"/queue/{q['id']}/start").json()
    assert started["stage"] == "with_doctor" and status_key(db, appt.id) == "with_doctor"
    done = client.post(f"/queue/{q['id']}/finish").json()
    assert done["stage"] == "done" and done["user_names"]["exited_by"] == "مستخدم amal"
    assert status_key(db, appt.id) == "completed"
    assert db.get(Patient, setup["p1"].id).last_visit_at is not None
    assert client.post(f"/queue/{q['id']}/call").json()["detail"]["code"] == "queue_closed"
    # Finished: the same patient can be sent again later the same day.
    assert send(client, setup).status_code == 201


def test_postpone_goes_to_back_and_transfer_resets(client, setup):
    a = send(client, setup).json()
    send(client, setup, patient="p2")
    client.post(f"/queue/{a['id']}/call")
    post = client.post(f"/queue/{a['id']}/postpone").json()
    assert post["postponed"] and post["called_at"] is None
    order = [x["queue_no"] for x in client.get("/queue").json()]
    assert order == [2, 1]
    moved = client.post(f"/queue/{a['id']}/transfer", json={"doctor_id": setup["doc2"].id}).json()
    assert moved["doctor_id"] == setup["doc2"].id and moved["stage"] == "waiting"
    only = client.get("/queue", params={"doctor_id": setup["doc2"].id}).json()
    assert [x["id"] for x in only] == [a["id"]]
    assert client.post(f"/queue/{a['id']}/note", json={"note": "يحتاج كرسي متحرك"}).json()["note"] == "يحتاج كرسي متحرك"


def test_left_without_being_seen(client, setup):
    a = send(client, setup).json()
    left = client.post(f"/queue/{a['id']}/left").json()
    assert left["stage"] == "left"
    b = send(client, setup, patient="p2").json()
    client.post(f"/queue/{b['id']}/start")
    assert client.post(f"/queue/{b['id']}/left").json()["detail"]["code"] == "already_with_doctor"


def test_waited_minutes_and_report_totals(client, setup, db):
    a = send(client, setup).json()
    b = send(client, setup, patient="p2").json()
    # Pretend a waited 20 minutes before starting.
    e = db.get(QueueEntry, a["id"])
    e.received_at = e.received_at - timedelta(minutes=20)
    db.commit()
    started = client.post(f"/queue/{a['id']}/start").json()
    assert started["waited_minutes"] == 20
    day = a["day"]
    rep = client.get("/queue/report", params={"from": day, "to": day}).json()
    assert (rep["total"], rep["seen"], rep["not_seen"]) == (2, 1, 1) and rep["average_wait_minutes"] == 20.0
    assert client.get("/queue/report", params={"from": day, "to": day, "doctor_id": setup["doc2"].id}).json()["total"] == 0
    assert b["waited_minutes"] == 0


def test_queue_permissions_and_settings(client, setup, make_user):
    make_user("faisal", ["cashier"])
    login(client, "faisal")
    assert client.get("/queue").status_code == 403
    make_user("reem", ["doctor"])
    login(client, "reem")
    assert client.get("/queue").status_code == 200  # doctors call and start their own patients
    assert client.get("/settings/queue").json() == {"warn_minutes": 15, "late_minutes": 30}
    assert client.put("/settings/queue", json={"warn_minutes": 10, "late_minutes": 20}).status_code == 403
    make_user("boss", ["admin"])
    login(client, "boss")
    assert client.put("/settings/queue", json={"warn_minutes": 10, "late_minutes": 20}).json()["late_minutes"] == 20
    assert client.put("/settings/queue", json={"warn_minutes": 20, "late_minutes": 10}).json()["detail"]["code"] == "late_before_warn"


def test_validation(client, setup):
    assert client.post("/queue", json={"patient_id": 999999, "doctor_id": setup["doc"].id}).json()["detail"]["code"] == "unknown_patient"
    assert send(client, setup, appointment_id=999999).json()["detail"]["code"] == "unknown_appointment"
    assert client.post("/queue/999999/call").status_code == 404
