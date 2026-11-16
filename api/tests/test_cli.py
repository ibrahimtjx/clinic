from argparse import Namespace
from contextlib import contextmanager

from app import cli
from app.models import User
from tests.conftest import login


def test_reset_password_from_the_server(client, db, make_user, monkeypatch):
    @contextmanager
    def session():
        yield db

    monkeypatch.setattr(cli, "SessionLocal", session)
    user = make_user("boss", ["admin"])
    user.failed_logins, user.is_active = 9, False
    db.commit()
    assert cli.reset_password(Namespace(username="nobody", password="Temp-Reset-2026!")) == 1
    assert cli.reset_password(Namespace(username="BOSS", password="short")) == 1
    assert cli.reset_password(Namespace(username="BOSS", password="Temp-Reset-2026!")) == 0
    db.refresh(user)
    assert user.must_change_password and user.is_active and user.failed_logins == 0
    me = login(client, "boss", "Temp-Reset-2026!")
    assert me["user"]["must_change_password"] is True
    assert db.get(User, user.id).locked_until is None
