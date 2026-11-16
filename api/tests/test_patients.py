import io

import pytest
from openpyxl import load_workbook
from sqlalchemy import select

from app.models import AuditLog, InsuranceCompany, Patient
from tests.conftest import login


@pytest.fixture
def reception(client, make_user):
    make_user("amal", ["reception"])
    login(client, "amal")


@pytest.fixture
def company(db):
    c = InsuranceCompany(code="TAW", name_ar="التعاونية", name_en="Tawuniya", sort_order=10)
    db.add(c)
    db.commit()
    return c


def new(client, **kw):
    body = {
        "name_ar": "سارة أحمد العتيبي",
        "name_en": "Sara Ahmed Alotaibi",
        "mobile": "0551234567",
        "national_id": "1012345678",
        **kw,
    }
    return client.post("/patients", json=body)


def test_create_assigns_sequential_file_numbers(client, reception):
    a = new(client).json()
    b = new(client, mobile="0559999999", national_id="1099999999", name_ar="نورة").json()
    assert b["file_no"] == a["file_no"] + 1
    assert a["balance"] == "0.00" and a["is_active"] and a["insurance"] is None


def test_validation(client, reception):
    cases = [
        {"mobile": "551234567"},
        {"mobile": "0451234567"},
        {"national_id": "12345"},
        {"name_ar": "س"},
        {"gender": "x"},
        {"nationality": "sa"},
        {"dob": "2999-01-01"},
    ]
    for c in cases:
        assert new(client, **c).status_code == 422, c


def test_arabic_digits_and_spaces_are_normalized(client, reception):
    p = new(client, mobile="٠٥٥ ١٢٣ ٤٥٦٧", national_id="١٠١٢٣٤٥٦٧٨").json()
    assert p["mobile"] == "0551234567" and p["national_id"] == "1012345678"


def test_duplicate_warning_and_override(client, reception):
    first = new(client).json()
    res = new(client, name_ar="شخص آخر", national_id="1099999999")
    assert res.status_code == 409
    d = res.json()["detail"]
    assert d["code"] == "possible_duplicate"
    assert d["matches"] == [
        {
            "id": first["id"],
            "file_no": first["file_no"],
            "name_ar": first["name_ar"],
            "name_en": first["name_en"],
            "matched_on": ["mobile"],
        }
    ]
    assert (
        new(client, name_ar="شخص آخر", national_id="1099999999", allow_duplicate=True).status_code
        == 201
    )
    dups = client.get(
        "/patients/duplicates", params={"national_id": "1012345678", "mobile": "0551234567"}
    ).json()
    assert dups[0]["matched_on"] == ["national_id", "mobile"] and len(dups) == 2
    assert (
        client.get(
            "/patients/duplicates", params={"mobile": "0551234567", "exclude_id": first["id"]}
        ).json()[0]["id"]
        != first["id"]
    )


def _seed(client):
    rows = [
        ("أحمد محمد العتيبي", "Ahmed Mohammed Alotaibi", "0551000001", "1000000001"),
        ("فاطمة علي الشمري", "Fatimah Ali Alshammari", "0551000002", "1000000002"),
        ("آمنة سعد الدوسري", "Aminah Saad Aldosari", "0551000003", "2000000003"),
        ("مصطفى إبراهيم", "Mustafa Ibrahim", "0559876543", "1000000004"),
    ]
    return [
        new(client, name_ar=a, name_en=e, mobile=m, national_id=n).json() for a, e, m, n in rows
    ]


def _names(res):
    return [p["name_en"] for p in res.json()["items"]]


def test_search_arabic_variants_partial_and_english(client, reception):
    _seed(client)
    s = lambda q: _names(client.get("/patients", params={"q": q}))
    assert s("احمد") == ["Ahmed Mohammed Alotaibi"]  # alef with hamza vs plain alef
    assert s("فاطمه") == ["Fatimah Ali Alshammari"]  # ta marbuta
    assert s("امنه") == ["Aminah Saad Aldosari"]  # madda + ta marbuta
    assert s("مصطفي") == ["Mustafa Ibrahim"]  # alef maqsura
    assert s("أَحْمَد") == ["Ahmed Mohammed Alotaibi"]  # diacritics typed
    assert s("محمد عتيبي") == ["Ahmed Mohammed Alotaibi"]  # words in any order, partial
    assert s("SHAMM") == ["Fatimah Ali Alshammari"]
    assert s("50%") == []  # wildcards are literal


def test_search_numbers(client, reception):
    pts = _seed(client)
    s = lambda q: _names(client.get("/patients", params={"q": q}))
    assert s("9876543") == ["Mustafa Ibrahim"]  # part of mobile
    assert s("٩٨٧٦٥٤٣") == ["Mustafa Ibrahim"]  # Arabic-Indic digits
    assert s("2000000003") == ["Aminah Saad Aldosari"]  # national ID
    assert s(str(pts[1]["file_no"]))[0] == "Fatimah Ali Alshammari"  # exact file number ranks first
    quick = client.get("/patients/search", params={"q": "0551000"}).json()
    assert len(quick) == 3 and set(quick[0]) == {
        "id",
        "file_no",
        "name_ar",
        "name_en",
        "mobile",
        "national_id",
        "is_active",
    }


def test_filters_sort_paging(client, reception, company, db):
    pts = _seed(client)
    p = pts[0]
    client.patch(
        f"/patients/{p['id']}",
        json={"version": p["version"], "insurance": {"company_id": company.id, "class_name": "A"}},
    )
    res = client.get("/patients", params={"insurance_company_id": company.id}).json()
    assert res["total"] == 1 and res["items"][0]["insurance_company_id"] == company.id
    page = client.get("/patients", params={"page_size": 2, "page": 2, "sort": "file_no"}).json()
    assert page["total"] == 4 and [x["file_no"] for x in page["items"]] == [
        pts[2]["file_no"],
        pts[3]["file_no"],
    ]
    assert client.get("/patients", params={"has_balance": True}).json()["total"] == 0
    assert (
        client.get(
            "/patients", params={"created_from": "2000-01-01", "created_to": "2000-01-02"}
        ).json()["total"]
        == 0
    )


def test_profile_update_insurance_and_conflict(client, reception, company):
    p = new(client).json()
    res = client.patch(
        f"/patients/{p['id']}",
        json={
            "version": p["version"],
            "gender": "female",
            "dob": "1990-05-04",
            "insurance": {
                "company_id": company.id,
                "policy_no": "P-1",
                "class_name": "VIP",
                "expiry": "2027-01-01",
            },
        },
    )
    assert res.status_code == 200, res.text
    up = res.json()
    assert (
        up["insurance"]["company_name_en"] == "Tawuniya" and up["insurance"]["class_name"] == "VIP"
    )
    assert up["version"] == p["version"] + 1
    assert (
        client.patch(f"/patients/{p['id']}", json={"version": p["version"], "notes": "x"}).json()[
            "detail"
        ]["code"]
        == "stale_record"
    )
    cleared = client.patch(
        f"/patients/{p['id']}", json={"version": up["version"], "clear_insurance": True}
    ).json()
    assert cleared["insurance"] is None
    bad = client.patch(
        f"/patients/{p['id']}", json={"version": cleared["version"], "default_doctor_id": 999999}
    )
    assert bad.json()["detail"]["code"] == "unknown_doctor"


def test_health_needs_medical_permission_and_reads_are_logged(client, make_user, db):
    make_user("amal", ["reception"])
    make_user("reem", ["doctor"])
    login(client, "amal")
    p = new(client, chronic_diseases="سكري").json()
    assert p["chronic_diseases"] == "سكري"  # header warning badge data
    assert "medications" not in p
    assert client.get(f"/patients/{p['id']}/health").status_code == 403
    doctor = login(client, "reem")["user"]["id"]
    h = client.get(f"/patients/{p['id']}/health").json()
    assert h["chronic_diseases"] == "سكري" and h["medications"] == ""
    res = client.put(
        f"/patients/{p['id']}/health",
        json={
            "version": h["version"],
            "chronic_diseases": "سكري",
            "allergies": "بنسلين",
            "medications": "ميتفورمين",
            "medical_history": "",
        },
    )
    assert res.status_code == 200 and res.json()["allergies"] == "بنسلين"
    reads = db.scalars(
        select(AuditLog).where(AuditLog.action == "read", AuditLog.record_id == str(p["id"]))
    ).all()
    assert (
        len(reads) == 1
        and reads[0].user_id == doctor
        and reads[0].new_json == {"section": "health"}
    )


def test_activate_delete_restore_and_permissions(client, reception, make_user):
    p = new(client).json()
    assert client.post(f"/patients/{p['id']}/deactivate").json()["is_active"] is False
    assert client.get("/patients").json()["total"] == 0
    assert client.get("/patients", params={"include_inactive": True}).json()["total"] == 1
    assert client.post(f"/patients/{p['id']}/activate").json()["is_active"] is True
    assert (
        client.delete(f"/patients/{p['id']}").status_code == 403
    )  # reception lacks patient.delete
    make_user("boss", ["admin"])
    login(client, "boss")
    assert client.delete(f"/patients/{p['id']}").status_code == 204
    assert client.get("/patients").json()["total"] == 0
    assert client.get(f"/patients/{p['id']}").status_code == 200  # admin sees deleted
    assert client.post(f"/patients/{p['id']}/restore").json()["deleted_at"] is None


def test_patient_permissions(client, make_user):
    make_user("faisal", ["cashier"])  # patient.view only
    login(client, "faisal")
    assert client.get("/patients").status_code == 200
    assert new(client).status_code == 403
    assert client.get("/patients/export/xlsx").status_code == 403


def test_activity_shows_patient_changes(client, admin, company):
    p = new(client).json()
    client.patch(
        f"/patients/{p['id']}",
        json={"version": p["version"], "insurance": {"company_id": company.id}},
    )
    client.get(f"/patients/{p['id']}/health")
    actions = [
        (a["table_name"], a["action"]) for a in client.get(f"/patients/{p['id']}/activity").json()
    ]
    assert (
        ("patients", "create") in actions
        and ("patient_insurance", "create") in actions
        and ("patients", "read") in actions
    )


def test_export_xlsx(client, admin, db):
    _seed(client)
    res = client.get("/patients/export/xlsx", params={"q": "احمد"})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/vnd.openxmlformats")
    ws = load_workbook(io.BytesIO(res.content)).active
    assert ws["A1"].value == "رقم الملف / File no." and ws.sheet_view.rightToLeft
    assert ws.max_row == 2 and ws["C2"].value == "Ahmed Mohammed Alotaibi"
    assert db.scalars(select(AuditLog).where(AuditLog.action == "export")).one().new_json == {
        "rows": 1,
        "q": "احمد",
    }


def test_assignments(client, make_user):
    make_user("amal", ["reception"])
    omar = make_user("omar", ["doctor"])
    login(client, "amal")
    p = new(client).json()
    assert (
        client.post(
            f"/patients/{p['id']}/assignments", json={"assigned_to": 999999, "note": "x"}
        ).json()["detail"]["code"]
        == "unknown_user"
    )
    a = client.post(
        f"/patients/{p['id']}/assignments",
        json={"assigned_to": omar.id, "note": "اتصل لإعادة الجدولة"},
    ).json()
    assert a["assigned_to_name"] == omar.full_name_ar and a["patient_file_no"] == p["file_no"]
    assert len(client.get(f"/patients/{p['id']}/assignments").json()) == 1
    login(client, "omar")
    mine = client.get("/assignments/mine").json()
    assert [x["id"] for x in mine] == [a["id"]]
    assert client.post(f"/assignments/{a['id']}/done").json()["done_at"] is not None
    assert client.get("/assignments/mine").json() == []


def test_staff_directory(client, reception):
    rows = client.get("/users/directory").json()
    assert rows and set(rows[0]) == {"id", "full_name_ar", "full_name_en", "roles"}


def test_insurance_companies_list(client, admin):
    res = client.post(
        "/insurance-companies", json={"code": "BUPA", "name_ar": "بوبا", "name_en": "Bupa"}
    )
    assert res.status_code == 201
    assert [c["code"] for c in client.get("/insurance-companies").json()] == ["BUPA"]


def test_file_number_never_reused(client, admin, db):
    a = new(client).json()
    client.delete(f"/patients/{a['id']}")
    b = new(client, mobile="0550000009", national_id="1000000009").json()
    assert b["file_no"] > a["file_no"]
    assert db.scalar(select(Patient.file_no).where(Patient.id == a["id"])) == a["file_no"]
