#!/bin/bash
# Encrypt WAL files PostgreSQL archived to the staging area and move them to the backup drive.
# PostgreSQL closes a WAL file at least every 5 minutes (archive_timeout), so the RPO stays under 15.
source /ops/lib.sh
need_key || exit 1
mkdir -p "$BACKUP/wal"
shipped=0
shopt -s nullglob
for f in "$STAGING"/0*; do
  case "$f" in *.part) continue ;; esac
  name=$(basename "$f")
  if [ ! -f "$BACKUP/wal/$name.gpg" ]; then
    encrypt "$f" "$BACKUP/wal/$name.gpg.part"
    mv "$BACKUP/wal/$name.gpg.part" "$BACKUP/wal/$name.gpg"
  fi
  rm -f "$f"
  shipped=$((shipped + 1))
done
if [ "$shipped" -gt 0 ]; then
  set_status "last_wal_at = now()"
  log "shipped $shipped WAL file(s)"
fi
