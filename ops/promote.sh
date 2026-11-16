#!/bin/bash
# Failover (SPEC 15.3): make THIS standby the primary and start the clinic system here.
#   ./ops/promote.sh            (asks for confirmation; YES=1 to skip; FORCE=1 if the old primary still answers)
source "$(dirname "$0")/common.sh"

say "Checking this PC is a standby"
docker compose up -d db
wait_db
[ "$(db_sql 'select pg_is_in_recovery()')" = t ] || die "this PC's database is already a primary"

if [ -n "${PEER_IP:-}" ] && docker compose exec -T db pg_isready -q -h "$PEER_IP" -p "${PEER_DB_PORT:-5432}" -t 3; then
  [ "${FORCE:-}" = 1 ] || die "the primary at $PEER_IP still answers. If it is really broken, shut it down (or unplug its network cable) and run again, or FORCE=1."
fi
confirm "Promote this PC to PRIMARY. The old primary must stay off until rebuild-standby.sh is run on it."

say "Promoting the database"
[ "$(db_sql 'select pg_promote(true, 60)')" = t ] || die "promotion failed (docker compose logs db)"
take_service_ip
# Images and documents are not replicated by PostgreSQL: bring the latest from the backup drive.
restore_files || say "WARNING: patient files could not be restored from the backup drive; see docs/failover.md"

say "Starting the clinic system"
docker compose up -d
wait_https
say "Done in $(elapsed). Open Settings → System health, check it is green, then tell staff."
