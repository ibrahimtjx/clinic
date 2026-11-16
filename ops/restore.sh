#!/bin/bash
# Restore from the backup drive (SPEC 15.2), e.g. when both servers are lost.
#   ./ops/restore.sh list
#   ./ops/restore.sh dump clinic-20261116-0200.dump.gpg          # a nightly backup
#   ./ops/restore.sh pitr base-20261113-0200.tar.gpg "2026-11-16 10:45:00"   # to a point in time
source "$(dirname "$0")/common.sh"
cmd=${1:-list}
case "$cmd" in
  list)
    docker compose run --rm --no-deps --entrypoint bash ops -c 'ls -lh /backup/dumps/daily /backup/dumps/weekly /backup/base 2>/dev/null; echo; ls /backup/wal 2>/dev/null | tail -3'
    ;;
  dump)
    file=${2:?which dump file}
    confirm "This REPLACES the current database with $file."
    docker compose stop proxy api web ops >/dev/null 2>&1 || true
    docker compose up -d db
    wait_db
    docker compose run --rm --no-deps --entrypoint /ops/restore-dump.sh ops "$file"
    docker compose up -d
    wait_https
    say "Restored $file in $(elapsed)."
    ;;
  pitr)
    base=${2:?which base backup}
    target=${3:-}
    confirm "This REPLACES the current database with $base${target:+ replayed to $target}."
    docker compose down --remove-orphans
    docker compose run --rm --no-deps --user root -v "$PG_VOLUME":/pgdata --entrypoint /ops/restore-pitr.sh ops "$base" "$target"
    docker compose up -d db
    wait_db
    say "Replaying archived WAL…"
    for _ in $(seq 1 300); do [ "$(db_sql 'select pg_is_in_recovery()' 2>/dev/null)" = f ] && break; sleep 2; done
    [ "$(db_sql 'select pg_is_in_recovery()')" = f ] || die "recovery did not finish (docker compose logs db)"
    docker compose run --rm --no-deps --user root --entrypoint rm ops -rf /wal-staging/restore
    docker compose up -d
    wait_https
    say "Restored to ${target:-the end of the archive} in $(elapsed)."
    ;;
  *) die "use: list | dump FILE | pitr BASE [TIME]" ;;
esac
