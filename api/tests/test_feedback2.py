# ruff: noqa: F811
"""Owner feedback 2026-11-17: doctors see their own appointments and statement; referral sources."""

from datetime import time

from sqlalchemy import select

from app.models import Doctor, DoctorCommissionRule, DoctorSchedule, Patient, User
from tests.conftest import login
from tests.test_appointments import SUN, at, status_id
from tests.test_billing_docs import line, setup  # noqa: F401
from tests.test_ledger import cash, collect, send_po


def test_doctor_sees_only_own_appointments_and_queue(client, db, make_user):
    reem = make_user("dreem", ["doctor"])
    make_user("desk", ["reception"])
    d1 = Doctor(name_ar="د. ريم", user_id=reem.id)
    d2 = Doctor(name_ar="د. عمر")
    for d in (d1, d2):
        d.schedules = [
            DoctorSchedule(weekday=w, start_time=time(0), end_time=time(23, 59)) for w in range(7)
        ]
    pt = Patient(name_ar="سارة")
    db.add_all([d1, d2, pt])
    db.commit()
    login(client, "desk")
    ids = []
    for doc, hm in ((d1, "09:00"), (d2, "10:00")):
        r = client.post(
            "/appointments",
            json={
                "patient_id": pt.id,
                "doctor_id": doc.id,
                "starts_at": at(SUN, hm),
                "ends_at": at(SUN, hm[:2] + ":15"),
                "acknowledge": ["same_day"],
            },
        )
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    for doc in (d1, d2):
        client.post(
            "/queue", json={"patient_id": pt.id, "doctor_id": doc.id}
        ) if doc is d1 else None
    params = {"start": at(SUN, "00:00"), "end": at(SUN, "23:59")}
    assert len(client.get("/appointments", params=params).json()) == 2  # reception: everyone
    login(client, "dreem")
    mine = client.get("/appointments", params=params).json()
    assert [a["id"] for a in mine] == [ids[0]]
    assert [a["id"] for a in client.get("/appointments", params={"patient_id": pt.id}).json()] == [
        ids[0]
    ]
    assert client.get(f"/appointments/{ids[1]}").status_code == 404
    assert client.get(f"/appointments/{ids[0]}").status_code == 200
    assert all(e["doctor_id"] == d1.id for e in client.get("/queue").json())
    _ = status_id


def test_doctor_statement_own_only(client, setup, db, make_user):
    doc = db.scalar(select(Doctor).where(Doctor.name_ar == "د. ريم"))
    reem = db.scalar(select(User).where(User.username == "reem"))
    doc.user_id = reem.id
    doc.commission_rules = [DoctorCommissionRule(percent=30)]
    other = Doctor(name_ar="د. آخر")
    db.add(other)
    db.commit()
    po = send_po(client, setup["resident"], [line(setup["veneer"])], doctor_id=doc.id)
    collect(client, po, [cash("500")])
    login(client, "reem")
    r = client.get(
        "/reports/doctor_statement",
        params={"date_from": "2026-01-01", "date_to": "2027-12-30", "doctor_id": other.id},
    )
    assert r.status_code == 200, r.text
    rep = r.json()
    rows = rep["sections"][0]["rows"]
    assert len(rows) == 1 and rows[0]["outstanding"] == "880.00", rows  # forced to her own doctor
    summary = {s["en"]: s["value"] for s in rep["summary"]}
    assert summary["Invoices"] == 1 and summary["Commission"] != "0.00", summary
    # Other financial reports stay closed to doctors.
    assert client.get("/reports/doctor_production").status_code == 403
    # A cashier without report.own cannot open it; a manager must choose a doctor.
    make_user("boss", ["manager"])
    login(client, "boss")
    assert (
        client.get("/reports/doctor_statement", params={"date_from": "2026-01-01"}).json()[
            "detail"
        ]["code"]
        == "doctor_required"
    )


def test_referral_sources_list_and_patient(client, make_user):
    make_user("boss", ["admin"])
    login(client, "boss")
    sources = client.get("/referral-sources").json()
    names = [s["name_en"] for s in sources]
    assert names[:3] == ["TikTok", "Instagram", "Snapchat"] and "Another doctor" in names
    new = client.post(
        "/referral-sources", json={"name_ar": "لوحة إعلانية", "name_en": "Billboard"}
    ).json()
    p = client.post("/patients", json={"name_ar": "مريض جديد", "referral_source_id": new["id"]})
    assert p.status_code == 201 and p.json()["referral_source_id"] == new["id"]
    bad = client.post("/patients", json={"name_ar": "مريض آخر", "referral_source_id": 999999})
    assert bad.json()["detail"]["code"] == "unknown_referral_source"
    rep = client.get(
        "/reports/new_patients", params={"date_from": "2026-01-01", "date_to": "2027-12-30"}
    ).json()
    by_source = {
        r["source"]: r["count"] for s in rep["sections"] for r in s["rows"] if "source" in r
    }
    assert by_source.get("لوحة إعلانية") == 1, by_source


def test_sick_leave(client, db, make_user):
    from tests.test_clinical import setup as clinical_setup

    pt, d1, _ = clinical_setup(db, make_user)
    login(client, "reem")
    url = f"/patients/{pt.id}/medical-reports"
    base = {"doctor_id": d1.id, "kind": "sick_leave", "body": "يحتاج إلى راحة بعد خلع ضرس العقل."}
    assert client.post(url, json=base).json()["detail"]["code"] == "leave_dates_required"
    bad = client.post(url, json={**base, "leave_from": "2026-11-20", "leave_to": "2026-11-18"})
    assert bad.json()["detail"]["code"] == "leave_dates_order"
    long = client.post(url, json={**base, "leave_from": "2026-11-01", "leave_to": "2027-03-01"})
    assert long.json()["detail"]["code"] == "leave_too_long"
    ok = client.post(url, json={**base, "leave_from": "2026-11-17", "leave_to": "2026-11-19"})
    assert ok.status_code == 201, ok.text
    r = ok.json()
    assert r["kind"] == "sick_leave" and r["leave_days"] == 3
    upd = client.patch(
        f"/medical-reports/{r['id']}", json={"version": r["version"], "leave_to": "2026-11-20"}
    ).json()
    assert upd["leave_days"] == 4
    # Other kinds keep no dates.
    rep = client.post(
        url, json={**base, "kind": "report", "leave_from": "2026-11-17", "leave_to": "2026-11-19"}
    ).json()
    assert rep["leave_from"] is None and rep["leave_days"] is None
    kinds = [x["kind"] for x in client.get(url, params={"kind": "sick_leave"}).json()]
    assert kinds == ["sick_leave"]


def test_whatsapp_template_setting(client, make_user):
    make_user("boss", ["admin"])
    make_user("desk", ["reception"])
    login(client, "desk")
    s = client.get("/settings/whatsapp").json()
    assert "{patient}" in s["template_ar"] and "{time}" in s["template_en"]
    assert client.put("/settings/whatsapp", json=s).status_code == 403
    login(client, "boss")
    s["template_ar"] = "تذكير: {patient} موعدك {date} {time}"
    assert client.put("/settings/whatsapp", json=s).json()["template_ar"].startswith("تذكير")
    assert (
        client.put("/settings/whatsapp", json={**s, "template_ar": "x" * 1001}).status_code == 422
    )
