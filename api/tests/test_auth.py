from datetime import timedelta

from sqlalchemy import func, select

from app.models import AuditLog, AuthSession, User
from tests.conftest import PASSWORD, PIN, login


def test_login_returns_token_cookie_and_profile(client, make_user):
    make_user("amal", ["reception"])
    res = client.post("/auth/login", json={"username": "AMAL", "password": PASSWORD})
    assert res.status_code == 200
    body = res.json()
    assert body["expires_in"] == 15 * 60
    assert body["user"]["username"] == "amal"
    assert "payment.collect" in body["user"]["permissions"]
    assert "user.manage" not in body["user"]["permissions"]
    assert body["user"]["security"]["auto_lock_minutes"] == 5
    cookie = res.headers["set-cookie"]
    assert "clinic_refresh=" in cookie and "HttpOnly" in cookie and "Secure" in cookie
    assert "SameSite=strict" in cookie and "Max-Age=43200" in cookie


def test_wrong_password_and_unknown_user_look_the_same(client, make_user):
    make_user("amal", ["reception"])
    a = client.post("/auth/login", json={"username": "amal", "password": "wrong-password"})
    b = client.post("/auth/login", json={"username": "nobody", "password": "wrong-password"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json() == {"detail": {"code": "invalid_credentials"}}


def test_lockout_after_five_failures_for_fifteen_minutes(client, make_user, db):
    user = make_user("amal", ["reception"])
    for _ in range(4):
        assert client.post("/auth/login", json={"username": "amal", "password": "nope-nope-nope"}).status_code == 401
    res = client.post("/auth/login", json={"username": "amal", "password": "nope-nope-nope"})
    assert res.status_code == 423
    assert res.json()["detail"]["code"] == "account_locked"
    # Even the right password is refused while locked.
    assert client.post("/auth/login", json={"username": "amal", "password": PASSWORD}).status_code == 423
    db.refresh(user)
    remaining = user.locked_until - db.scalar(select(func.now()))
    assert timedelta(minutes=14) < remaining <= timedelta(minutes=15)
    actions = db.scalars(select(AuditLog.action).where(AuditLog.record_id == str(user.id))).all()
    assert actions.count("login_failed") == 5 and "login_blocked" in actions


def test_failed_pins_count_toward_lockout(client, make_user):
    make_user("amal", ["reception"])
    for _ in range(4):
        client.post("/auth/pin-login", json={"username": "amal", "pin": "0000"})
    assert client.post("/auth/pin-login", json={"username": "amal", "pin": "0000"}).status_code == 423


def test_lock_expires(client, make_user, db):
    user = make_user("amal", ["reception"])
    user.locked_until = db.scalar(select(func.now())) - timedelta(seconds=1)
    db.commit()
    login(client, "amal")


def test_inactive_user_cannot_sign_in(client, make_user, db):
    user = make_user("amal", ["reception"])
    user.is_active = False
    db.commit()
    assert client.post("/auth/login", json={"username": "amal", "password": PASSWORD}).status_code == 401


def test_me_requires_token(client):
    res = client.get("/auth/me")
    assert res.status_code == 401
    assert res.json()["detail"]["code"] == "not_authenticated"
    client.headers["Authorization"] = "Bearer garbage"
    assert client.get("/auth/me").json()["detail"]["code"] == "invalid_token"


def test_refresh_uses_cookie(client, make_user):
    make_user("amal", ["reception"])
    login(client, "amal")
    client.headers.pop("Authorization")
    res = client.post("/auth/refresh")
    assert res.status_code == 200
    client.headers["Authorization"] = f"Bearer {res.json()['access_token']}"
    assert client.get("/auth/me").json()["username"] == "amal"


def test_refresh_without_cookie_fails(client):
    assert client.post("/auth/refresh").status_code == 401


def test_lock_ends_session_and_pin_unlocks(client, make_user, db):
    make_user("amal", ["reception"])
    first = login(client, "amal")
    assert client.post("/auth/lock").status_code == 204
    # The old access token stops working immediately.
    assert client.get("/auth/me").json()["detail"]["code"] == "session_ended"
    assert client.post("/auth/refresh").status_code == 401
    res = client.post("/auth/pin-login", json={"username": "amal", "pin": PIN})
    assert res.status_code == 200
    assert res.json()["access_token"] != first["access_token"]
    s = db.scalars(select(AuthSession).order_by(AuthSession.created_at)).all()
    assert [x.revoked_reason for x in s] == ["lock", None]
    assert s[1].method == "pin" and s[1].machine == "TEST-PC"


def test_quick_switch_records_actions_under_new_user(client, make_user, db):
    make_user("amal", ["reception"])
    omar = make_user("omar", ["doctor"])
    login(client, "amal")
    client.post("/auth/lock")
    res = client.post("/auth/pin-login", json={"username": "omar", "pin": PIN})
    client.headers["Authorization"] = f"Bearer {res.json()['access_token']}"
    client.patch("/auth/me/preferences", json={"lang": "en"})
    me = client.get("/auth/me").json()
    assert me["username"] == "omar"
    assert me["preferences"]["lang"] == "en"
    login_row = db.scalars(select(AuditLog).where(AuditLog.action == "login").order_by(AuditLog.id.desc())).first()
    assert login_row.user_id == omar.id and login_row.machine == "TEST-PC"


def test_pin_login_without_pin_set(client, make_user):
    make_user("amal", ["reception"], pin=None)
    res = client.post("/auth/pin-login", json={"username": "amal", "pin": "1234"})
    assert res.status_code == 401 and res.json()["detail"]["code"] == "pin_not_set"


def test_logout(client, make_user):
    make_user("amal", ["reception"])
    login(client, "amal")
    assert client.post("/auth/logout").status_code == 204
    assert client.get("/auth/me").status_code == 401


def test_change_password_policy_and_other_sessions_end(client, make_user, db):
    user = make_user("amal", ["reception"])
    other = login(client, "amal")["access_token"]
    login(client, "amal")
    bad = [
        ({"current_password": "wrong-wrong-wrong", "new_password": "Brand-New-Pass1"}, 400, "wrong_password"),
        ({"current_password": PASSWORD, "new_password": "short"}, 422, "password_too_short"),
        ({"current_password": PASSWORD, "new_password": "AMAL"}, 422, "password_too_short"),
        ({"current_password": PASSWORD, "new_password": PASSWORD}, 422, "password_reused"),
    ]
    for body, code, err in bad:
        res = client.post("/auth/me/password", json=body)
        assert (res.status_code, res.json()["detail"]["code"]) == (code, err)
    res = client.post("/auth/me/password", json={"current_password": PASSWORD, "new_password": "Brand-New-Pass1"})
    assert res.status_code == 200
    client.headers["Authorization"] = f"Bearer {res.json()['access_token']}"
    assert client.get("/auth/me").status_code == 200
    client.headers["Authorization"] = f"Bearer {other}"
    assert client.get("/auth/me").status_code == 401
    db.refresh(user)
    assert user.password_changed_at is not None


def test_password_equal_to_username_rejected(client, make_user):
    make_user("receptionist", ["reception"])
    login(client, "receptionist")
    res = client.post("/auth/me/password", json={"current_password": PASSWORD, "new_password": "ReceptionIST"})
    assert res.json()["detail"]["code"] == "password_equals_username"


def test_forced_password_change_blocks_other_endpoints(client, make_user):
    make_user("amal", ["admin"], must_change=True)
    body = login(client, "amal")
    assert body["user"]["must_change_password"] is True
    assert client.get("/users").json()["detail"]["code"] == "password_change_required"
    assert client.get("/auth/me").status_code == 200
    res = client.post("/auth/me/password", json={"current_password": PASSWORD, "new_password": "Brand-New-Pass1"})
    client.headers["Authorization"] = f"Bearer {res.json()['access_token']}"
    assert client.get("/users").status_code == 200


def test_set_and_clear_pin(client, make_user, db):
    user = make_user("amal", ["reception"], pin=None)
    login(client, "amal")
    assert client.put("/auth/me/pin", json={"password": "wrong-wrong", "pin": "4826"}).status_code == 400
    assert client.put("/auth/me/pin", json={"password": PASSWORD, "pin": "12"}).json()["detail"]["code"] == "pin_format"
    assert client.put("/auth/me/pin", json={"password": PASSWORD, "pin": "1111"}).json()["detail"]["code"] == "pin_too_simple"
    res = client.put("/auth/me/pin", json={"password": PASSWORD, "pin": "482613"})
    assert res.status_code == 200 and res.json()["has_pin"] is True
    audit = db.scalars(select(AuditLog).where(AuditLog.table_name == "users", AuditLog.action == "update")).all()
    assert audit[-1].new_json == {"pin_hash": "***"}  # hashes never reach the audit log
    assert client.delete("/auth/me/pin").json()["has_pin"] is False
    db.refresh(user)
    assert user.pin_hash is None


def test_preferences_are_merged(client, make_user):
    make_user("amal", ["reception"])
    login(client, "amal")
    client.patch("/auth/me/preferences", json={"lang": "en"})
    res = client.patch("/auth/me/preferences", json={"theme": "dark"})
    assert res.json()["preferences"] == {"lang": "en", "theme": "dark", "digits": None}
    assert client.patch("/auth/me/preferences", json={"lang": "fr"}).status_code == 422


def test_deactivated_user_session_ends_immediately(client, make_user, db):
    user = make_user("amal", ["reception"])
    login(client, "amal")
    user.is_active = False
    db.commit()
    assert client.get("/auth/me").json()["detail"]["code"] == "session_ended"


def test_session_expires_after_twelve_hours(client, make_user, db):
    make_user("amal", ["reception"])
    login(client, "amal")
    s = db.scalars(select(AuthSession)).one()
    s.expires_at = db.scalar(select(func.now())) - timedelta(seconds=1)
    db.commit()
    assert client.get("/auth/me").status_code == 401
    assert client.post("/auth/refresh").status_code == 401


def test_username_lookup_is_case_insensitive_and_unique(db, make_user):
    import pytest
    from sqlalchemy.exc import IntegrityError

    make_user("Amal", ["reception"])
    assert db.scalar(select(User.username).where(func.lower(User.username) == "amal")) == "Amal"
    with pytest.raises(IntegrityError):
        make_user("amal", ["reception"])


def test_sign_in_bookkeeping_does_not_bump_version(client, make_user, db):
    """Regression: failed sign-ins and preference saves must not cause false edit conflicts."""
    user = make_user("amal", ["reception"])
    v0 = user.version
    client.post("/auth/login", json={"username": "amal", "password": "nope-nope-nope"})
    login(client, "amal")
    client.patch("/auth/me/preferences", json={"lang": "en"})
    db.refresh(user)
    assert user.version == v0
    assert user.preferences == {"lang": "en"} and user.failed_logins == 0
    # A password change right after a preferences save works (it used to fail with a stale row).
    res = client.post("/auth/me/password", json={"current_password": PASSWORD, "new_password": "Brand-New-Pass1"})
    assert res.status_code == 200
