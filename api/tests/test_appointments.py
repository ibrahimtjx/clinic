import threading
from datetime import time

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.models import (
    AppointmentStatus,
    AuditLog,
    Doctor,
    DoctorSchedule,
    Patient,
    Service,
    VisitType,
)
from tests.conftest import TEST_URL, login

SUN = "2027-01-03"  # a Sunday
MON = "2027-01-04"


def at(day: str, hm: str) -> str:
    return f"{day}T{hm}:00+03:00"


@pytest.fixture
def setup(db, make_user):
    make_user("amal", ["reception"])
    doc = Doctor(name_ar="د. ريم", name_en="Dr. Reem", slot_minutes=15, sort_order=10)
    doc.schedules = (
        [
            DoctorSchedule(weekday=d, start_time=time(9), end_time=time(13), kind="work")
            for d in range(5)
        ]
        + [
            DoctorSchedule(weekday=d, start_time=time(16), end_time=time(21), kind="work")
            for d in range(5)
        ]
        + [DoctorSchedule(weekday=0, start_time=time(11), end_time=time(11, 30), kind="break")]
    )
    doc2 = Doctor(name_ar="د. عمر", name_en="Dr. Omar", slot_minutes=30, sort_order=20)
    doc2.schedules = [
        DoctorSchedule(weekday=d, start_time=time(9), end_time=time(12), kind="work")
        for d in range(5)
    ]
    p1 = Patient(name_ar="سارة", name_en="Sara", mobile="0551111111")
    p2 = Patient(name_ar="نورة", name_en="Noura", mobile="0552222222")
    db.add_all([doc, doc2, p1, p2])
    db.commit()
    return {"doc": doc, "doc2": doc2, "p1": p1, "p2": p2}


def status_id(db, key):
    return db.scalar(select(AppointmentStatus.id).where(AppointmentStatus.key == key))


def book(client, s, patient="p1", doc="doc", day=SUN, start="09:00", end="09:15", **kw):
    return client.post(
        "/appointments",
        json={
            "patient_id": s[patient].id,
            "doctor_id": s[doc].id,
            "starts_at": at(day, start),
            "ends_at": at(day, end),
            **kw,
        },
    )


def test_book_defaults_to_unconfirmed_and_blocks(client, setup, db):
    login(client, "amal")
    res = book(client, setup)
    assert res.status_code == 201, res.text
    a = res.json()
    assert a["status_id"] == status_id(db, "unconfirmed") and a["blocks_slot"] is True
    assert a["starts_at"] == "2027-01-03T09:00:00+03:00"
    assert a["patient"]["is_new"] is True and a["patient"]["appointment_count"] == 1
    assert a["created_by_name"] == "مستخدم amal"


def test_overlap_refused_with_details(client, setup):
    login(client, "amal")
    first = book(client, setup).json()
    res = book(client, setup, patient="p2", start="09:10", end="09:25")
    assert res.status_code == 409
    d = res.json()["detail"]
    assert (
        d["code"] == "overlap"
        and d["appointment_id"] == first["id"]
        and d["patient_name"] == "سارة"
    )
    # Touching edges are fine; another doctor at the same time is fine.
    assert book(client, setup, patient="p2", start="09:15", end="09:30").status_code == 201
    assert (
        book(
            client,
            setup,
            patient="p2",
            doc="doc2",
            start="09:00",
            end="09:30",
            acknowledge=["same_day"],
        ).status_code
        == 201
    )


def test_database_enforces_no_overlap_even_without_the_api(db, setup):
    unconf = status_id(db, "unconfirmed")
    ins = text(
        "INSERT INTO appointments (patient_id, doctor_id, starts_at, ends_at, status_id, blocks_slot) "
        "VALUES (:p, :d, :s, :e, :st, :b)"
    )
    db.execute(
        ins,
        {
            "p": setup["p1"].id,
            "d": setup["doc"].id,
            "s": at(SUN, "10:00"),
            "e": at(SUN, "10:30"),
            "st": unconf,
            "b": True,
        },
    )
    with pytest.raises(Exception, match="ex_appointments_doctor_overlap"), db.begin_nested():
        db.execute(
            ins,
            {
                "p": setup["p2"].id,
                "d": setup["doc"].id,
                "s": at(SUN, "10:15"),
                "e": at(SUN, "10:45"),
                "st": unconf,
                "b": True,
            },
        )
    # A non-blocking row (e.g. cancelled) may overlap.
    db.execute(
        ins,
        {
            "p": setup["p2"].id,
            "d": setup["doc"].id,
            "s": at(SUN, "10:15"),
            "e": at(SUN, "10:45"),
            "st": unconf,
            "b": False,
        },
    )


def test_concurrent_bookings_only_one_wins(engine, setup, db):
    """Two receptionists book the same slot at the same moment, on separate connections."""
    db.commit()
    eng = create_engine(TEST_URL)
    unconf = status_id(db, "unconfirmed")
    # Rows created by the fixture live in the test transaction; make visible ones for the threads.
    with eng.begin() as c:
        doc = c.execute(
            text("INSERT INTO doctors (name_ar, slot_minutes) VALUES ('د. سباق', 15) RETURNING id")
        ).scalar_one()
        pat = c.execute(
            text("INSERT INTO patients (name_ar) VALUES ('سباق') RETURNING id")
        ).scalar_one()
    results = []
    barrier = threading.Barrier(2)

    def worker():
        with Session(eng) as s:
            barrier.wait()
            try:
                s.execute(
                    text(
                        "INSERT INTO appointments (patient_id, doctor_id, starts_at, ends_at, status_id, blocks_slot) VALUES (:p,:d,:s,:e,:st,true)"
                    ),
                    {
                        "p": pat,
                        "d": doc,
                        "s": at(SUN, "12:00"),
                        "e": at(SUN, "12:15"),
                        "st": unconf,
                    },
                )
                s.commit()
                results.append("ok")
            except Exception as e:  # noqa: BLE001
                results.append(type(e.orig).__name__ if hasattr(e, "orig") else str(e))

    ts = [threading.Thread(target=worker) for _ in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert sorted(results) == ["ExclusionViolation", "ok"]
    with eng.begin() as c:
        c.execute(text("DELETE FROM appointments WHERE doctor_id = :d"), {"d": doc})
        c.execute(text("DELETE FROM doctors WHERE id = :d"), {"d": doc})
        c.execute(text("DELETE FROM patients WHERE id = :p"), {"p": pat})
    eng.dispose()


def test_warnings_same_day_and_outside_hours(client, setup, make_user, db):
    # Take the override permission away from reception for this test.
    db.execute(
        text(
            "DELETE FROM role_permissions WHERE permission = 'appointment.override_hours' AND role_id = (SELECT id FROM roles WHERE key = 'reception')"
        )
    )
    db.commit()
    login(client, "amal")
    book(client, setup)
    res = book(client, setup, start="16:00", end="16:15")
    assert res.status_code == 409 and res.json()["detail"] == {
        "code": "needs_confirmation",
        "warnings": ["same_day"],
    }
    assert (
        book(client, setup, start="16:00", end="16:15", acknowledge=["same_day"]).status_code == 201
    )
    # Break 11:00-11:30 and after hours.
    for start, end in [("11:00", "11:15"), ("13:00", "13:15"), ("12:50", "13:05")]:
        res = book(client, setup, patient="p2", start=start, end=end)
        assert res.json()["detail"]["warnings"] == ["outside_hours"], (start, end)
    # Without appointment.override_hours the user cannot continue.
    res = book(
        client, setup, patient="p2", start="13:00", end="13:15", acknowledge=["outside_hours"]
    )
    assert res.status_code == 403 and res.json()["detail"]["missing"] == [
        "appointment.override_hours"
    ]
    make_user("boss", ["admin"])
    login(client, "boss")
    assert (
        book(
            client, setup, patient="p2", start="13:00", end="13:15", acknowledge=["outside_hours"]
        ).status_code
        == 201
    )


def test_move_resize_and_conflict(client, setup):
    login(client, "amal")
    a = book(client, setup).json()
    b = book(client, setup, patient="p2", start="09:30", end="09:45").json()
    moved = client.patch(
        f"/appointments/{a['id']}",
        json={"version": a["version"], "starts_at": at(SUN, "10:00"), "ends_at": at(SUN, "10:30")},
    )
    assert moved.status_code == 200 and moved.json()["ends_at"].startswith("2027-01-03T10:30")
    clash = client.patch(
        f"/appointments/{b['id']}",
        json={"version": b["version"], "starts_at": at(SUN, "10:15"), "ends_at": at(SUN, "10:30")},
    )
    assert clash.json()["detail"]["code"] == "overlap"
    stale = client.patch(f"/appointments/{a['id']}", json={"version": a["version"], "note": "x"})
    assert stale.json()["detail"]["code"] == "stale_record"
    other_doc = client.patch(
        f"/appointments/{b['id']}", json={"version": b["version"], "doctor_id": setup["doc2"].id}
    )
    assert other_doc.status_code == 200 and other_doc.json()["doctor_id"] == setup["doc2"].id
    bad = client.patch(
        f"/appointments/{a['id']}",
        json={"version": moved.json()["version"], "ends_at": at(SUN, "09:00")},
    )
    assert bad.json()["detail"]["code"] == "invalid_times"


def test_status_changes_copy_blocks_slot(client, setup, db):
    login(client, "amal")
    a = book(client, setup).json()
    conf = client.post(
        f"/appointments/{a['id']}/status",
        json={"version": a["version"], "status_id": status_id(db, "confirmed")},
    ).json()
    assert conf["confirmed_by_name"] == "مستخدم amal" and conf["confirmed_at"]
    no_reason = client.post(
        f"/appointments/{a['id']}/status",
        json={"version": conf["version"], "status_id": status_id(db, "cancelled")},
    )
    assert no_reason.json()["detail"]["code"] == "cancel_reason_required"
    canc = client.post(
        f"/appointments/{a['id']}/status",
        json={
            "version": conf["version"],
            "status_id": status_id(db, "cancelled"),
            "cancel_reason": "سافر",
        },
    ).json()
    assert canc["blocks_slot"] is False and canc["cancel_reason"] == "سافر"
    # The slot is free again.
    b = book(client, setup, patient="p2").json()
    # Reinstating the cancelled booking now clashes.
    back = client.post(
        f"/appointments/{a['id']}/status",
        json={"version": canc["version"], "status_id": status_id(db, "confirmed")},
    )
    assert (
        back.json()["detail"]["code"] == "overlap"
        and back.json()["detail"]["appointment_id"] == b["id"]
    )


def test_completed_updates_last_visit(client, setup, db):
    login(client, "amal")
    a = book(client, setup).json()
    client.post(
        f"/appointments/{a['id']}/status",
        json={"version": a["version"], "status_id": status_id(db, "completed")},
    )
    db.expire_all()
    assert db.get(Patient, setup["p1"].id).last_visit_at.isoformat() == "2027-01-03T09:00:00+03:00"


def test_list_by_range_doctor_patient_and_badges(client, setup, db):
    login(client, "amal")
    book(client, setup)
    book(client, setup, day=MON, start="09:00", end="09:15")
    book(client, setup, patient="p2", doc="doc2", start="09:00", end="09:30")
    day = client.get(
        "/appointments", params={"start": at(SUN, "00:00"), "end": at(MON, "00:00")}
    ).json()
    assert len(day) == 2
    only = client.get(
        "/appointments",
        params={
            "start": at(SUN, "00:00"),
            "end": at(MON, "00:00"),
            "doctor_ids": str(setup["doc2"].id),
        },
    ).json()
    assert [x["patient"]["name_ar"] for x in only] == ["نورة"]
    mine = client.get("/appointments", params={"patient_id": setup["p1"].id}).json()
    assert [x["patient"]["is_new"] for x in mine] == [True, False] and mine[0]["patient"][
        "appointment_count"
    ] == 2
    assert client.get("/appointments").json()["detail"]["code"] == "range_required"


def test_refs_validated(client, setup, db):
    login(client, "amal")
    assert (
        book(client, setup, visit_type_id=999999).json()["detail"]["code"] == "unknown_visit_type"
    )
    vt = db.scalar(select(VisitType.id).limit(1))
    svc = db.scalar(select(Service.id).limit(1))
    assert book(client, setup, visit_type_id=vt, service_id=svc).status_code == 201
    assert (
        client.post(
            "/appointments",
            json={
                "patient_id": 999999,
                "doctor_id": setup["doc"].id,
                "starts_at": at(SUN, "10:00"),
                "ends_at": at(SUN, "10:15"),
            },
        ).json()["detail"]["code"]
        == "unknown_patient"
    )
    assert (
        client.post(
            "/appointments",
            json={
                "patient_id": setup["p1"].id,
                "doctor_id": setup["doc"].id,
                "starts_at": "2027-01-03T10:00:00",
                "ends_at": "2027-01-03T10:15:00",
            },
        ).status_code
        == 422
    )


def test_soft_delete_and_permissions(client, setup, make_user, db):
    login(client, "amal")
    a = book(client, setup).json()
    make_user("reem", ["doctor"])  # no appointment.delete
    login(client, "reem")
    assert client.delete(f"/appointments/{a['id']}").status_code == 403
    login(client, "amal")
    assert client.delete(f"/appointments/{a['id']}").status_code == 204
    assert client.get(f"/appointments/{a['id']}").status_code == 404
    assert book(client, setup, patient="p2").status_code == 201  # slot free again
    make_user("faisal", ["cashier"])
    login(client, "faisal")
    assert client.get("/appointments", params={"patient_id": setup["p1"].id}).status_code == 403
    actions = db.scalars(
        select(AuditLog.action).where(
            AuditLog.table_name == "appointments", AuditLog.record_id == str(a["id"])
        )
    ).all()
    assert actions == ["create", "delete"]


def test_free_slots(client, setup, db):
    login(client, "amal")
    book(client, setup, start="09:00", end="09:30")
    res = client.get(
        "/appointments/free-slots",
        params={
            "duration": 30,
            "doctor_ids": str(setup["doc"].id),
            "from": SUN,
            "to": SUN,
            "limit": 6,
        },
    ).json()
    starts = [r["starts_at"][11:16] for r in res]
    # 09:00-09:30 booked; break 11:00-11:30 skipped; 15-minute steps.
    assert starts == ["09:30", "09:45", "10:00", "10:15", "10:30", "11:30"]
    pref = client.get(
        "/appointments/free-slots",
        params={
            "duration": 30,
            "from": SUN,
            "to": MON,
            "preferred_from": "16:00",
            "preferred_to": "17:00",
            "limit": 10,
        },
    ).json()
    assert {r["starts_at"][11:16] for r in pref} == {"16:00", "16:15", "16:30"} and {
        r["doctor_id"] for r in pref
    } == {setup["doc"].id}
    mon_only = client.get(
        "/appointments/free-slots",
        params={
            "duration": 30,
            "doctor_ids": str(setup["doc2"].id),
            "from": SUN,
            "to": MON,
            "weekdays": "1",
            "limit": 2,
        },
    ).json()
    assert [r["starts_at"] for r in mon_only] == [at(MON, "09:00"), at(MON, "09:30")]


def test_free_slots_never_in_the_past(client, setup):
    login(client, "amal")
    res = client.get(
        "/appointments/free-slots",
        params={"duration": 15, "from": "2020-01-01", "to": "2020-01-05"},
    )
    assert res.json() == []


def test_waiting_list_and_matches(client, setup, db):
    login(client, "amal")
    a = book(client, setup, start="10:00", end="10:15").json()
    later = book(client, setup, patient="p2", day=MON, start="16:00", end="16:15").json()
    w = client.post(
        f"/appointments/{later['id']}/waiting-list",
        json={
            "preferred_days": [0],
            "preferred_from": "09:00",
            "preferred_to": "12:00",
            "note": "أي وقت صباحاً",
        },
    ).json()
    assert (
        w["appointment_id"] == later["id"]
        and w["doctor_id"] == setup["doc"].id
        and w["preferred_days"] == [0]
    )
    assert client.get(f"/appointments/{later['id']}").json()["is_waiting_list"] is True
    other = client.post(
        "/waiting-list", json={"patient_id": setup["p1"].id, "doctor_id": setup["doc2"].id}
    ).json()
    assert len(client.get("/waiting-list").json()) == 2
    # Cancel a's Sunday morning slot: only the matching entry is offered.
    client.post(
        f"/appointments/{a['id']}/status",
        json={
            "version": a["version"],
            "status_id": status_id(db, "cancelled"),
            "cancel_reason": "x",
        },
    )
    m = client.get(
        "/waiting-list/matches",
        params={"doctor_id": setup["doc"].id, "starts_at": a["starts_at"], "ends_at": a["ends_at"]},
    ).json()
    assert [x["id"] for x in m] == [w["id"]]
    evening = client.get(
        "/waiting-list/matches",
        params={
            "doctor_id": setup["doc"].id,
            "starts_at": at(SUN, "17:00"),
            "ends_at": at(SUN, "17:15"),
        },
    ).json()
    assert evening == []
    done = client.post(f"/waiting-list/{w['id']}/resolve").json()
    assert (
        done["resolved_at"]
        and client.get(f"/appointments/{later['id']}").json()["is_waiting_list"] is False
    )
    assert [x["id"] for x in client.get("/waiting-list").json()] == [other["id"]]
