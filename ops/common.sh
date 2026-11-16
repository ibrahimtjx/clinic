#!/bin/bash
# Shared by the host scripts in ops/. Run them from anywhere; they work in the repository folder.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[ -f .env ] || { echo "No .env here. See docs/install.md." >&2; exit 1; }
set -a; source ./.env; set +a
PROJECT=$(docker compose config 2>/dev/null | awk '/^name:/ {print $2; exit}')
PG_VOLUME="${PROJECT}_pg_data"
START=$(date +%s)

say() { printf '\n== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
confirm() {
  [ "${YES:-}" = 1 ] && return 0
  read -r -p "$1 Type YES to continue: " answer
  [ "$answer" = YES ] || die "Cancelled."
}
elapsed() { echo "$(( ($(date +%s) - START) / 60 )) min $(( ($(date +%s) - START) % 60 )) s"; }
db_sql() { docker compose exec -T db psql -U "${POSTGRES_USER:-clinic}" -d "${POSTGRES_DB:-clinic}" -X -t -A -v ON_ERROR_STOP=1 -c "$1"; }
wait_db() {
  for _ in $(seq 1 60); do docker compose exec -T db pg_isready -q -U "${POSTGRES_USER:-clinic}" && return 0; sleep 2; done
  die "the database did not start (docker compose logs db)"
}
wait_https() {
  for _ in $(seq 1 60); do curl -skf "https://localhost:${HTTPS_PORT:-443}/api/health" >/dev/null && return 0; sleep 2; done
  die "the app did not answer on https://localhost/api/health (docker compose logs api proxy)"
}
release_service_ip() {
  if [ -n "${SERVICE_IP:-}" ] && ip -o addr show | grep -q " ${SERVICE_IP}/"; then
    say "Releasing the service address $SERVICE_IP"
    sudo ip addr del "$SERVICE_IP/${SERVICE_PREFIX:-24}" dev "${SERVICE_IFACE:?set SERVICE_IFACE in .env}"
  fi
}
take_service_ip() {
  [ -n "${SERVICE_IP:-}" ] || return 0
  if ! ip -o addr show | grep -q " ${SERVICE_IP}/"; then
    say "Taking over the service address $SERVICE_IP"
    sudo ip addr add "$SERVICE_IP/${SERVICE_PREFIX:-24}" dev "${SERVICE_IFACE:?set SERVICE_IFACE in .env}"
    # Tell the switch and the PCs that the address moved (if arping is installed).
    command -v arping >/dev/null && sudo arping -U -c 3 -I "$SERVICE_IFACE" "$SERVICE_IP" >/dev/null 2>&1 || true
  fi
}
