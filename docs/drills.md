# Failover and restore drills (SPEC 15.5)

Run a full drill before going live and then every 3 months. Each drill must bring the clinic back
within **1 hour**. Record every drill here.

## How to run a drill

1. Pick a quiet time; tell staff the system pauses for a few minutes.
2. On the primary, write something recognisable (e.g. a test patient "تجربة تحويل").
3. Switch the primary off (or pull its network cable). Start the clock.
4. Follow [failover.md](failover.md) on the standby (`./ops/promote.sh`). Stop the clock when a PC can
   sign in and open the test patient.
5. Rebuild the old primary as standby (`./ops/rebuild-standby.sh`), then switch roles back if wanted.
6. Restore last night's backup on a spare PC (`./ops/restore.sh dump …`) and check the patient count.
7. Write the result below.

## Record

| Date | Who | Scenario | Time to working system | Data lost | Problems found | Fixed |
|---|---|---|---|---|---|---|
| 2026-11-16 | Development (simulated) | Primary stopped; standby promoted; old primary rebuilt as standby; roles switched back | 10 s promote (9 s on switch-back); 7–8 s rebuild | None (marker written seconds before the failure was on the standby) | See below | Yes |
| 2026-11-16 | Development (simulated) | Both servers lost: point-in-time restore from base backup + WAL; restore of a nightly dump | 15 s (PITR), 21 s (dump) | PITR: the last ~1 minute not yet archived (within the 15-minute RPO); dump: since the dump | See below | Yes |

### 2026-11-16, development drill (M11)

Simulated on one Docker host: three copies of the system as separate Compose projects standing in for
the primary, the standby and a spare PC. Real hardware takes longer (copying a large database over the
network, people walking to the server room), so the **clinic must repeat this drill on its own servers**
before going live.

Steps and results:

- Primary A running; ops wrote the first encrypted base backup, nightly dump, clinic CA backup and
  WAL to the backup folder; health page green apart from disk space (the build machine's disk is
  nearly full).
- `export-ca.sh` on A, `import-ca.sh` + `setup-standby.sh` on B: standby streaming in 7 s, lag 0.
- Marker written on A, A stopped. `promote.sh` on B: **10 s**. Marker present, 2,040 patients; a new
  patient created through the app on B got the next file number.
- `rebuild-standby.sh` on A: A streaming from B in 7 s with 2,041 patients.
- Spare C, copy of A's backup folder: `restore.sh pitr` in 15 s (2,040 patients: the marker had not yet
  been archived, as expected for the last few minutes); `restore.sh dump` in 21 s, app answering.
- Switch back: B stopped, `promote.sh` on A (9 s), `rebuild-standby.sh` on B (8 s).

Problems found and fixed during the drill:

1. The ops container's own base backup was refused (no replication access from the local Docker network).
2. WAL archiving failed: the shared staging folder belonged to root, not postgres.
3. The nightly backup did not record its time when the weekly folder was still empty.
4. `restore.sh` ran the restore helpers through the ops loop instead of directly (it hung).
5. A failing base backup retried every minute; now once an hour.
