
import pytest
from sqlalchemy import select

from app.models import AppointmentStatus, AuditLog, Department, Service
from tests.conftest import login


@pytest.fixture
def reception(client, make_user):
    make_user("amal", ["reception"])
    login(client, "amal")


# ---- seeded starting lists ----
def test_seeded_statuses_visit_types_departments(client, admin):
    st = client.get("/appointment-statuses").json()
    assert [s["key"] for s in st] == [
        "unconfirmed", "confirmed", "arrived", "with_doctor", "completed", "no_show", "cancelled", "postponed",
    ]
    assert {s["key"] for s in st if not s["blocks_slot"]} == {"no_show", "cancelled", "postponed"}
    assert all(s["is_system"] for s in st)
    assert [v["name_en"] for v in client.get("/visit-types").json()] == [
        "New", "Follow-up", "Consultation", "Emergency", "Orthodontic follow-up",
    ]
    assert len(client.get("/departments").json()) == 5
    assert client.get("/clinics").json()[0]["name_en"] == "Dental clinic"


def test_seeded_services_start_inactive_with_zero_prices(client, admin):
    assert client.get("/services").json() == []
    allsvc = client.get("/services", params={"include_inactive": True}).json()
    assert [s["code"] for s in allsvc][:3] == ["DN001", "DN002", "DN003"] and len(allsvc) == 20
    assert allsvc[0]["sale_price"] == "0.00" and allsvc[0]["number"] == 1


# ---- generic list behaviour ----
def test_reading_lists_needs_sign_in_only_writing_needs_settings(client, reception):
    assert client.get("/visit-types").status_code == 200
    res = client.post("/visit-types", json={"name_ar": "x", "name_en": "x"})
    assert res.status_code == 403 and res.json()["detail"]["missing"] == ["settings.manage"]
    client.headers.pop("Authorization")
    assert client.get("/visit-types").status_code == 401


def test_visit_type_crud_soft_delete_restore_and_audit(client, admin, db):
    res = client.post("/visit-types", json={"name_ar": " فحص دوري ", "name_en": "Check-up", "color": "lime"})
    assert res.status_code == 201
    vt = res.json()
    assert vt["name_ar"] == "فحص دوري" and vt["sort_order"] == 60
    upd = client.patch(f"/visit-types/{vt['id']}", json={"version": vt["version"], "color": "teal"})
    assert upd.json()["color"] == "teal" and upd.json()["version"] == vt["version"] + 1
    stale = client.patch(f"/visit-types/{vt['id']}", json={"version": vt["version"], "color": "red"})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "stale_record"
    assert client.patch(f"/visit-types/{vt['id']}", json={"version": 99, "color": "pink!"}).status_code == 422

    assert client.delete(f"/visit-types/{vt['id']}").status_code == 204
    assert vt["id"] not in [x["id"] for x in client.get("/visit-types").json()]
    assert client.get(f"/visit-types/{vt['id']}").status_code == 200  # admin can view deleted
    deleted = client.get("/visit-types", params={"include_deleted": True}).json()
    assert any(x["id"] == vt["id"] and x["deleted_at"] for x in deleted)
    assert client.post(f"/visit-types/{vt['id']}/restore").json()["deleted_at"] is None
    actions = db.scalars(
        select(AuditLog.action).where(AuditLog.table_name == "visit_types", AuditLog.record_id == str(vt["id"]))
    ).all()
    assert actions == ["create", "update", "delete", "restore"]


def test_deleted_hidden_without_permission(client, admin, make_user):
    vt = client.post("/visit-types", json={"name_ar": "س", "name_en": "x"}).json()
    client.delete(f"/visit-types/{vt['id']}")
    make_user("amal", ["reception"])
    login(client, "amal")
    assert client.get(f"/visit-types/{vt['id']}").status_code == 404
    assert all(x["id"] != vt["id"] for x in client.get("/visit-types", params={"include_deleted": True}).json())


def test_inactive_hidden_by_default(client, admin):
    vt = client.post("/visit-types", json={"name_ar": "س", "name_en": "x", "is_active": False}).json()
    assert all(x["id"] != vt["id"] for x in client.get("/visit-types").json())
    assert any(x["id"] == vt["id"] for x in client.get("/visit-types", params={"include_inactive": True}).json())


def test_reorder(client, admin):
    ids = [v["id"] for v in client.get("/visit-types").json()]
    res = client.put("/visit-types/order", json={"ids": list(reversed(ids))})
    assert [v["id"] for v in res.json()] == list(reversed(ids))
    assert [v["id"] for v in client.get("/visit-types").json()] == list(reversed(ids))
    assert client.put("/visit-types/order", json={"ids": [999999]}).status_code == 404


# ---- statuses ----
def test_system_statuses_cannot_be_deleted_or_disabled_but_can_be_renamed(client, admin, db):
    arrived = db.scalar(select(AppointmentStatus).where(AppointmentStatus.key == "arrived"))
    assert client.delete(f"/appointment-statuses/{arrived.id}").json()["detail"]["code"] == "system_status"
    res = client.patch(f"/appointment-statuses/{arrived.id}", json={"version": arrived.version, "is_active": False})
    assert res.json()["detail"]["code"] == "system_status"
    res = client.patch(
        f"/appointment-statuses/{arrived.id}", json={"version": arrived.version, "name_ar": "وصل", "color": "teal"}
    )
    assert res.status_code == 200 and res.json()["name_ar"] == "وصل" and res.json()["key"] == "arrived"


def test_custom_status(client, admin):
    res = client.post(
        "/appointment-statuses",
        json={"key": "rescheduled", "name_ar": "معاد جدولته", "name_en": "Rescheduled", "color": "grape", "blocks_slot": False},
    )
    assert res.status_code == 201 and res.json()["is_system"] is False
    dup = client.post(
        "/appointment-statuses",
        json={"key": "rescheduled", "name_ar": "x", "name_en": "x", "color": "grape", "blocks_slot": False},
    )
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "duplicate"
    assert client.delete(f"/appointment-statuses/{res.json()['id']}").status_code == 204


# ---- departments ----
def test_department_needs_existing_clinic(client, admin):
    res = client.post("/departments", json={"name_ar": "جراحة", "name_en": "Oral surgery", "clinic_id": 999999})
    assert res.json()["detail"]["code"] == "unknown_clinic"
    clinic = client.get("/clinics").json()[0]
    res = client.post("/departments", json={"name_ar": "جراحة", "name_en": "Oral surgery", "clinic_id": clinic["id"]})
    assert res.status_code == 201


# ---- services ----
def test_service_prices_and_numbers(client, admin, db):
    dep = db.scalar(select(Department.id).limit(1))
    body = {
        "code": "dn100", "name_ar": "حشوة تجميلية", "name_en": "Composite filling", "department_id": dep,
        "sale_price": "250.5", "min_price": "200", "max_price": "300", "cost_price": "40.25",
    }
    res = client.post("/services", json=body)
    assert res.status_code == 201, res.text
    s = res.json()
    assert s["code"] == "DN100" and s["number"] == 21
    assert (s["sale_price"], s["min_price"], s["max_price"], s["cost_price"]) == ("250.50", "200.00", "300.00", "40.25")
    assert client.post("/services", json={**body, "code": "DN101", "sale_price": "350"}).json()["detail"]["code"] == "price_range"
    assert client.post("/services", json={**body, "code": "DN102", "sale_price": "250.555"}).status_code == 422
    assert client.post("/services", json={**body, "code": "DN103", "cost_price": "-1"}).status_code == 422
    assert client.post("/services", json=body).json()["detail"]["code"] == "duplicate"
    stored = db.get(Service, s["id"])
    assert str(stored.sale_price) == "250.50"  # NUMERIC, not float


def test_activate_seeded_service_after_setting_price(client, admin):
    svc = client.get("/services", params={"include_inactive": True}).json()[0]
    res = client.patch(
        f"/services/{svc['id']}",
        json={"version": svc["version"], "sale_price": "150", "min_price": "120", "max_price": "200", "is_active": True},
    )
    assert res.status_code == 200 and res.json()["is_active"]
    assert [x["code"] for x in client.get("/services").json()] == ["DN001"]


# ---- saved phrases ----
def test_saved_phrases_by_field(client, admin):
    a = client.post("/saved-phrases", json={"field_key": "diagnosis", "text": "تسوس عميق"}).json()
    client.post("/saved-phrases", json={"field_key": "diagnosis", "text": "التهاب لثة"})
    client.post("/saved-phrases", json={"field_key": "chief_complaint", "text": "ألم عند المضغ"})
    diag = client.get("/saved-phrases", params={"field_key": "diagnosis"}).json()
    assert [p["text"] for p in diag] == ["تسوس عميق", "التهاب لثة"]
    assert len(client.get("/saved-phrases").json()) == 3
    assert client.post("/saved-phrases", json={"field_key": "nope", "text": "x"}).status_code == 422
    assert client.patch(f"/saved-phrases/{a['id']}", json={"version": a["version"], "text": "تسوس"}).json()["text"] == "تسوس"


# ---- clinic info ----
def test_clinic_info(client, admin, make_user):
    assert client.get("/settings/clinic").json()["name_ar"] == ""
    body = {
        "name_ar": "مجمع النخبة الطبي", "name_en": "Elite Medical Complex", "address_ar": "الرياض", "address_en": "Riyadh",
        "phone": "0112345678", "email": "info@example.com", "vat_number": "300000000000003", "cr_number": "1010000000",
    }
    assert client.put("/settings/clinic", json=body).json()["name_en"] == "Elite Medical Complex"
    assert client.put("/settings/clinic", json={**body, "vat_number": "123"}).status_code == 422
    make_user("amal", ["reception"])
    login(client, "amal")
    assert client.get("/settings/clinic").json()["vat_number"] == "300000000000003"
    assert client.put("/settings/clinic", json=body).status_code == 403


