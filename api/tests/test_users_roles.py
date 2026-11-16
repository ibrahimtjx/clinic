import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.models import AuditLog, Role
from app.permissions import PERMISSION_KEYS
from tests.conftest import PASSWORD, login


def role_id(db, key: str) -> int:
    return db.scalar(select(Role.id).where(Role.key == key))


def test_admin_creates_user_who_must_change_password(client, admin, db):
    res = client.post(
        "/users",
        json={
            "username": "amal",
            "full_name_ar": " أمل الغامدي ",
            "full_name_en": "Amal",
            "password": "Temp-Pass-2026",
            "role_ids": [role_id(db, "reception")],
        },
    )
    assert res.status_code == 201, res.text
    u = res.json()
    assert u["full_name_ar"] == "أمل الغامدي"
    assert u["must_change_password"] is True and u["has_pin"] is False
    assert [r["key"] for r in u["roles"]] == ["reception"]
    row = db.scalars(
        select(AuditLog).where(AuditLog.table_name == "users", AuditLog.action == "create")
    ).all()[-1]
    assert row.user_id == admin.id and row.machine == "TEST-PC"
    assert row.new_json["password_hash"] == "***" and row.new_json["username"] == "amal"


def test_create_user_validation(client, admin, db):
    rid = role_id(db, "reception")
    base = {
        "username": "amal",
        "full_name_ar": "أمل",
        "password": "Temp-Pass-2026",
        "role_ids": [rid],
    }
    assert (
        client.post("/users", json={**base, "password": "short"}).json()["detail"]["code"]
        == "password_too_short"
    )
    assert client.post("/users", json={**base, "username": "bad name"}).status_code == 422
    assert client.post("/users", json={**base, "role_ids": []}).status_code == 422
    assert (
        client.post("/users", json={**base, "role_ids": [99999]}).json()["detail"]["code"]
        == "unknown_role"
    )
    assert client.post("/users", json=base).status_code == 201
    assert (
        client.post("/users", json={**base, "username": "AMAL"}).json()["detail"]["code"]
        == "username_taken"
    )


def test_non_admin_cannot_manage_users(client, make_user):
    make_user("amal", ["reception", "doctor"])
    login(client, "amal")
    res = client.get("/users")
    assert res.status_code == 403
    assert res.json()["detail"] == {"code": "forbidden", "missing": ["user.manage"]}
    assert client.get("/roles").status_code == 403
    assert client.get("/audit").status_code == 403
    assert client.put("/settings/security", json={}).status_code == 403


def test_update_user_with_optimistic_locking(client, admin, make_user, db):
    u = make_user("amal", ["reception"])
    v0 = u.version
    first = client.patch(f"/users/{u.id}", json={"version": v0, "full_name_en": "Amal G"})
    assert first.status_code == 200 and first.json()["version"] == v0 + 1
    stale = client.patch(f"/users/{u.id}", json={"version": v0, "full_name_en": "Other"})
    assert stale.status_code == 409
    detail = stale.json()["detail"]
    assert detail["code"] == "stale_record" and detail["updated_by"] == admin.full_name_ar
    roles = client.patch(
        f"/users/{u.id}",
        json={
            "version": first.json()["version"],
            "role_ids": [role_id(db, "doctor"), role_id(db, "cashier")],
        },
    )
    assert sorted(r["key"] for r in roles.json()["roles"]) == ["cashier", "doctor"]
    assert roles.json()["version"] == first.json()["version"] + 1


def test_cannot_remove_last_admin(client, admin, db):
    res = client.patch(
        f"/users/{admin.id}", json={"version": admin.version, "role_ids": [role_id(db, "manager")]}
    )
    assert res.json()["detail"]["code"] == "last_admin"
    assert (
        client.post(f"/users/{admin.id}/deactivate").json()["detail"]["code"]
        == "cannot_deactivate_self"
    )


def test_reset_password_unlocks_and_ends_sessions(client, admin, make_user, db):
    u = make_user("amal", ["reception"])
    other = client.post("/auth/login", json={"username": "amal", "password": PASSWORD}).json()[
        "access_token"
    ]
    res = client.post(f"/users/{u.id}/reset-password", json={"new_password": "Temp-Pass-2026"})
    assert res.json()["must_change_password"] is True
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {other}"}).status_code == 401


def test_unlock_user(client, admin, make_user, db):
    u = make_user("amal", ["reception"])
    for _ in range(5):
        client.post("/auth/login", json={"username": "amal", "password": "nope-nope-nope"})
    assert client.get(f"/users/{u.id}").json()["locked_until"] is not None
    res = client.post(f"/users/{u.id}/unlock")
    assert res.json()["locked_until"] is None
    assert (
        client.post("/auth/login", json={"username": "amal", "password": PASSWORD}).status_code
        == 200
    )


def test_deactivate_and_activate(client, admin, make_user):
    u = make_user("amal", ["reception"])
    assert client.post(f"/users/{u.id}/deactivate").json()["is_active"] is False
    assert (
        client.post("/auth/login", json={"username": "amal", "password": PASSWORD}).status_code
        == 401
    )
    assert client.post(f"/users/{u.id}/activate").json()["is_active"] is True
    assert len(client.get("/users").json()) == 2
    assert client.get("/users/999999").status_code == 404


def test_admin_clears_user_pin(client, admin, make_user):
    u = make_user("amal", ["reception"])
    assert client.delete(f"/users/{u.id}/pin").json()["has_pin"] is False


def test_roles_and_permission_catalog(client, admin):
    roles = client.get("/roles").json()
    assert [r["key"] for r in roles] == ["admin", "manager", "reception", "doctor", "cashier"]
    assert set(roles[0]["permissions"]) == PERMISSION_KEYS
    perms = client.get("/permissions").json()
    assert {p["key"] for p in perms} == PERMISSION_KEYS


def test_edit_role_matrix_changes_access(client, admin, make_user, db):
    make_user("amal", ["reception"])
    rid = role_id(db, "reception")
    role = next(r for r in client.get("/roles").json() if r["id"] == rid)
    res = client.patch(
        f"/roles/{rid}",
        json={"version": role["version"], "permissions": [*role["permissions"], "audit.view"]},
    )
    assert res.status_code == 200 and "audit.view" in res.json()["permissions"]
    assert (
        client.patch(f"/roles/{rid}", json={"version": role["version"], "name_en": "x"}).status_code
        == 409
    )
    bad = client.patch(
        f"/roles/{rid}", json={"version": res.json()["version"], "permissions": ["nope.x"]}
    )
    assert bad.json()["detail"]["code"] == "unknown_permission"
    login(client, "amal")
    assert client.get("/audit").status_code == 200


def test_admin_role_permissions_are_fixed(client, admin, db):
    rid = role_id(db, "admin")
    res = client.patch(f"/roles/{rid}", json={"version": 1, "permissions": []})
    assert res.json()["detail"]["code"] == "admin_role_fixed"


def test_custom_role_lifecycle(client, admin, make_user, db):
    res = client.post(
        "/roles",
        json={
            "key": "nurse",
            "name_ar": "ممرضة",
            "name_en": "Nurse",
            "permissions": ["queue.view"],
        },
    )
    assert res.status_code == 201
    nurse = res.json()
    assert (
        client.post("/roles", json={"key": "nurse", "name_ar": "x", "name_en": "x"}).status_code
        == 409
    )
    assert (
        client.delete(f"/roles/{role_id(db, 'doctor')}").json()["detail"]["code"] == "system_role"
    )
    u = client.post(
        "/users",
        json={
            "username": "nora",
            "full_name_ar": "نورة",
            "password": "Temp-Pass-2026",
            "role_ids": [nurse["id"]],
        },
    )
    assert client.delete(f"/roles/{nurse['id']}").json()["detail"]["code"] == "role_in_use"
    client.patch(
        f"/users/{u.json()['id']}",
        json={"version": u.json()["version"], "role_ids": [role_id(db, "doctor")]},
    )
    assert client.delete(f"/roles/{nurse['id']}").status_code == 204


def test_security_settings(client, admin, make_user):
    assert client.get("/settings/security").json() == {
        "auto_lock_minutes": 5,
        "lockout_attempts": 5,
        "lockout_minutes": 15,
    }
    res = client.put(
        "/settings/security",
        json={"auto_lock_minutes": 10, "lockout_attempts": 3, "lockout_minutes": 30},
    )
    assert res.json()["auto_lock_minutes"] == 10
    assert client.put("/settings/security", json={"auto_lock_minutes": 0}).status_code == 422
    assert client.get("/auth/me").json()["security"]["auto_lock_minutes"] == 10
    make_user("amal", ["reception"])
    for _ in range(2):
        client.post("/auth/login", json={"username": "amal", "password": "nope-nope-nope"})
    assert (
        client.post(
            "/auth/login", json={"username": "amal", "password": "nope-nope-nope"}
        ).status_code
        == 423
    )


def test_audit_listing_and_filters(client, admin, make_user):
    u = make_user("amal", ["reception"])
    client.post(f"/users/{u.id}/unlock")
    page = client.get("/audit", params={"table_name": "users", "record_id": str(u.id)}).json()
    assert page["items"][0]["action"] == "unlock"
    assert page["items"][0]["user_name"] == admin.full_name_ar
    first = client.get("/audit", params={"limit": 2}).json()
    assert len(first["items"]) == 2 and first["next_cursor"]
    nxt = client.get("/audit", params={"limit": 2, "before_id": first["next_cursor"]}).json()
    assert nxt["items"][0]["id"] < first["items"][-1]["id"]
    assert (
        client.get("/audit", params={"action": "login", "user_id": admin.id}).json()["items"][0][
            "machine"
        ]
        == "TEST-PC"
    )


def test_audit_log_is_append_only_in_the_database(db, client, admin):
    with pytest.raises(DBAPIError, match="append-only"), db.begin_nested():
        db.execute(text("UPDATE audit_log SET action = 'x'"))
    with pytest.raises(DBAPIError, match="append-only"), db.begin_nested():
        db.execute(text("DELETE FROM audit_log"))
