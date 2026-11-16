# Failover runbook (SPEC 15.3)

Targets: the clinic works again **within 1 hour**, losing **at most 15 minutes** of data (normally none:
the standby is seconds behind).

Print this page and keep it next to the servers.

## When the primary server fails

1. **Is it really down?** Check from two PCs: `https://clinic-server` does not open and the primary does
   not answer (screen, power, network cable). One PC that cannot connect is a PC or network problem, not a
   server failure.
2. **Make sure the old primary stays off.** Switch it off or unplug its network cable. Two primaries would
   split the data.
3. **On the standby**, in the clinic folder:

   ```bash
   cd ~/clinic
   ./ops/promote.sh
   ```

   It checks it is a standby and that the primary does not answer, promotes the database, takes over the
   service address (if `SERVICE_IP` is set), starts the app and waits until it answers. It prints the
   time taken.
4. **If you do not use `SERVICE_IP`:** point the name `clinic-server` to the standby's address in the
   router's local DNS (or the PCs' hosts files).
5. **Check:** sign in as admin, open Settings → System health. The standby is now the primary. "No standby
   server" is expected until step 7. Ask reception to open a patient and the calendar.
6. **Tell the staff** to carry on. PCs reconnect by themselves (refresh the browser if a page shows an error).

## After repairing the old primary

7. Start it **with its network cable connected only after** reading this step. In its clinic folder:

   ```bash
   ./ops/rebuild-standby.sh
   ```

   It releases the service address, deletes its old database and copies the current one from the new
   primary. It is now the standby. (Its `PEER_IP` already points to the other server.)
8. Optional, at a quiet time: switch the roles back by running `./ops/promote.sh` on the original server
   (after stopping the current primary) and `./ops/rebuild-standby.sh` on the other.

## If both servers are lost

Restore on any PC with Docker and the clinic folder, the `.env`, the **backup key** and the backup drive:

First install the clinic CA from the backup ("Clinic CA from a backup" below), so the PCs keep trusting
the server. Then:

```bash
./ops/restore.sh list
./ops/restore.sh dump clinic-20261116-0200.dump.gpg            # last night's backup, or
./ops/restore.sh pitr base-20261113-0200.tar.gpg "2026-11-16 10:45:00"   # up to a point in time
```

`pitr` (point in time) uses the weekly base backup plus the WAL archived every few minutes, so the loss
is at most about 15 minutes.

### Clinic CA from a backup

The nightly backup also keeps the clinic CA (`/backup/ca/caddy-pki-*.tar.gpg`). To use it:

```bash
gpg --batch --pinentry-mode loopback --passphrase-file /etc/clinic/backup.key -d BACKUP/ca/caddy-pki-XXXX.tar.gpg > pki.tar
mkdir caddy-pki && tar -xf pki.tar -C caddy-pki --strip-components=1 && tar -czf clinic-ca-export.tgz caddy-pki
./ops/import-ca.sh
```

## Warnings on the health page

| Warning | What to do |
|---|---|
| Standby not connected / behind | Check the standby is on and on the network; `docker compose ps` there. If it stays behind, run `./ops/setup-standby.sh` on it. |
| Last nightly backup older than 26 hours | Check the backup drive is mounted (`df -h /mnt/clinic-backup`) and `docker compose logs ops`. |
| No WAL shipped | Same as above; also check the backup key file exists. |
| Disk or backup drive under 15% | Free space or replace the drive; old backups are already pruned (14 daily, 8 weekly). |
| TWO PRIMARIES | Switch off the server that should not be primary and run `./ops/rebuild-standby.sh` on it. |
