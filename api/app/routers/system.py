"""System health (SPEC 15.4): replication, WAL archiving, backups and disk space on each server."""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.deps import DbSession, Principal, require
from app.models import SystemStatus

router = APIRouter(prefix="/system", tags=["system"])

LAG_LIMIT = timedelta(minutes=5)  # SPEC 15.4
BACKUP_LIMIT = timedelta(hours=26)  # SPEC 15.4
WAL_LIMIT = timedelta(minutes=15)  # RPO (SPEC 15)
STALE_LIMIT = timedelta(minutes=5)  # a server's ops container reports every minute
DISK_LIMIT = 0.15  # SPEC 15.4


def _admin(p: Principal) -> None:
    if not (p.can("settings.manage") or p.can("audit.view")):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "missing": ["settings.manage"]}
        )


def _pct(free: int | None, total: int | None) -> float | None:
    return round(free / total, 4) if free is not None and total else None


def health(db: Session) -> dict:
    now: datetime = db.scalar(select(func.now()))
    replication = [
        dict(r)
        for r in db.execute(
            text(
                "select application_name, client_addr::text as client_addr, state, "
                "extract(epoch from coalesce(replay_lag, interval '0'))::float as lag_seconds, "
                "pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)::bigint as bytes_behind "
                "from pg_stat_replication"
            )
        ).mappings()
    ]
    slot = db.execute(
        text("select active from pg_replication_slots where slot_name = 'standby'")
    ).scalar_one_or_none()
    archiver = dict(
        db.execute(
            text(
                "select archived_count, last_archived_wal, last_archived_time, failed_count, "
                "last_failed_wal, last_failed_time from pg_stat_archiver"
            )
        )
        .mappings()
        .one()
    )
    nodes = []
    for n in db.scalars(select(SystemStatus).order_by(SystemStatus.role, SystemStatus.node)):
        nodes.append(
            {
                "node": n.node,
                "role": n.role,
                "updated_at": n.updated_at,
                "stale": now - n.updated_at > STALE_LIMIT,
                "disk_total": n.disk_total,
                "disk_free": n.disk_free,
                "disk_free_pct": _pct(n.disk_free, n.disk_total),
                "backup_total": n.backup_total,
                "backup_free": n.backup_free,
                "backup_free_pct": _pct(n.backup_free, n.backup_total),
                "last_wal_at": n.last_wal_at,
                "last_dump_at": n.last_dump_at,
                "last_dump_bytes": n.last_dump_bytes,
                "last_dump_file": n.last_dump_file,
                "last_basebackup_at": n.last_basebackup_at,
                "last_error": n.last_error,
                "last_error_at": n.last_error_at,
            }
        )

    warnings: list[dict] = []

    def warn(code: str, severity: str = "warning", **params) -> None:
        warnings.append({"code": code, "severity": severity, "params": params})

    # Replication (SPEC 15.4: lag over 5 minutes).
    if replication:
        worst = max(r["lag_seconds"] or 0 for r in replication)
        if worst > LAG_LIMIT.total_seconds():
            warn("replication_lag", "danger", minutes=round(worst / 60))
    elif slot is not None:
        warn("standby_disconnected", "danger")
    else:
        warn("no_standby")
    # Backups (SPEC 15.4: last backup older than 26 hours) and WAL shipping (RPO 15 minutes).
    primaries = [n for n in nodes if n["role"] == "primary"]
    if not primaries:
        warn("ops_not_running", "danger")
    for n in primaries:
        if not n["last_dump_at"] or now - n["last_dump_at"] > BACKUP_LIMIT:
            warn("backup_old", "danger", node=n["node"], at=n["last_dump_at"])
        if not n["last_wal_at"] or now - n["last_wal_at"] > WAL_LIMIT:
            warn("wal_not_shipped", "danger", node=n["node"], at=n["last_wal_at"])
    if archiver["failed_count"] and (
        not archiver["last_archived_time"]
        or archiver["last_failed_time"] > archiver["last_archived_time"]
    ):
        warn("archive_failing", "danger", wal=archiver["last_failed_wal"])
    # Each server (SPEC 15.4: disk space under 15%).
    for n in nodes:
        if n["stale"]:
            warn("node_silent", "danger", node=n["node"], at=n["updated_at"])
        for kind in ("disk", "backup"):
            pct = n[f"{kind}_free_pct"]
            if pct is not None and pct < DISK_LIMIT:
                warn(f"{kind}_low", "danger", node=n["node"], pct=round(pct * 100))
        if n["last_error"] and n["last_error_at"] and now - n["last_error_at"] < timedelta(hours=1):
            warn("ops_error", "danger", node=n["node"], message=n["last_error"])
    return {
        "now": now,
        "role": "standby" if db.scalar(text("select pg_is_in_recovery()")) else "primary",
        "replication": replication,
        "standby_slot": None if slot is None else {"active": slot},
        "archiver": archiver,
        "nodes": nodes,
        "warnings": warnings,
        "ok": not any(w["severity"] == "danger" for w in warnings),
    }


@router.get("/health")
def system_health(db: DbSession, p: Principal = Depends(require())) -> dict:
    """The Settings → System health page."""
    _admin(p)
    return health(db)


@router.get("/warnings")
def system_warnings(db: DbSession, p: Principal = Depends(require())) -> dict:
    """For the admin warning banner (SPEC 15.4); empty for everyone else."""
    if not p.can("settings.manage"):
        return {"warnings": []}
    return {"warnings": [w for w in health(db)["warnings"] if w["severity"] == "danger"]}
