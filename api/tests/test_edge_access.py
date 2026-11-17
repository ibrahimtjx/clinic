"""Every endpoint, called signed out and by a user with no permissions: never a 2xx that changes or
reveals clinic data, never a server error."""

import re

from app.main import app
from app.models import Role
from tests.conftest import login

# Open to any signed-in user by design (their own account, lookups the screens need).
OPEN_TO_ANY_USER = {
    ("GET", "/auth/me"),
    ("PATCH", "/auth/me/preferences"),
    ("POST", "/auth/me/password"),
    ("PUT", "/auth/me/pin"),
    ("DELETE", "/auth/me/pin"),
    ("POST", "/auth/logout"),
    ("POST", "/auth/lock"),
    ("POST", "/auth/refresh"),
    ("GET", "/users/directory"),
    ("GET", "/settings/clinic"),
    ("GET", "/assignments/mine"),
    ("GET", "/reports"),
    ("GET", "/payment-orders/waiting-count"),
    ("GET", "/system/warnings"),  # empty for everyone but administrators
}
PUBLIC = {
    ("POST", "/auth/logout"),  # signing out twice is harmless
    ("POST", "/auth/lock"),  # same: only ends a session if there is one
    ("POST", "/auth/login"),
    ("POST", "/auth/pin-login"),
    ("POST", "/auth/refresh"),
    ("GET", "/health"),
}


def routes():
    spec = app.openapi()
    for path, ops in spec["paths"].items():
        for method in ops:
            yield method.upper(), path


def concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def test_signed_out_gets_401_everywhere(client):
    for method, path in routes():
        if (method, path) in PUBLIC:
            continue
        r = client.request(method, concrete(path), json={})
        assert r.status_code == 401, (method, path, r.status_code, r.text[:200])


def test_user_without_permissions_is_refused(client, make_user, db):
    db.add(Role(key="nothing", name_ar="بلا صلاحيات", name_en="No permissions"))
    db.commit()
    make_user("nobody", ["nothing"])
    login(client, "nobody")
    leaks = []
    for method, path in routes():
        if (method, path) in PUBLIC | OPEN_TO_ANY_USER:
            continue
        r = client.request(method, concrete(path), json={})
        if r.status_code >= 500:
            leaks.append((method, path, r.status_code, r.text[:200]))
        elif 200 <= r.status_code < 300:
            body = (
                r.json()
                if r.headers.get("content-type", "").startswith("application/json")
                else r.text
            )
            # Lists the screens need (doctors, statuses, services...) are readable by every user;
            # anything else returning data is a leak.
            leaks.append((method, path, r.status_code, str(body)[:120]))
    allowed_reads = {
        p
        for p in (
            "/clinics",
            "/departments",
            "/appointment-statuses",
            "/visit-types",
            "/saved-phrases",
            "/services",
            "/insurance-companies",
            "/doctors",
            "/medications",
            "/lab-tests",
            "/insurance-classes",
            "/permissions",
            "/clinics/1",
            "/departments/1",
            "/appointment-statuses/1",
            "/visit-types/1",
            "/saved-phrases/1",
            "/services/1",
            "/insurance-companies/1",
            "/doctors/1",
            "/medications/1",
            "/lab-tests/1",
            "/insurance-classes/1",
            "/settings/billing",
            "/settings/queue",
            "/settings/dental",
            "/settings/security",
        )
    }
    real = [x for x in leaks if not (x[0] == "GET" and concrete(x[1]) in allowed_reads)]
    assert real == [], "\n".join(map(str, real))
