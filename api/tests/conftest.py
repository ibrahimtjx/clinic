"""Test setup: a dedicated database migrated once; every test runs inside a transaction that is
rolled back, so commits in endpoints never persist (the audit log cannot be truncated)."""

import os
from collections.abc import Iterator

import psycopg
import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

BASE_URL = os.environ.get(
    "CLINIC_DATABASE_URL", "postgresql+psycopg://clinic:clinic@localhost:5432/clinic"
)
TEST_URL = make_url(BASE_URL).set(database="clinic_test")
os.environ["CLINIC_DATABASE_URL"] = TEST_URL.render_as_string(hide_password=False)
os.environ["CLINIC_COOKIE_PATH"] = "/auth"  # TestClient calls the app without the /api prefix
os.environ["CLINIC_BCRYPT_ROUNDS"] = "4"
os.environ["CLINIC_JWT_SECRET"] = "test-secret-0123456789-0123456789-abcdef"
os.environ["CLINIC_FILES_DIR"] = __import__("tempfile").mkdtemp(prefix="clinic-files-")


def _ensure_database() -> None:
    admin = make_url(BASE_URL).set(drivername="postgresql", database="postgres")
    with psycopg.connect(admin.render_as_string(hide_password=False), autocommit=True) as conn:
        if not conn.execute("SELECT 1 FROM pg_database WHERE datname = 'clinic_test'").fetchone():
            conn.execute("CREATE DATABASE clinic_test")


_ensure_database()

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.models import Role, User, UserRole
from app.security import hash_secret

PASSWORD = "Correct-Horse-9"
PIN = "4826"


@pytest.fixture(scope="session")
def engine():
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option(
        "script_location", os.path.join(os.path.dirname(__file__), "..", "migrations")
    )
    command.upgrade(cfg, "head")
    eng = create_engine(TEST_URL)
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine) -> Iterator[Session]:
    conn = engine.connect()
    trans = conn.begin()
    session = Session(
        bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False, autoflush=False
    )
    conn.exec_driver_sql("SET TIME ZONE 'Asia/Riyadh'")
    yield session
    session.close()
    trans.rollback()
    conn.close()


@pytest.fixture
def client(db) -> Iterator[TestClient]:
    def override():
        try:
            yield db
        except Exception:
            db.rollback()
            raise

    app.dependency_overrides[get_db] = override
    with TestClient(
        app, base_url="https://testserver", headers={"X-Client-Machine": "TEST-PC"}
    ) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def make_user(db):
    def _make(
        username: str, roles: list[str], *, pin: str | None = PIN, must_change: bool = False, **kw
    ) -> User:
        user = User(
            username=username,
            full_name_ar=kw.get("full_name_ar", f"مستخدم {username}"),
            full_name_en=kw.get("full_name_en", f"User {username}"),
            password_hash=hash_secret(PASSWORD),
            pin_hash=hash_secret(pin) if pin else None,
            must_change_password=must_change,
        )
        db.add(user)
        db.flush()
        for key in roles:
            role = db.query(Role).filter_by(key=key).one()
            db.add(UserRole(user_id=user.id, role_id=role.id))
        db.commit()
        db.refresh(user)
        return user

    return _make


def login(client: TestClient, username: str, password: str = PASSWORD) -> dict:
    res = client.post("/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    body = res.json()
    client.headers["Authorization"] = f"Bearer {body['access_token']}"
    return body


@pytest.fixture
def admin(client, make_user):
    user = make_user("admin1", ["admin"])
    login(client, "admin1")
    return user
