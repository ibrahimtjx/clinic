# ruff: noqa: F811
"""Edge cases for patients, appointments, queue, users and settings lists (not the happy path)."""

from datetime import date, timedelta

from sqlalchemy import func, select

from app.models import Doctor, Patient
from tests.conftest import login
from tests.test_appointments import MON, SUN, at, book, setup, status_id  # noqa: F401


# ---------------------------------------------------------------- patients
def test_patient_edge_values(client, setup, db):
    login(client, "amal")
    future = (date.today() + timedelta(days=3)).isoformat()
    r = client.post("/patients", json={"name_ar": "مولود المستقبل", "dob": future})
    assert r.status_code == 422, ("future dob", r.text)
    r = client.post("/patients", json={"name_ar": "معمر", "dob": "1850-01-01"})
    assert r.status_code == 422, ("dob 1850", r.text)
    p = client.post("/patients", json={"name_ar": "سارة علي"}).json()
    r = client.patch(f"/patients/{p['id']}", json={"version": p["version"], "name_ar": ""})
    assert r.status_code == 422, ("empty name on update", r.text)
    r = client.patch(f"/patients/{p['id']}", json={"version": p["version"], "name_ar": "  "})
    assert r.status_code == 422, ("blank name on update", r.text)


def test_patient_search_with_special_characters(client, setup):
    login(client, "amal")
    for q in ["%", "_", "\\", "'; drop table patients; --", "a" * 300, "٪", "(", "*"]:
        r = client.get("/patients", params={"q": q})
        assert r.status_code in (200, 422), (q, r.status_code, r.text)
        if q in ("%", "_"):
            assert r.json()["total"] == 0, (q, "wildcard matched everything")


def test_duplicate_national_id_on_update_is_flagged(client, setup):
    # Like on registration, a duplicate is a warning (the edit form asks /duplicates), not a block.
    login(client, "amal")
    a = client.post("/patients", json={"name_ar": "أحمد", "national_id": "1011111111"}).json()
    b = client.post("/patients", json={"name_ar": "خالد", "national_id": "1022222222"}).json()
    dups = client.get(
        "/patients/duplicates", params={"national_id": "1011111111", "exclude_id": b["id"]}
    ).json()
    assert [d["id"] for d in dups] == [a["id"]]


# ---------------------------------------------------------------- appointments
def test_appointment_bad_times(client, setup):
    login(client, "amal")
    assert book(client, setup, start="10:00", end="09:45").status_code == 422  # ends before start
    assert book(client, setup, start="10:00", end="10:00").status_code == 422  # zero length
    r = client.post(
        "/appointments",
        json={
            "patient_id": setup["p1"].id,
            "doctor_id": setup["doc"].id,
            "starts_at": at(SUN, "10:00"),
            "ends_at": at(MON, "10:00"),
        },
    )
    assert r.status_code == 422, ("24-hour appointment", r.text)
    r = client.post(
        "/appointments",
        json={
            "patient_id": setup["p1"].id,
            "doctor_id": setup["doc"].id,
            "starts_at": f"{SUN}T10:00:00",
            "ends_at": f"{SUN}T10:15:00",
        },
    )
    assert r.status_code in (201, 422), r.text  # naive time: either read as clinic time or refused
    if r.status_code == 201:
        assert r.json()["starts_at"].startswith(f"{SUN}T10:00:00+03:00"), r.json()["starts_at"]


def test_booking_inactive_or_deleted_doctor_and_patient(client, setup, db):
    login(client, "amal")
    doc = db.get(Doctor, setup["doc2"].id)
    doc.is_active = False
    db.commit()
    r = book(client, setup, doc="doc2", start="09:00", end="09:30")
    assert r.status_code in (409, 422), ("inactive doctor", r.text)
    pt = db.get(Patient, setup["p2"].id)
    pt.deleted_at = db.scalar(select(func.now()))
    db.commit()
    r = book(client, setup, patient="p2", start="10:00", end="10:15")
    assert r.status_code in (404, 409, 422), ("deleted patient", r.text)


def test_cancel_needs_reason_and_status_changes(client, setup, db):
    login(client, "amal")
    a = book(client, setup).json()
    r = client.post(
        f"/appointments/{a['id']}/status",
        json={"version": a["version"], "status_id": status_id(db, "cancelled")},
    )
    assert r.status_code == 422, ("cancel without a reason", r.text)
    r = client.post(
        f"/appointments/{a['id']}/status",
        json={"version": a["version"], "status_id": 999999},
    )
    assert r.status_code in (404, 422), r.text


# ---------------------------------------------------------------- queue
def test_queue_bad_moves(client, setup, db):
    login(client, "amal")
    e = client.post(
        "/queue", json={"patient_id": setup["p1"].id, "doctor_id": setup["doc"].id}
    ).json()
    assert client.post(f"/queue/{e['id']}/transfer", json={"doctor_id": 999999}).status_code in (
        404,
        422,
    )
    same = client.post(f"/queue/{e['id']}/transfer", json={"doctor_id": setup["doc"].id})
    assert same.status_code in (200, 409, 422), same.text
    assert client.post(f"/queue/{e['id']}/left").status_code == 200
    for action in ("call", "start", "finish", "postpone"):
        r = client.post(f"/queue/{e['id']}/{action}")
        assert r.status_code in (409, 422), (action, r.status_code, r.text)
    r = client.post("/queue", json={"patient_id": 999999, "doctor_id": setup["doc"].id})
    assert r.status_code in (404, 422)


# ---------------------------------------------------------------- users, roles
def test_admin_cannot_lock_themselves_out(client, make_user, db):
    me = make_user("boss", ["admin"])
    login(client, "boss")
    r = client.post(f"/users/{me.id}/deactivate")
    assert r.status_code in (409, 422), ("deactivating the last admin (yourself)", r.text)


def test_role_in_use_and_unknown_permission(client, make_user):
    make_user("boss", ["admin"])
    login(client, "boss")
    r = client.post(
        "/roles",
        json={"key": "nurse", "name_ar": "تمريض", "name_en": "Nurse", "permissions": ["no.such"]},
    )
    assert r.status_code == 422, r.text
    role = client.post(
        "/roles",
        json={
            "key": "nurse",
            "name_ar": "تمريض",
            "name_en": "Nurse",
            "permissions": ["patient.view"],
        },
    ).json()
    u = client.post(
        "/users",
        json={
            "username": "nurse1",
            "full_name_ar": "ممرضة",
            "password": "Nurse-Pass-2026",
            "role_ids": [role["id"]],
        },
    )
    assert u.status_code == 201, u.text
    d = client.delete(f"/roles/{role['id']}")
    assert d.status_code in (409, 422), ("deleting a role still given to a user", d.text)


# ---------------------------------------------------------------- settings lists
def test_service_price_range_must_make_sense(client, make_user):
    make_user("boss", ["admin"])
    login(client, "boss")
    body = {"code": "EDGE1", "name_ar": "خدمة", "name_en": "Service"}
    r = client.post(
        "/services", json={**body, "sale_price": "100", "min_price": "150", "max_price": "120"}
    )
    assert r.status_code == 422, ("min above max", r.text)
    r = client.post(
        "/services", json={**body, "sale_price": "300", "min_price": "100", "max_price": "200"}
    )
    assert r.status_code == 422, ("sale price outside its own range", r.text)
    ok = client.post(
        "/services", json={**body, "sale_price": "100", "min_price": "80", "max_price": "120"}
    )
    assert ok.status_code == 201, ok.text
    dup = client.post(
        "/services",
        json={**body, "code": "edge1", "sale_price": "1", "min_price": "1", "max_price": "1"},
    )
    assert dup.status_code in (409, 422), ("same code, other case", dup.text)


def test_doctor_schedule_and_department_checks(client, make_user):
    make_user("boss", ["admin"])
    login(client, "boss")
    r = client.post(
        "/doctors",
        json={
            "name_ar": "د. تجربة",
            "schedules": [
                {"weekday": 0, "start_time": "09:00", "end_time": "08:00", "kind": "work"}
            ],
        },
    )
    assert r.status_code == 422
    r = client.post("/doctors", json={"name_ar": "د. تجربة", "department_id": 999999})
    assert r.status_code == 422
    r = client.post("/doctors", json={"name_ar": "د. تجربة", "room": "x" * 51})
    assert r.status_code == 422


def test_queue_settings_and_dental_settings_bounds(client, make_user):
    make_user("boss", ["admin"])
    login(client, "boss")
    assert (
        client.put("/settings/queue", json={"warn_minutes": 30, "late_minutes": 10}).status_code
        == 422
    )
    assert client.put("/settings/dental", json={"edit_hours": -1}).status_code == 422
    assert client.put("/settings/clinic", json={"vat_number": "123"}).status_code == 422


def test_department_overview_missing_and_deleted(client, make_user, db):
    make_user("boss", ["admin"])
    login(client, "boss")
    assert client.get("/departments/999999/overview").status_code == 404
    d = client.post("/departments", json={"name_ar": "قسم", "name_en": "Dept"}).json()
    assert client.get(f"/departments/{d['id']}/overview").json()["doctors"] == []
    client.delete(f"/departments/{d['id']}")
    assert client.get(f"/departments/{d['id']}/overview").status_code == 404


# ---------------------------------------------------------------- reports
def test_reports_bad_ranges(client, make_user):
    make_user("boss", ["admin"])
    login(client, "boss")
    keys = [r["key"] for r in client.get("/reports").json()]
    assert keys
    for key in keys:
        r = client.get(
            f"/reports/{key}", params={"date_from": "2027-02-01", "date_to": "2027-01-01"}
        )
        assert r.status_code in (200, 422), (key, r.status_code, r.text)
        r = client.get(f"/reports/{key}", params={"date_from": "nonsense"})
        assert r.status_code == 422, (key, r.status_code)
    assert client.get("/reports/no-such-report").status_code in (404, 422)
