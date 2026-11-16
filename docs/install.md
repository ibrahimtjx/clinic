# Installing the clinic system

For the person setting up the servers. Two PCs (primary and standby, SPEC 15.1), a backup drive or NAS,
and the clinic's Windows PCs. Allow half a day the first time.

## 1. Hardware and network

- **Primary server:** a PC or mini PC with an SSD, on a UPS, wired to the clinic switch, with a fixed LAN
  address (set it in the router's DHCP reservations, e.g. `192.168.1.10`).
- **Standby server:** a second PC, same network, fixed address (e.g. `192.168.1.11`). Can be smaller.
- **Backup drive:** an external USB drive or a NAS share, mounted on the primary (and ideally also on
  the standby, so backups continue after a failover). A second drive is rotated off-site weekly.
- **Name:** give the clinic system a name on the network, e.g. `clinic-server`, in the router's local DNS
  (or the hosts file of each PC). It points to the primary's address, or to a **service address** that
  moves to whichever server is primary (`SERVICE_IP`, see below). The PCs only ever use this name.

## 2. Each server: operating system and Docker

Ubuntu Server 24.04 LTS (or Debian 13) with automatic security updates.

```bash
sudo apt update && sudo apt install -y git curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # sign out and in again
sudo timedatectl set-timezone Asia/Riyadh
```

Mount the backup drive at a fixed path, e.g. `/mnt/clinic-backup` (add it to `/etc/fstab` with `nofail`
so the server still starts without it).

## 3. Each server: the clinic system

```bash
git clone https://github.com/ibrahimtjx/clinic.git ~/clinic && cd ~/clinic
cp .env.example .env
```

Edit `.env` (`nano .env`). On **both** servers the same values for: `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB`, `JWT_SECRET`, `REPLICATION_PASSWORD`, `MONITOR_PASSWORD`, `SERVER_NAME`. Make each password
with `openssl rand -hex 24`.

| Setting | Primary (192.168.1.10) | Standby (192.168.1.11) |
|---|---|---|
| `NODE_NAME` | `server-1` | `server-2` |
| `PEER_IP` | `192.168.1.11` | `192.168.1.10` |
| `DB_PUBLISH_IP` | `192.168.1.10` | `192.168.1.11` |
| `BACKUP_DIR` | `/mnt/clinic-backup` | `/mnt/clinic-backup` |
| `BACKUP_KEY_FILE` | `/etc/clinic/backup.key` | `/etc/clinic/backup.key` |
| `SERVICE_IP`, `SERVICE_IFACE` | optional, e.g. `192.168.1.20`, `eno1` | same |

The **backup key** encrypts every backup (they hold patient data). Make it once, copy the same file to
both servers, and keep a printed copy in the clinic's safe: without it no backup can be restored.

```bash
sudo mkdir -p /etc/clinic
openssl rand -base64 48 | sudo tee /etc/clinic/backup.key >/dev/null
sudo chmod 640 /etc/clinic/backup.key && sudo chgrp docker /etc/clinic/backup.key
```

Firewall: only the other server may reach the database port.

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw allow from 192.168.1.11 to any port 5432 proto tcp   # on the primary (the standby's address)
sudo ufw enable
```

## 4. Start the primary

```bash
docker compose up -d --build --wait
docker compose exec api python -m app.cli create-admin --username admin --name-ar "مدير النظام"
```

Open `https://clinic-server` from a PC, install the clinic certificate on each PC ([install-ca.md](install-ca.md))
or let the desktop app do it ([desktop.md](desktop.md)), sign in as admin and fill in Settings → Clinic
details (name, VAT number, CR number), services and prices, doctors, users and roles.

Within a few minutes Settings → **System health** shows the primary, the first base backup and WAL
reaching the backup drive. The nightly backup runs at 02:00.

## 5. Set up the standby

On the **primary**, copy the clinic's certificate authority (the PCs trust it; the standby must use the
same one):

```bash
./ops/export-ca.sh        # writes clinic-ca-export.tgz: move it by USB, then delete it
```

On the **standby** (with `.env` filled in as above and `clinic-ca-export.tgz` in the clinic folder):

```bash
docker compose build
./ops/import-ca.sh && rm clinic-ca-export.tgz
./ops/setup-standby.sh
```

This copies the database from the primary and keeps it in sync. Only the database and the ops service
run on the standby. On the primary, System health now shows the standby, its replication lag and its
disk space.

## 6. Client PCs

Install the desktop app on each Windows PC and choose its printers ([desktop.md](desktop.md)). In a
browser, the system works at `https://clinic-server` once the clinic certificate is installed.

## 7. Before going live

- Run a failover drill ([failover.md](failover.md)) and record it in [drills.md](drills.md).
- Check that a nightly backup can be restored on a spare PC (`./ops/restore.sh`).
- Put the second backup drive in the off-site rotation.
