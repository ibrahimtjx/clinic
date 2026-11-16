from datetime import timedelta

from sqlalchemy import func, select

from app.models import Appointment, AppointmentStatus, Department, Doctor, Patient
from tests.conftest import login


def test_department_overview_rooms_and_staff(client, admin, make_user, db):
    dep = Department(name_ar="العلاج العام", name_en="General")
    db.add(dep)
    db.flush()
    nurse = make_user("nurse", ["reception"])
    drs = make_user("drs", ["doctor"])
    doc = client.post(
        "/doctors",
        json={"name_ar": "د. سارة", "department_id": dep.id, "room": "غرفة 3", "user_id": drs.id},
    ).json()
    assert doc["room"] == "غرفة 3"
    other = Doctor(name_ar="د. آخر")
    p1, p2, p3 = Patient(name_ar="أ"), Patient(name_ar="ب"), Patient(name_ar="ج")
    db.add_all([other, p1, p2, p3])
    db.commit()
    # A staff member is put in the department from Users.
    u = client.get(f"/users/{nurse.id}").json()
    assert u["department_id"] is None
    u = client.patch(
        f"/users/{nurse.id}", json={"version": u["version"], "department_id": dep.id}
    ).json()
    assert u["department_id"] == dep.id
    bad = client.patch(
        f"/users/{nurse.id}", json={"version": u["version"], "department_id": 999999}
    )
    assert bad.json()["detail"]["code"] == "unknown_department"

    now = db.scalar(select(func.now()))
    st = {s.key: s.id for s in db.scalars(select(AppointmentStatus))}
    for pt, docid, key, days in [
        (p1, doc["id"], "completed", 3),
        (p1, doc["id"], "completed", 10),
        (p2, doc["id"], "cancelled", 2),  # cancelled: not counted
        (p3, other.id, "completed", 1),  # another department
        (p2, doc["id"], "completed", 400),  # too long ago
    ]:
        t = now - timedelta(days=days)
        db.add(
            Appointment(
                patient_id=pt.id,
                doctor_id=docid,
                starts_at=t,
                ends_at=t + timedelta(minutes=15),
                status_id=st[key],
                blocks_slot=True,
            )
        )
    db.commit()

    ov = client.get(f"/departments/{dep.id}/overview").json()
    assert [d["room"] for d in ov["doctors"]] == ["غرفة 3"]
    staff = {s["full_name_ar"]: s for s in ov["staff"]}
    assert set(staff) == {nurse.full_name_ar, drs.full_name_ar}
    assert staff[drs.full_name_ar]["is_doctor"] and not staff[nurse.full_name_ar]["is_doctor"]
    assert ov["patient_count"] == 1
    assert [(x["id"], x["visits"]) for x in ov["patients"]] == [(p1.id, 2)]

    # Settings screen: staff without settings.manage cannot open it.
    login(client, "nurse")
    assert client.get(f"/departments/{dep.id}/overview").status_code == 403
