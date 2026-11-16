# Demo script: M11, deployment and failover

Needs two Linux PCs with Docker on the clinic network and a backup drive ([install.md](install.md)).

## Walkthrough

1. **Install** the primary following [install.md](install.md) (sections 1–4). Settings → **System
   health** shows `server-1` as primary. Within minutes: the first base backup, WAL reaching the backup
   drive, and (at 02:00, or at once on the first day) the nightly backup. Files on the backup drive end in
   `.gpg`: encrypted with the clinic's backup key.
2. **Standby** (section 5): `export-ca.sh` on the primary, `import-ca.sh` and `setup-standby.sh` on the
   standby. The health page shows `server-2` as standby and the replication lag (seconds).
3. **Warnings.** Unplug the standby's network cable: after a few minutes the health page and a red banner
   for admins say the standby is not connected / not reporting. Plug it back: they clear. The same banner
   appears if the last backup is older than 26 hours or a disk has less than 15% free.
4. **Failover drill** ([failover.md](failover.md)): switch the primary off, run `./ops/promote.sh` on the
   standby, sign in from a PC. Then `./ops/rebuild-standby.sh` on the repaired server. Record it in
   [drills.md](drills.md); it must take under an hour.
5. **Restore** on a spare PC: `./ops/restore.sh list`, `./ops/restore.sh dump <file>` (last night) or
   `./ops/restore.sh pitr <base> "<time>"` (up to a point in time).

## Tests

```bash
(cd api && .venv/bin/pytest -q)   # 153 tests (health page warnings, access)
(cd web && pnpm test)             # 54 tests (admin banner)
(cd web && pnpm e2e)              # 28 tests (system health page)
```

The scripts were exercised end to end in the development drill recorded in [drills.md](drills.md).
