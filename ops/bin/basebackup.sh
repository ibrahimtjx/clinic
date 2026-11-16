#!/bin/bash
# Weekly base backup for point-in-time restore (with the archived WAL). Keeps 2; WAL older than the
# oldest kept base backup is removed.
source /ops/lib.sh
need_key || exit 1
mkdir -p "$BACKUP/base"
stamp=$(date +%Y%m%d-%H%M)
tmp=$(mktemp -d -p "$BACKUP")
trap 'rm -rf "$tmp"' EXIT
pg_basebackup -h db -D "$tmp/base" -Ft -z -X fetch --checkpoint=fast -l "clinic-$stamp"
tar -C "$tmp/base" -cf "$tmp/base.tar" .
out="$BACKUP/base/base-$stamp.tar.gpg"
encrypt "$tmp/base.tar" "$out.part"
mv "$out.part" "$out"
ls -1t "$BACKUP"/base/base-*.tar.gpg | tail -n +3 | xargs -r rm -f || true  # nothing to prune is fine
oldest=$(ls -1t "$BACKUP"/base/base-*.tar.gpg | tail -n 1)
# Keep a day of margin before the oldest base backup.
find "$BACKUP/wal" -name '*.gpg' ! -newer "$oldest" -mmin +1440 -delete 2>/dev/null || true
set_status "last_error = null, last_basebackup_at = now()"
log "base backup $out"
