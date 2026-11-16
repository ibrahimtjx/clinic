"""M12: prescriptions, lab requests and results, medical reports (SPEC 8.6)."""

from sqlalchemy import select, text

from app.models import Doctor, Patient, User
from tests.conftest import login


def setup(db, make_user):
    reem = make_user("reem", ["doctor"])
    omar = make_user("omar", ["doctor"])
    make_user("amal", ["reception"])
    d1 = Doctor(name_ar="د. ريم", user_id=reem.id)
    d2 = Doctor(name_ar="د. عمر", user_id=omar.id)
    pt = Patient(name_ar="سارة", allergies="بنسلين")
    db.add_all([d1, d2, pt])
    db.commit()
    return pt, d1, d2


RX = {
    "drug": "Ibuprofen 400 mg",
    "dose": "1 tablet",
    "frequency": "Every 8 hours",
    "duration": "3 days",
}


def test_prescription_lifecycle_and_edit_window(client, db, make_user):
    pt, d1, _ = setup(db, make_user)
    login(client, "reem")
    meds = client.get("/medications").json()
    assert len(meds) == 10 and meds[0]["name"].startswith("Amoxicillin")
    rx = client.post(
        f"/patients/{pt.id}/prescriptions",
        json={
            "doctor_id": d1.id,
            "diagnosis": "التهاب لب السن",
            "items": [RX, {**RX, "drug": "Chlorhexidine 0.12% mouthwash"}],
        },
    ).json()
    assert (
        [i["seq"] for i in rx["items"]] == [1, 2]
        and rx["editable"] is True
        and rx["doctor_name_ar"] == "د. ريم"
    )
    upd = client.patch(
        f"/prescriptions/{rx['id']}", json={"version": rx["version"], "items": [RX]}
    ).json()
    assert len(upd["items"]) == 1
    # Another doctor cannot change it.
    login(client, "omar")
    other = client.patch(
        f"/prescriptions/{rx['id']}", json={"version": upd["version"], "notes": "x"}
    )
    assert other.json()["detail"]["code"] == "not_own_document"
    # After the edit window only cancelling is possible.
    login(client, "reem")
    db.execute(
        text("update prescriptions set issued_at = issued_at - interval '25 hours' where id = :i"),
        {"i": rx["id"]},
    )
    db.commit()
    late = client.patch(
        f"/prescriptions/{rx['id']}", json={"version": upd["version"], "notes": "x"}
    )
    assert late.json()["detail"]["code"] == "edit_window_closed"
    got = client.get(f"/prescriptions/{rx['id']}").json()
    assert got["editable"] is False
    cancelled = client.post(
        f"/prescriptions/{rx['id']}/cancel",
        json={"version": got["version"], "reason": "خطأ في الجرعة"},
    ).json()
    assert cancelled["status"] == "cancelled" and cancelled["cancel_reason"] == "خطأ في الجرعة"
    assert [r["id"] for r in client.get(f"/patients/{pt.id}/prescriptions").json()] == [rx["id"]]


def test_lab_request_and_results(client, db, make_user):
    pt, d1, _ = setup(db, make_user)
    login(client, "reem")
    tests = client.get("/lab-tests").json()
    hba1c = next(t for t in tests if t["code"] == "HBA1C")
    req = client.post(
        f"/patients/{pt.id}/lab-requests",
        json={
            "doctor_id": d1.id,
            "lab_name": "مختبر البرج",
            "clinical_info": "قبل خلع ضرس العقل",
            "items": [
                {
                    "test_id": hba1c["id"],
                    "name": hba1c["name_en"],
                    "unit": hba1c["unit"],
                    "reference_range": hba1c["reference_range"],
                },
                {"name": "PT / INR", "unit": "INR"},
            ],
        },
    ).json()
    assert req["status"] == "active" and req["items"][0]["reference_range"] == "4.0-5.6"
    login(client, "omar")  # any doctor may enter results
    res = client.post(
        f"/lab-requests/{req['id']}/results",
        json={
            "version": req["version"],
            "results": [
                {"seq": 1, "result": "7.2", "flag": "high"},
                {"seq": 2, "result": "1.0", "flag": "normal"},
            ],
            "result_note": "مراجعة الطبيب المعالج",
        },
    ).json()
    assert (
        res["status"] == "resulted"
        and res["items"][0]["flag"] == "high"
        and res["resulted_by_name"]
    )
    bad = client.post(
        f"/lab-requests/{req['id']}/results",
        json={"version": res["version"], "results": [{"seq": 9, "result": "1"}]},
    )
    assert bad.json()["detail"]["code"] == "unknown_lab_item"


def test_medical_report_and_access(client, db, make_user):
    pt, d1, _ = setup(db, make_user)
    login(client, "reem")
    rep = client.post(
        f"/patients/{pt.id}/medical-reports",
        json={
            "doctor_id": d1.id,
            "kind": "referral",
            "recipient": "استشاري جراحة الوجه والفكين",
            "title": "تحويل",
            "body": "نأمل التكرم بفحص المريضة.",
        },
    ).json()
    assert (rep["kind"], rep["language"], rep["editable"]) == ("referral", "ar", True)
    upd = client.patch(
        f"/medical-reports/{rep['id']}", json={"version": rep["version"], "body": "نص معدل"}
    ).json()
    assert upd["body"] == "نص معدل"
    assert [
        r["id"]
        for r in client.get(
            f"/patients/{pt.id}/medical-reports", params={"kind": "referral"}
        ).json()
    ] == [rep["id"]]
    login(client, "amal")  # reception has no dental.view
    assert client.get(f"/patients/{pt.id}/prescriptions").status_code == 403
    assert (
        client.post(
            f"/patients/{pt.id}/medical-reports", json={"doctor_id": d1.id, "body": "x"}
        ).status_code
        == 403
    )
    assert db.scalar(select(User.id).where(User.username == "amal"))
