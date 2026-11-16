#!/bin/bash
# Shared helpers for the ops container (SPEC 15). Runs in the postgres:16 (Debian) image, which
# already has psql, pg_dump, pg_basebackup, gpg and zstd.
set -euo pipefail

export TZ=${TZ:-Asia/Riyadh}
export PGUSER=${POSTGRES_USER:-clinic} PGDATABASE=${POSTGRES_DB:-clinic} PGPASSWORD=${POSTGRES_PASSWORD:-}
BACKUP=/backup                 # the backup drive or NAS (BACKUP_DIR in .env)
STAGING=/wal-staging           # WAL handed over by PostgreSQL's archive_command
KEY=/run/secrets/backup_key    # passphrase file for backup encryption
NODE=${NODE_NAME:-$(hostname)}

log() { echo "$(date '+%F %T') [$NODE] $*"; }

local_psql() { psql -h db -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

is_primary() { [ "$(local_psql -c 'select not pg_is_in_recovery()' 2>/dev/null)" = "t" ]; }

need_key() {
  if [ ! -s "$KEY" ]; then
    log "ERROR: no backup key at BACKUP_KEY_FILE; backups are not written unencrypted"
    return 1
  fi
}

encrypt() { gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$KEY" --symmetric --cipher-algo AES256 --compress-algo none -o "$2" "$1"; }
decrypt() { gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$KEY" --decrypt -o "$2" "$1"; }

# Write this server's heartbeat and backup state into the primary database (system_status).
heartbeat() {
  local role=$1 extra=${2:-}
  local disk backup
  disk=$(df -kP / | awk 'NR==2 {print $2*1024, $4*1024}')
  backup=$(df -kP "$BACKUP" | awk 'NR==2 {print $2*1024, $4*1024}')
  local sql="insert into system_status (node, role, updated_at, disk_total, disk_free, backup_total, backup_free)
      values ('$NODE', '$role', now(), ${disk% *}, ${disk#* }, ${backup% *}, ${backup#* })
      on conflict (node) do update set role = excluded.role, updated_at = now(),
        disk_total = excluded.disk_total, disk_free = excluded.disk_free,
        backup_total = excluded.backup_total, backup_free = excluded.backup_free;
      $extra"
  if [ "$role" = primary ]; then
    local_psql -c "$sql"
  elif [ -n "${PEER_IP:-}" ]; then
    PGPASSWORD=${MONITOR_PASSWORD:-} psql -h "$PEER_IP" -p "${PEER_DB_PORT:-5432}" -U clinic_monitor -X -q -v ON_ERROR_STOP=1 -c "$sql"
  fi
}

set_status() { # column = value (SQL), on the primary only
  local_psql -c "update system_status set $1 where node = '$NODE'"
}

record_error() {
  local msg=${1//\'/\'\'}
  log "ERROR: $1"
  local_psql -c "update system_status set last_error = '$msg', last_error_at = now() where node = '$NODE'" 2>/dev/null || true
}
