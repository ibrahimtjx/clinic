"""Backups and health heartbeat for the Windows server (SPEC 15.2, 15.4).

The same job as the ops container on Linux (ops/bin/run.sh), for a single Windows server:
  - WAL archived by PostgreSQL to wal-staging is encrypted onto the backup folder within a minute;
  - a nightly pg_dump after BACKUP_TIME (14 daily, 8 weekly kept) plus the clinic CA;
  - a weekly base backup for point-in-time restore (2 kept, older WAL pruned);
  - a heartbeat row in system_status every minute (disk space, last backups, last error).

Commands (run as Administrator from the install folder):
  python ops_win.py run                    the service loop (ClinicOps)
  python ops_win.py backup-now             nightly backup now
  python ops_win.py restore-dump FILE      replace the database with a nightly backup
  python ops_win.py restore-pitr BASE [TIME]   base backup + WAL, up to TIME ("2026-11-16 10:45:00")
  python ops_win.py decrypt IN OUT         decrypt any backup file

Encryption: AES-256-GCM, key from the passphrase file with scrypt. File layout:
  b"CLNC1" | salt (16) | nonce (12) | ciphertext | tag (16)
"""

import datetime as dt
import io
import os
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import traceback
from pathlib import Path

import psycopg
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

APP = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("CLINIC_DATA", r"C:\ProgramData\ClinicServer"))
PGBIN = APP / "pgsql" / "bin"
MAGIC = b"CLNC1"
CHUNK = 1 << 20


def load_env() -> None:
    for line in (DATA / "config" / "clinic.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def cfg(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def backup_dir() -> Path:
    return Path(cfg("BACKUP_DIR", str(DATA / "backups")))


def node() -> str:
    return cfg("NODE_NAME", socket.gethostname())


def log(msg: str) -> None:
    print(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} [{node()}] {msg}", flush=True)


def conninfo(dbname: str | None = None) -> str:
    return (
        f"host=127.0.0.1 port={cfg('PGPORT', '5432')} user={cfg('POSTGRES_USER', 'clinic')} "
        f"password={cfg('POSTGRES_PASSWORD')} dbname={dbname or cfg('POSTGRES_DB', 'clinic')}"
    )


def pg_env() -> dict:
    env = dict(os.environ)
    env.update(PGHOST="127.0.0.1", PGPORT=cfg("PGPORT", "5432"), PGUSER=cfg("POSTGRES_USER", "clinic"),
               PGPASSWORD=cfg("POSTGRES_PASSWORD"), PGDATABASE=cfg("POSTGRES_DB", "clinic"))
    return env


def sql(query: str, params: tuple = ()) -> list:
    with psycopg.connect(conninfo(), autocommit=True, connect_timeout=5) as c:
        cur = c.execute(query, params)
        return cur.fetchall() if cur.description else []


# ---------------------------------------------------------------- encryption
def _key(salt: bytes) -> bytes:
    passphrase = Path(cfg("BACKUP_KEY_FILE", str(DATA / "config" / "backup.key"))).read_bytes().strip()
    if not passphrase:
        raise RuntimeError("the backup key file is empty")
    return Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(passphrase)


def encrypt(src: Path, dst: Path) -> None:
    salt, nonce = os.urandom(16), os.urandom(12)
    enc = Cipher(algorithms.AES(_key(salt)), modes.GCM(nonce)).encryptor()
    part = dst.with_name(dst.name + ".part")
    with src.open("rb") as fi, part.open("wb") as fo:
        fo.write(MAGIC + salt + nonce)
        while chunk := fi.read(CHUNK):
            fo.write(enc.update(chunk))
        fo.write(enc.finalize() + enc.tag)
    os.replace(part, dst)


def decrypt(src: Path, dst: Path) -> None:
    size = src.stat().st_size
    with src.open("rb") as fi:
        if fi.read(5) != MAGIC:
            raise RuntimeError(f"{src.name} is not a clinic backup file")
        salt, nonce = fi.read(16), fi.read(12)
        fi.seek(size - 16)
        tag = fi.read(16)
        fi.seek(33)
        dec = Cipher(algorithms.AES(_key(salt)), modes.GCM(nonce, tag)).decryptor()
        left = size - 33 - 16
        with dst.open("wb") as fo:
            while left > 0:
                chunk = fi.read(min(CHUNK, left))
                left -= len(chunk)
                fo.write(dec.update(chunk))
            fo.write(dec.finalize())  # raises if the file was changed or the key is wrong


# ---------------------------------------------------------------- status
def heartbeat() -> None:
    disk = shutil.disk_usage(DATA)
    bk = backup_dir()
    bk.mkdir(parents=True, exist_ok=True)
    bdisk = shutil.disk_usage(bk)
    sql(
        "insert into system_status (node, role, updated_at, disk_total, disk_free, backup_total, backup_free) "
        "values (%s, 'primary', now(), %s, %s, %s, %s) on conflict (node) do update set role = 'primary', "
        "updated_at = now(), disk_total = excluded.disk_total, disk_free = excluded.disk_free, "
        "backup_total = excluded.backup_total, backup_free = excluded.backup_free",
        (node(), disk.total, disk.free, bdisk.total, bdisk.free),
    )


def set_status(assignments: str, params: tuple = ()) -> None:
    sql(f"update system_status set {assignments} where node = %s", (*params, node()))


def record_error(msg: str) -> None:
    log(f"ERROR: {msg}")
    try:
        set_status("last_error = %s, last_error_at = now()", (msg,))
    except Exception:  # noqa: BLE001  (the database may be the problem)
        pass


# ---------------------------------------------------------------- jobs
def ship_wal() -> None:
    staging = DATA / "wal-staging"
    out = backup_dir() / "wal"
    out.mkdir(parents=True, exist_ok=True)
    shipped = 0
    for f in sorted(staging.glob("0*")):
        if f.name.endswith(".part") or not f.is_file():
            continue
        target = out / (f.name + ".enc")
        if not target.exists():
            encrypt(f, target)
        f.unlink()
        shipped += 1
    if shipped:
        set_status("last_wal_at = now()")
        log(f"shipped {shipped} WAL file(s)")


def prune(folder: Path, pattern: str, keep: int) -> None:
    files = sorted(folder.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[keep:]:
        old.unlink(missing_ok=True)


def dump() -> None:
    bk = backup_dir()
    daily, weekly, ca = bk / "dumps" / "daily", bk / "dumps" / "weekly", bk / "ca"
    for d in (daily, weekly, ca):
        d.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M")
    with tempfile.TemporaryDirectory(dir=bk) as tmp:
        raw = Path(tmp) / "clinic.dump"
        subprocess.run([str(PGBIN / "pg_dump.exe"), "-Fc", "-Z", "6", "-f", str(raw)], env=pg_env(), check=True)
        out = daily / f"clinic-{stamp}.dump.enc"
        encrypt(raw, out)
        size = out.stat().st_size
        if dt.date.today().isoweekday() == 5:  # Friday: keep a weekly copy
            shutil.copy2(out, weekly / out.name)
        pki = DATA / "caddy" / "caddy" / "pki"
        if pki.exists():
            buf = Path(tmp) / "pki.tar"
            with tarfile.open(buf, "w") as t:
                t.add(pki, arcname="pki")
            encrypt(buf, ca / f"caddy-pki-{stamp}.tar.enc")
    prune(daily, "*.dump.enc", 14)
    prune(weekly, "*.dump.enc", 8)
    prune(ca, "*.tar.enc", 3)
    set_status("last_error = null, last_dump_at = now(), last_dump_bytes = %s, last_dump_file = %s", (size, out.name))
    log(f"dump {out} ({size} bytes)")


def basebackup() -> None:
    bk = backup_dir() / "base"
    bk.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M")
    with tempfile.TemporaryDirectory(dir=backup_dir()) as tmp:
        target = Path(tmp) / "base"
        subprocess.run(
            [str(PGBIN / "pg_basebackup.exe"), "-D", str(target), "-Ft", "-z", "-X", "fetch", "--checkpoint=fast", "-l", f"clinic-{stamp}"],
            env=pg_env(), check=True,
        )
        bundle = Path(tmp) / "base.tar"
        with tarfile.open(bundle, "w") as t:
            for f in target.iterdir():
                t.add(f, arcname=f.name)
        out = bk / f"base-{stamp}.tar.enc"
        encrypt(bundle, out)
    prune(bk, "base-*.tar.enc", 2)
    bases = sorted(bk.glob("base-*.tar.enc"), key=lambda p: p.stat().st_mtime)
    if bases:
        cutoff = bases[0].stat().st_mtime - 86400
        for w in (backup_dir() / "wal").glob("*.enc"):
            if w.stat().st_mtime < cutoff:
                w.unlink(missing_ok=True)
    set_status("last_error = null, last_basebackup_at = now()")
    log(f"base backup {out}")


def key_ok() -> bool:
    p = Path(cfg("BACKUP_KEY_FILE", str(DATA / "config" / "backup.key")))
    return p.exists() and p.stat().st_size > 0


def run() -> None:
    log(f"ops started (backup folder {backup_dir()})")
    interval = int(cfg("OPS_INTERVAL", "60"))
    while True:
        try:
            heartbeat()
            if not key_ok():
                record_error("no backup key file: backups are not written")
            else:
                ship_wal()
                today = dt.datetime.now()
                if today.strftime("%H%M") >= cfg("BACKUP_TIME", "0200") and not list(
                    (backup_dir() / "dumps" / "daily").glob(f"clinic-{today:%Y%m%d}-*.dump.enc")
                ):
                    dump()
                base = backup_dir() / "base"
                recent = [p for p in base.glob("base-*.tar.enc") if time.time() - p.stat().st_mtime < 7 * 86400]
                attempt = base / ".attempt"
                if not recent and (not attempt.exists() or time.time() - attempt.stat().st_mtime > 3600):
                    base.mkdir(parents=True, exist_ok=True)
                    attempt.touch()
                    basebackup()
        except Exception as e:  # noqa: BLE001  (keep the service alive; the health page shows it)
            record_error(str(e).strip().splitlines()[-1][:300] if str(e).strip() else type(e).__name__)
            traceback.print_exc()
        time.sleep(interval)


# ---------------------------------------------------------------- restore
def _find(name: str, *folders: str) -> Path:
    p = Path(name)
    if p.exists():
        return p
    for f in folders:
        for cand in (backup_dir() / f).rglob(name):
            return cand
    raise SystemExit(f"not found: {name}")


def service(action: str, name: str) -> None:
    subprocess.run(["sc.exe", action, name], check=False, capture_output=True)
    for _ in range(60):
        out = subprocess.run(["sc.exe", "query", name], capture_output=True, text=True).stdout
        want = "STOPPED" if action == "stop" else "RUNNING"
        if want in out:
            return
        time.sleep(1)


def restore_dump(name: str) -> None:
    f = _find(name, "dumps")
    service("stop", "ClinicAPI")
    with tempfile.TemporaryDirectory(dir=backup_dir()) as tmp:
        raw = Path(tmp) / "clinic.dump"
        decrypt(f, raw)
        db = cfg("POSTGRES_DB", "clinic")
        with psycopg.connect(conninfo("postgres"), autocommit=True) as c:
            c.execute(f'drop database if exists "{db}" with (force)')
            c.execute(f'create database "{db}"')
        subprocess.run([str(PGBIN / "pg_restore.exe"), "-d", db, "--no-owner", "--exit-on-error", str(raw)], env=pg_env(), check=True)
    service("start", "ClinicAPI")
    log(f"restored {f}")


def restore_pitr(name: str, target: str = "") -> None:
    f = _find(name, "base")
    pgdata = DATA / "pgdata"
    restore = DATA / "wal-staging" / "restore"
    for s in ("ClinicAPI", "ClinicOps", "ClinicDB"):
        service("stop", s)
    with tempfile.TemporaryDirectory(dir=backup_dir()) as tmp:
        bundle = Path(tmp) / "base.tar"
        decrypt(f, bundle)
        with tarfile.open(bundle) as t:
            t.extractall(tmp, filter="data")
        keep = pgdata.parent / f"pgdata-before-restore-{dt.datetime.now():%Y%m%d-%H%M}"
        pgdata.rename(keep)
        pgdata.mkdir()
        with tarfile.open(Path(tmp) / "base.tar.gz") as t:
            t.extractall(pgdata, filter="data")
        wal = Path(tmp) / "pg_wal.tar.gz"
        if wal.exists():
            with tarfile.open(wal) as t:
                t.extractall(pgdata / "pg_wal", filter="data")
    restore.mkdir(parents=True, exist_ok=True)
    since = f.stat().st_mtime - 86400
    for w in sorted((backup_dir() / "wal").glob("*.enc")):
        if w.stat().st_mtime >= since:
            decrypt(w, restore / w.name[: -len(".enc")])
    (pgdata / "standby.signal").unlink(missing_ok=True)
    (pgdata / "recovery.signal").write_text("")
    with (pgdata / "postgresql.auto.conf").open("a", encoding="utf-8") as conf:
        conf.write("recovery_target_action = 'promote'\n")
        if target:
            conf.write(f"recovery_target_time = '{target}'\n")
    subprocess.run(["icacls", str(pgdata), "/grant", "*S-1-5-20:(OI)(CI)F", "/T", "/Q"], check=False)
    service("start", "ClinicDB")
    for _ in range(600):
        try:
            if sql("select pg_is_in_recovery()")[0][0] is False:
                break
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2)
    shutil.rmtree(restore, ignore_errors=True)
    service("start", "ClinicAPI")
    service("start", "ClinicOps")
    log(f"restored {f} to {target or 'the end of the archive'}; the old data folder is kept as {keep.name}")


def main(argv: list[str]) -> int:
    load_env()
    cmd = argv[1] if len(argv) > 1 else "run"
    if cmd == "run":
        run()
    elif cmd == "backup-now":
        heartbeat()
        dump()
    elif cmd == "basebackup-now":
        basebackup()
    elif cmd == "restore-dump":
        restore_dump(argv[2])
    elif cmd == "restore-pitr":
        restore_pitr(argv[2], argv[3] if len(argv) > 3 else "")
    elif cmd == "decrypt":
        decrypt(Path(argv[2]), Path(argv[3]))
    elif cmd == "status":
        for row in sql("select node, role, updated_at, last_dump_at, last_wal_at, last_error from system_status"):
            print(row)
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)
    raise SystemExit(main(sys.argv))
