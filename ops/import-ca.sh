#!/bin/bash
# Install the clinic CA exported from the primary (export-ca.sh) or from a backup (backup drive /ca).
source "$(dirname "$0")/common.sh"
file=${1:-clinic-ca-export.tgz}
[ -f "$file" ] || die "no $file"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
tar -xzf "$file" -C "$tmp"
docker compose create proxy >/dev/null 2>&1 || true
docker compose cp "$tmp/caddy-pki/." proxy:/data/caddy/pki/
say "CA installed. It is used when the proxy starts (after promote.sh)."
