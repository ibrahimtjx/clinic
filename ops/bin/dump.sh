#!/bin/bash
# Nightly full backup (SPEC 15.2): pg_dump, encrypted, 14 daily and 8 weekly copies kept.
source /ops/lib.sh
need_key || exit 1
mkdir -p "$BACKUP/dumps/daily" "$BACKUP/dumps/weekly"
stamp=$(date +%Y%m%d-%H%M)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
pg_dump -h db -Fc -Z 6 -f "$tmp/clinic.dump"
out="$BACKUP/dumps/daily/clinic-$stamp.dump.gpg"
encrypt "$tmp/clinic.dump" "$out.part"
mv "$out.part" "$out"
size=$(stat -c %s "$out")
if [ "$(date +%u)" = 5 ]; then # Friday: keep a weekly copy
  cp "$out" "$BACKUP/dumps/weekly/"
fi
ls -1t "$BACKUP"/dumps/daily/*.dump.gpg 2>/dev/null | tail -n +15 | xargs -r rm -f || true  # nothing to prune is fine
ls -1t "$BACKUP"/dumps/weekly/*.dump.gpg 2>/dev/null | tail -n +9 | xargs -r rm -f || true  # nothing to prune is fine
# The clinic CA (Caddy) too: needed to rebuild a server the PCs already trust.
if [ -d /caddy/caddy/pki ]; then
  mkdir -p "$BACKUP/ca"
  tar -C /caddy/caddy -cf "$tmp/pki.tar" pki
  encrypt "$tmp/pki.tar" "$BACKUP/ca/caddy-pki-$stamp.tar.gpg"
  ls -1t "$BACKUP"/ca/*.tar.gpg | tail -n +4 | xargs -r rm -f || true
fi
set_status "last_error = null, last_dump_at = now(), last_dump_bytes = $size, last_dump_file = '$(basename "$out")'"
log "dump $out ($size bytes)"
