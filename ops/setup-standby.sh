#!/bin/bash
# Make THIS PC the standby of the primary at PEER_IP (SPEC 15.2): copies the primary's database and
# keeps it in sync by streaming replication. Also used by rebuild-standby.sh.
#   ./ops/setup-standby.sh            (asks for confirmation; YES=1 to skip)
source "$(dirname "$0")/common.sh"
[ -n "${PEER_IP:-}" ] || die "Set PEER_IP (the primary's address) in .env"
[ -n "${REPLICATION_PASSWORD:-}" ] || die "Set REPLICATION_PASSWORD in .env (same as on the primary)"
confirm "This DELETES the database on this PC ($PG_VOLUME) and copies it from the primary at $PEER_IP."

say "Stopping this PC's services"
docker compose down --remove-orphans
docker volume rm "$PG_VOLUME" >/dev/null 2>&1 || true

say "Copying the database from $PEER_IP (this can take a few minutes)"
docker compose run --rm --no-deps --user postgres -e PGPASSWORD="$REPLICATION_PASSWORD" -e PEER_DB_PORT="${PEER_DB_PORT:-5432}" --entrypoint bash db -c \
  'pg_basebackup -h "$PEER_IP" -p "${PEER_DB_PORT:-5432}" -U replicator -D "$PGDATA" -X stream -R -S standby --checkpoint=fast -P'

say "Starting the database as a standby"
docker compose up -d db ops
wait_db
[ "$(db_sql 'select pg_is_in_recovery()')" = t ] || die "the database is not in standby mode"
say "Standby ready in $(elapsed). The health page on the primary shows the replication lag."
