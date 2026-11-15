from sqlalchemy import select

from app.models import Department, Service
from tests.conftest import login

WEEK = [
    {"weekday": d, "start_time": "09:00", "end_time": "13:00"} for d in range(5)
] + [
    {"weekday": d, "start_time": "16:00", "end_time": "21:00"} for d in range(5)
] + [{"weekday": 0, "start_time": "11:00", "end_time": "11:30", "kind": "break"}]


def new_doctor(client, **kw):
    body = {"name_ar": "د. ريم الحربي", "name_en": "Dr. Reem Alharbi", "slot_minutes": 20, "schedules": WEEK, **kw}
    return client.post("/doctors", json=body)


def test_create_doctor_with_schedule_and_commission(client, admin, db):
    dep = db.scalar(select(Department.id).limit(1))
    res = new_doctor(
        client,
        user_id=admin.id,
        department_id=dep,
        color="grape",
        commission_rules=[{"percent": "30"}, {"department_id": dep, "percent": "35.5"}],
    )
    assert res.status_code == 201, res.text
    d = res.json()
    assert d["slot_minutes"] == 20 and len(d["schedules"]) == 11
    assert d["schedules"][0] == {"id": d["schedules"][0]["id"], "weekday": 0, "start_time": "09:00:00", "end_time": "13:00:00", "kind": "work"}
    assert [r["percent"] for r in d["commission_rules"]] == ["30.00", "35.50"]
    assert new_doctor(client, user_id=admin.id).json()["detail"]["code"] == "user_already_doctor"


def test_schedule_validation(client, admin):
    bad = {
        "schedule_overlap": [
            {"weekday": 1, "start_time": "09:00", "end_time": "13:00"},
            {"weekday": 1, "start_time": "12:00", "end_time": "15:00"},
        ],
        "break_outside_work": [
            {"weekday": 1, "start_time": "09:00", "end_time": "13:00"},
            {"weekday": 1, "start_time": "12:30", "end_time": "13:30", "kind": "break"},
        ],
        "schedule_times": [{"weekday": 1, "start_time": "13:00", "end_time": "09:00"}],
    }
    for code, sched in bad.items():
        assert new_doctor(client, schedules=sched).json()["detail"]["code"] == code
    assert new_doctor(client, schedules=[{"weekday": 7, "start_time": "09:00", "end_time": "10:00"}]).status_code == 422


def test_commission_rule_validation(client, admin, db):
    dep = db.scalar(select(Department.id).limit(1))
    svc = db.scalar(select(Service.id).limit(1))
    cases = {
        "commission_scope": [{"department_id": dep, "service_id": svc, "percent": "10"}],
        "commission_duplicate": [{"percent": "10"}, {"percent": "20"}],
        "unknown_service": [{"service_id": 999999, "percent": "10"}],
    }
    for code, rules in cases.items():
        assert new_doctor(client, commission_rules=rules).json()["detail"]["code"] == code
    assert new_doctor(client, commission_rules=[{"percent": "101"}]).status_code == 422


def test_update_replaces_schedule_and_bumps_version(client, admin):
    d = new_doctor(client).json()
    res = client.patch(
        f"/doctors/{d['id']}",
        json={"version": d["version"], "schedules": [{"weekday": 6, "start_time": "10:00", "end_time": "14:00"}]},
    )
    assert res.status_code == 200
    assert [s["weekday"] for s in res.json()["schedules"]] == [6]
    assert res.json()["version"] == d["version"] + 1
    assert client.patch(f"/doctors/{d['id']}", json={"version": d["version"], "slot_minutes": 30}).status_code == 409
    assert client.patch(f"/doctors/{d['id']}", json={"version": res.json()["version"], "slot_minutes": 3}).status_code == 422


def test_commission_hidden_from_other_roles(client, admin, make_user):
    d = new_doctor(client, commission_rules=[{"percent": "30"}]).json()
    make_user("amal", ["reception"])
    login(client, "amal")
    seen = client.get(f"/doctors/{d['id']}").json()
    assert seen["commission_rules"] is None and seen["name_ar"] == "د. ريم الحربي"
    assert client.patch(f"/doctors/{d['id']}", json={"version": d["version"], "color": "red"}).status_code == 403
    make_user("faisal", ["cashier"])  # report.financial
    login(client, "faisal")
    assert client.get(f"/doctors/{d['id']}").json()["commission_rules"][0]["percent"] == "30.00"


def test_list_delete_reorder_doctors(client, admin):
    a = new_doctor(client).json()
    b = new_doctor(client, name_ar="د. عمر", is_active=False).json()
    assert [x["id"] for x in client.get("/doctors").json()] == [a["id"]]
    assert len(client.get("/doctors", params={"include_inactive": True}).json()) == 2
    assert [x["id"] for x in client.put("/doctors/order", json={"ids": [b["id"], a["id"]]}).json()] == [b["id"], a["id"]]
    assert client.delete(f"/doctors/{a['id']}").status_code == 204
    assert client.get(f"/doctors/{a['id']}").status_code == 404
    assert client.get("/doctors").json() == []
