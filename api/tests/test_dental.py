import pytest
from sqlalchemy import select, text

from app.models import AuditLog, DentalVisit, Doctor, Patient
from tests.conftest import login


@pytest.fixture
def setup(db, make_user, client):
    reem_user = make_user("reem", ["doctor"])
    omar_user = make_user("omar", ["doctor"])
    reem = Doctor(name_ar="د. ريم", user_id=reem_user.id)
    omar = Doctor(name_ar="د. عمر", user_id=omar_user.id)
    pt = Patient(name_ar="سارة")
    db.add_all([reem, omar, pt])
    db.commit()
    login(client, "reem")
    return {"reem": reem, "omar": omar, "pt": pt}


def visit(client, s, **kw):
    body = {"doctor_id": s["reem"].id, "teeth": [36, 11, 36], "chief_complaint": " ألم عند المضغ ", "diagnosis": "تسوس عميق", "icd10": "K02.1", **kw}
    return client.post(f"/patients/{s['pt'].id}/dental/visits", json=body)


def test_create_visit_and_record_logs_read(client, setup, db):
    v = visit(client, setup).json()
    assert v["teeth"] == [11, 36] and v["chief_complaint"] == "ألم عند المضغ" and v["can_edit"] is True
    rec = client.get(f"/patients/{setup['pt'].id}/dental").json()
    assert [x["id"] for x in rec["visits"]] == [v["id"]] and rec["edit_hours"] == 24
    reads = db.scalars(select(AuditLog).where(AuditLog.action == "read", AuditLog.record_id == str(setup["pt"].id))).all()
    assert [r.new_json for r in reads] == [{"section": "dental"}]


def test_validation(client, setup):
    assert visit(client, setup, teeth=[19]).status_code == 422
    assert visit(client, setup, teeth=[56]).status_code == 422
    assert visit(client, setup, teeth=[55, 85, 48]).status_code == 201
    assert visit(client, setup, icd10="bad").status_code == 422
    assert visit(client, setup, visit_at="2099-01-01T10:00:00+03:00").json()["detail"]["code"] == "visit_in_future"
    assert visit(client, setup, doctor_id=999999).json()["detail"]["code"] == "unknown_doctor"


def test_filters_by_tooth_department_and_text(client, setup):
    visit(client, setup, teeth=[36])
    visit(client, setup, teeth=[11], diagnosis="التهاب لثة")
    pid = setup["pt"].id
    assert len(client.get(f"/patients/{pid}/dental", params={"tooth": 36}).json()["visits"]) == 1
    assert len(client.get(f"/patients/{pid}/dental", params={"q": "لثة"}).json()["visits"]) == 1
    assert len(client.get(f"/patients/{pid}/dental").json()["visits"]) == 2


def test_only_its_doctor_edits_within_window_then_addenda(client, setup, db):
    v = visit(client, setup).json()
    ok = client.patch(f"/dental-visits/{v['id']}", json={"version": v["version"], "procedure": "حشوة"})
    assert ok.status_code == 200 and ok.json()["procedure"] == "حشوة"
    login(client, "omar")
    other = client.patch(f"/dental-visits/{v['id']}", json={"version": ok.json()["version"], "procedure": "x"})
    assert other.status_code == 403 and other.json()["detail"]["code"] == "not_visit_doctor"
    login(client, "reem")
    # 25 hours later the visit is locked; changes become addenda.
    db.execute(text("UPDATE dental_visits SET created_at = created_at - interval '25 hours' WHERE id = :i"), {"i": v["id"]})
    db.commit()
    locked = client.patch(f"/dental-visits/{v['id']}", json={"version": ok.json()["version"], "procedure": "x"})
    assert locked.status_code == 409 and locked.json()["detail"] == {"code": "visit_locked", "hours": 24}
    rec = client.get(f"/patients/{setup['pt'].id}/dental").json()["visits"][0]
    assert rec["can_edit"] is False
    added = client.post(f"/dental-visits/{v['id']}/addenda", json={"text": "تمت المراجعة، لا ألم"}).json()
    assert [a["text"] for a in added["addenda"]] == ["تمت المراجعة، لا ألم"] and added["procedure"] == "حشوة"


def test_edit_window_setting(client, setup, make_user, db):
    make_user("boss", ["admin"])
    login(client, "boss")
    assert client.put("/settings/dental", json={"edit_hours": 0}).json()["edit_hours"] == 0
    login(client, "reem")
    v = visit(client, setup).json()
    assert v["can_edit"] is False
    assert client.patch(f"/dental-visits/{v['id']}", json={"version": v["version"], "note": "x"}).status_code == 409


def test_findings(client, setup):
    v = visit(client, setup).json()
    pid = setup["pt"].id
    f = client.post(f"/patients/{pid}/dental/findings", json={"tooth_fdi": 36, "category": "endodontic", "description": "علاج عصب", "visit_id": v["id"]})
    assert f.status_code == 201
    assert client.post(f"/patients/{pid}/dental/findings", json={"tooth_fdi": 36, "category": "magic"}).status_code == 422
    assert client.post(f"/patients/{pid}/dental/findings", json={"tooth_fdi": 9, "category": "other"}).status_code == 422
    rec = client.get(f"/patients/{pid}/dental").json()
    assert [(x["tooth_fdi"], x["category"]) for x in rec["findings"]] == [(36, "endodontic")]
    assert client.delete(f"/dental-findings/{f.json()['id']}").status_code == 204
    assert client.get(f"/patients/{pid}/dental").json()["findings"] == []


def test_permissions(client, setup, make_user):
    make_user("amal", ["reception"])
    login(client, "amal")
    assert client.get(f"/patients/{setup['pt'].id}/dental").status_code == 403
    assert visit(client, setup).status_code == 403


def test_database_rejects_impossible_teeth(db, setup):
    with pytest.raises(Exception, match="ck_finding_tooth"), db.begin_nested():
        db.execute(text("INSERT INTO tooth_findings (patient_id, tooth_fdi, category) VALUES (:p, 19, 'other')"), {"p": setup["pt"].id})
    assert db.scalar(select(DentalVisit.id)) is None
