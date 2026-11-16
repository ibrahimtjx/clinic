#!/bin/bash
# The ops container's loop (SPEC 15.2, 15.4), on both servers. Every minute: heartbeat; on the
# primary also ship WAL, take the nightly dump once a day after BACKUP_TIME (02:00), and a base
# backup when the newest one is a week old (or none exists yet). Decisions use the files on the
# backup drive, so a restart never skips or repeats a backup.
source /ops/lib.sh
set +e
log "ops started (backup dir $BACKUP)"
roles_done=no
while true; do
  if is_primary; then
    heartbeat primary || record_error "heartbeat failed"
    if [ "$roles_done" != yes ]; then /ops/ensure-roles.sh && roles_done=yes; fi
    # Two primaries (the old one restarted after a failover) would split the data: shout.
    if [ -n "${PEER_IP:-}" ] && [ "$(PGPASSWORD=${MONITOR_PASSWORD:-} psql -h "$PEER_IP" -p "${PEER_DB_PORT:-5432}" -U clinic_monitor -X -t -A -c 'select pg_is_in_recovery()' 2>/dev/null)" = f ]; then
      record_error "TWO PRIMARIES: the server at $PEER_IP is also a primary. Stop it and run ops/rebuild-standby.sh on it."
    fi
    if [ -s "$KEY" ]; then
      /ops/ship-wal.sh || record_error "WAL shipping failed"
      /ops/ship-files.sh || record_error "patient files backup failed"
      if [ "$(date +%H%M)" -ge "${BACKUP_TIME:-0200}" ] && ! compgen -G "$BACKUP/dumps/daily/clinic-$(date +%Y%m%d)-*.dump.gpg" >/dev/null; then
        /ops/dump.sh || record_error "nightly backup failed"
      fi
      # Weekly, or now if there is none; after a failure wait an hour before trying again.
      if [ -z "$(find "$BACKUP/base" -name 'base-*.tar.gpg' -mtime -7 2>/dev/null)" ] \
        && [ -z "$(find "$BACKUP/base/.attempt" -mmin -60 2>/dev/null)" ]; then
        mkdir -p "$BACKUP/base" && touch "$BACKUP/base/.attempt"
        /ops/basebackup.sh || record_error "base backup failed"
      fi
    else
      record_error "no backup key: set BACKUP_KEY_FILE (docs/install.md)"
    fi
  else
    heartbeat standby || log "heartbeat to the primary failed"
  fi
  sleep "${OPS_INTERVAL:-60}"
done
