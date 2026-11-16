#!/bin/bash
# Inside the ops container (with the database volume at /pgdata, database stopped): lay down a base
# backup and stage the archived WAL so PostgreSQL replays it up to the target time on start.
source /ops/lib.sh
need_key
base=$1; target=${2:-}
f=$base; [ -f "$f" ] || f="$BACKUP/base/$base"
[ -f "$f" ] || { log "not found: $base"; exit 1; }
tmp=$(mktemp -d -p "$BACKUP"); trap 'rm -rf "$tmp"' EXIT
decrypt "$f" "$tmp/base.tar"
mkdir -p "$tmp/x" && tar -xf "$tmp/base.tar" -C "$tmp/x"
find /pgdata -mindepth 1 -delete
tar -xzf "$tmp/x/base.tar.gz" -C /pgdata
[ -f "$tmp/x/pg_wal.tar.gz" ] && tar -xzf "$tmp/x/pg_wal.tar.gz" -C /pgdata/pg_wal
# Stage every archived WAL file newer than the base backup (and a day before, to be safe).
mkdir -p "$STAGING/restore"
since=$(date -d "@$(( $(date -r "$f" +%s) - 86400 ))" '+%F %T')
find "$BACKUP/wal" -name '*.gpg' -newermt "$since" | while read -r w; do
  decrypt "$w" "$STAGING/restore/$(basename "$w" .gpg)"
done
rm -f /pgdata/standby.signal
touch /pgdata/recovery.signal
{
  echo "recovery_target_action = 'promote'"
  [ -n "$target" ] && echo "recovery_target_time = '$target'"
} >> /pgdata/postgresql.auto.conf
chown -R 70:70 /pgdata "$STAGING/restore"   # postgres user of the postgres:16-alpine image
chmod 700 /pgdata
log "base backup laid down; $(ls "$STAGING/restore" | wc -l) WAL file(s) staged"
