"""Edge cases for prescriptions, lab requests, reports, files and dental records."""

from io import BytesIO

from sqlalchemy import func, select

from app.models import DentalVisit, Doctor, Patient
from tests.conftest import login
from tests.test_clinical import RX, setup
from tests.test_files import png


def test_prescription_bad_input(client, db, make_user):
    pt, d1, _ = setup(db, make_user)
    login(client, "reem")
    url = f"/patients/{pt.id}/prescriptions"
    assert client.post(url, json={"doctor_id": d1.id, "items": []}).status_code == 422
    assert client.post(url, json={"doctor_id": d1.id, "items": [{"drug": ""}]}).status_code == 422
    assert client.post(url, json={"doctor_id": 999999, "items": [RX]}).status_code in (404, 422)
    assert (
        client.post(
            "/patients/999999/prescriptions", json={"doctor_id": d1.id, "items": [RX]}
        ).status_code
        == 404
    )
    # A visit of another patient cannot be linked.
    other = Patient(name_ar="أخرى")
    db.add(other)
    db.flush()
    v = DentalVisit(patient_id=other.id, doctor_id=d1.id, visit_at=db.scalar(select(func.now())))
    db.add(v)
    db.commit()
    r = client.post(url, json={"doctor_id": d1.id, "visit_id": v.id, "items": [RX]})
    assert r.status_code == 422, ("visit of another patient", r.text)
    # Cancelled: no edit, no second cancel.
    rx = client.post(url, json={"doctor_id": d1.id, "items": [RX]}).json()
    c = client.post(
        f"/prescriptions/{rx['id']}/cancel", json={"version": rx["version"], "reason": "خطأ"}
    ).json()
    assert c["status"] == "cancelled"
    assert client.patch(
        f"/prescriptions/{rx['id']}", json={"version": c["version"], "notes": "x"}
    ).status_code in (409, 422)
    assert client.post(
        f"/prescriptions/{rx['id']}/cancel", json={"version": c["version"], "reason": "مرة أخرى"}
    ).status_code in (409, 422)


def test_writing_for_another_doctor(client, db, make_user):
    pt, _, d2 = setup(db, make_user)
    login(client, "reem")  # reem writes in omar's name
    r = client.post(f"/patients/{pt.id}/prescriptions", json={"doctor_id": d2.id, "items": [RX]})
    assert r.status_code in (403, 422), (
        "prescription in another doctor's name",
        r.status_code,
        r.text,
    )


def test_lab_results_edge_cases(client, db, make_user):
    pt, d1, _ = setup(db, make_user)
    login(client, "reem")
    lab = client.post(
        f"/patients/{pt.id}/lab-requests",
        json={"doctor_id": d1.id, "items": [{"name": "CBC"}, {"name": "HbA1c"}]},
    ).json()
    bad_seq = client.post(
        f"/lab-requests/{lab['id']}/results",
        json={"version": lab["version"], "results": [{"seq": 9, "result": "5"}]},
    )
    assert bad_seq.status_code == 422, bad_seq.text
    dup = client.post(
        f"/lab-requests/{lab['id']}/results",
        json={
            "version": lab["version"],
            "results": [{"seq": 1, "result": "5"}, {"seq": 1, "result": "6"}],
        },
    )
    assert dup.status_code == 422, ("same test twice", dup.text)
    c = client.post(
        f"/lab-requests/{lab['id']}/cancel", json={"version": lab["version"], "reason": "لم يذهب"}
    ).json()
    late = client.post(
        f"/lab-requests/{lab['id']}/results",
        json={"version": c["version"], "results": [{"seq": 1, "result": "5"}]},
    )
    assert late.status_code in (409, 422), late.text


def test_report_cancelled_and_empty(client, db, make_user):
    pt, d1, _ = setup(db, make_user)
    login(client, "reem")
    url = f"/patients/{pt.id}/medical-reports"
    assert client.post(url, json={"doctor_id": d1.id, "body": ""}).status_code == 422
    assert client.post(url, json={"doctor_id": d1.id, "body": "   "}).status_code == 422, (
        "blank body"
    )
    rep = client.post(url, json={"doctor_id": d1.id, "body": "نص"}).json()
    c = client.post(
        f"/medical-reports/{rep['id']}/cancel", json={"version": rep["version"], "reason": "خطأ"}
    ).json()
    assert client.patch(
        f"/medical-reports/{rep['id']}", json={"version": c["version"], "body": "x"}
    ).status_code in (409, 422)


def test_file_edge_cases(client, db, make_user):
    pt, d1, _ = setup(db, make_user)
    login(client, "reem")
    url = f"/patients/{pt.id}/files"

    def up(data, name="a.png", **form):
        return client.post(url, files={"file": (name, BytesIO(data), "image/png")}, data=form)

    assert up(b"").status_code == 422
    assert up(b"MZ\x90\x00 not an image", "x.png").status_code == 422  # an .exe named .png
    assert up(png(), tooth_fdi="99").status_code == 422
    assert up(png(), kind="nonsense").status_code == 422
    assert up(png(), taken_on="2999-01-01").status_code == 422, "taken in the future"
    other = Patient(name_ar="أخرى")
    db.add(other)
    db.flush()
    v = DentalVisit(patient_id=other.id, doctor_id=d1.id, visit_at=db.scalar(select(func.now())))
    db.add(v)
    db.commit()
    assert up(png(), visit_id=str(v.id)).status_code == 422, "visit of another patient"
    f = up(png()).json()
    assert client.get(f"/files/{f['id']}/content").status_code == 200
    # Deleted files are gone from the list and their content, but only managers delete.
    assert client.delete(f"/files/{f['id']}").status_code == 403
    assert client.get("/files/999999/content").status_code == 404


def test_dental_edge_cases(client, db, make_user):
    pt, d1, _ = setup(db, make_user)
    login(client, "reem")
    url = f"/patients/{pt.id}/dental"
    assert client.post(f"{url}/visits", json={"doctor_id": d1.id, "teeth": [10]}).status_code == 422
    assert (
        client.post(
            f"{url}/visits", json={"doctor_id": d1.id, "visit_at": "2999-01-01T10:00:00+03:00"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{url}/findings", json={"tooth_fdi": 49, "category": "restoration"}
        ).status_code
        == 422
    )
    assert (
        client.post(f"{url}/findings", json={"tooth_fdi": 11, "category": "magic"}).status_code
        == 422
    )
    v = client.post(f"{url}/visits", json={"doctor_id": d1.id, "teeth": [11]}).json()
    assert client.post(f"/dental-visits/{v['id']}/addenda", json={"text": ""}).status_code == 422
    assert (
        client.post(f"/dental-visits/{v['id']}/addenda", json={"text": "   "}).status_code == 422
    ), "blank addendum"
    assert client.get("/patients/999999/dental").status_code == 404
    _ = Doctor
