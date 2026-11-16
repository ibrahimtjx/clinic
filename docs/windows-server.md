# Clinic Server for Windows

One installer, `Clinic-Server-Setup-<version>.exe`, puts the whole clinic system on a Windows PC: the
database (PostgreSQL 16), the application, the web app and HTTPS. No Docker. It runs as Windows services
that start with the PC, so nobody has to sign in to the server for the clinic to work.

Get the installer from GitHub: the **Windows server** workflow run → Artifacts → `clinic-server-windows`.

## Requirements

- Windows 10 or 11 (64-bit) or Windows Server 2019+, on a UPS, wired, with a fixed LAN address.
- Ports 80 and 443 free (IIS and some apps use them).
- About 2 GB of disk, plus the data and backups.

## Install

Run the installer as Administrator and answer:

1. **Server name**: what the PCs will type, e.g. `clinic-server` (set it in the router's local DNS, or
   use this PC's name). The certificate also covers this PC's IP addresses.
2. **Administrator**: username, Arabic name and a password (at least 10 characters).
3. **Backups**: a folder on a second drive, a USB backup drive or a network share.
4. **Demo data**: only for trying the system: fake users and doctors, about 400 fake patients and three
   months of appointments, visits, prescriptions, lab results, images, quotations, treatment plans,
   invoices and payments. Also offered when updating (added once). Refused on a server that already has
   more than 30 patients, so it cannot mix into a real clinic's data.

It takes a few minutes. Then open `https://<server name>` (or `https://localhost` on the server).

Start menu → **Clinic Server** has: the system, the server folder, **Read me** (address, certificate
fingerprint, where the backup key is) and **Back up now**.

## After installing

- **Print the backup key** (`C:\ProgramData\ClinicServer\config\backup.key`) and keep it in the safe.
  Every backup is encrypted with it; without it no backup can be restored.
- Install the **desktop app** on the clinic's PCs and enter the server name; it shows the certificate
  fingerprint to compare with the one in **Read me** ([desktop.md](desktop.md)). Browsers need the
  clinic certificate `C:\ProgramData\ClinicServer\clinic-ca.crt` installed ([install-ca.md](install-ca.md)).
- Settings → **System health** shows the server, the last backups and disk space.

## What runs

| Service | What |
|---|---|
| Clinic Database (`ClinicDB`) | PostgreSQL 16, local connections only, runs as Network Service |
| Clinic API (`ClinicAPI`) | The application; applies database updates on start |
| Clinic Web (`ClinicWeb`) | HTTPS (Caddy, with the clinic's own certificate authority) and the web app |
| Clinic Backups (`ClinicOps`) | Encrypted backups and the health report |

Data, patient images and documents (`files`), settings, backups and logs are in `C:\ProgramData\ClinicServer` (only Administrators can read the
settings). Programs are in `C:\Program Files\Clinic Server`.

## Backups

Same schedule as the Linux setup (SPEC 15.2): database changes reach the backup folder every few minutes,
a full backup every night at 02:00 (14 daily and 8 weekly kept, plus the clinic certificate), and a weekly
base backup for restoring to a point in time. Patient images and documents are copied within a minute.
Files end in `.enc` (AES-256-GCM).

From an Administrator command prompt, in `C:\Program Files\Clinic Server\server`:

```bat
clinic-ops backup-now
clinic-ops restore-dump clinic-20261116-0200.dump.enc
clinic-ops restore-pitr base-20261113-0200.tar.enc "2026-11-16 10:45:00"
clinic-ops decrypt FILE.enc FILE
```

`restore-pitr` keeps the previous database folder next to the new one (`pgdata-before-restore-…`).

## Forgotten password

Any administrator can reset another person's password in Settings → Users. If the only administrator
forgot theirs: on the server, Start menu → Clinic Server → **Reset a password**, right-click → **Run as
administrator**, type the username, then a temporary password (at least 10 characters). Sign in with it;
the system asks for a new password straight away. Or from an administrator command prompt:

```bat
"C:\Program Files\Clinic Server\server\clinic-ops.cmd" reset-password admin
```

On the Linux (Docker) server: `docker compose exec api python -m app.cli reset-password --username admin`.

## Updating

Run the newer installer. It skips the setup questions (it still offers demo data, for a test server),
keeps all data and settings, and the database is updated when the application starts.

## Uninstalling

Settings → Apps → Clinic Server → Uninstall. The services are removed; the clinic's data stays in
`C:\ProgramData\ClinicServer` (delete it yourself only if you are sure).

## Standby server

The Windows server is a single server with backups. The primary/standby failover in [failover.md](failover.md)
uses the Linux (Docker) setup. If the Windows server is lost, install Clinic Server on another PC, then
restore the latest backup (`clinic-ops restore-pitr …`) and the clinic certificate from the backup folder.
