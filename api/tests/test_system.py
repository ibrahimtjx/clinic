"""M11: system health page and admin warnings (SPEC 15.4)."""

from datetime import timedelta

from sqlalchemy import func, select

from app.models import SystemStatus
from tests.conftest import login

GB = 1024**3


def _node(db, node="server-1", role="primary", **kw):
    now = db.scalar(select(func.now()))
    row = SystemStatus(
        node=node,
        role=role,
        updated_at=kw.pop("updated_at", now),
        disk_total=100 * GB,
        disk_free=kw.pop("disk_free", 60 * GB),
        backup_total=1000 * GB,
        backup_free=500 * GB,
        last_wal_at=kw.pop("last_wal_at", now - timedelta(minutes=2)),
        last_dump_at=kw.pop("last_dump_at", now - timedelta(hours=3)),
        last_dump_bytes=12_345_678,
        last_dump_file="clinic-20261116-0200.dump.gpg",
        last_basebackup_at=now - timedelta(days=2),
        **kw,
    )
    db.add(row)
    db.commit()
    return now


def codes(body):
    return {w["code"] for w in body["warnings"]}


def test_healthy_primary_without_standby(client, admin, db):
    _node(db)
    body = client.get("/system/health").json()
    assert body["role"] == "primary" and body["nodes"][0]["disk_free_pct"] == 0.6
    # No standby yet is shown, but is not an alarm.
    assert codes(body) == {"no_standby"} and body["ok"] is True
    assert client.get("/system/warnings").json() == {"warnings": []}


def test_alarms_for_old_backup_low_disk_silent_standby_and_errors(client, admin, db):
    now = db.scalar(select(func.now()))
    _node(
        db,
        last_dump_at=now - timedelta(hours=30),
        last_wal_at=now - timedelta(minutes=40),
        disk_free=10 * GB,
        last_error="nightly backup failed",
        last_error_at=now - timedelta(minutes=5),
    )
    _node(db, node="server-2", role="standby", updated_at=now - timedelta(minutes=20))
    body = client.get("/system/health").json()
    assert {"backup_old", "wal_not_shipped", "disk_low", "node_silent", "ops_error"} <= codes(body)
    assert body["ok"] is False
    low = next(w for w in body["warnings"] if w["code"] == "disk_low")
    assert low["params"] == {"node": "server-1", "pct": 10}
    banner = client.get("/system/warnings").json()["warnings"]
    assert "no_standby" not in {w["code"] for w in banner} and "backup_old" in {
        w["code"] for w in banner
    }


def test_no_ops_container_is_an_alarm(client, admin):
    assert "ops_not_running" in codes(client.get("/system/health").json())


def test_access(client, make_user, db):
    make_user("amal", ["reception"])
    login(client, "amal")
    assert client.get("/system/health").status_code == 403
    assert client.get("/system/warnings").json() == {"warnings": []}
