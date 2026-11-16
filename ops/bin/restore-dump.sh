#!/bin/bash
# Inside the ops container: decrypt a nightly dump and restore it over the current database.
source /ops/lib.sh
need_key
f=$1; [ -f "$f" ] || f=$(ls "$BACKUP"/dumps/*/"$1" 2>/dev/null | head -1)
[ -f "$f" ] || { log "not found: $1"; exit 1; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
decrypt "$f" "$tmp/clinic.dump"
psql -h db -d postgres -X -q -c "drop database if exists \"$PGDATABASE\" with (force)" -c "create database \"$PGDATABASE\""
pg_restore -h db -d "$PGDATABASE" --no-owner --exit-on-error "$tmp/clinic.dump"
log "restored $f"
