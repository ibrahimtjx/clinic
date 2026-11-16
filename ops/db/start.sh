#!/bin/sh
# PostgreSQL start for the clinic (SPEC 15.2). Same file on the primary and the standby:
# a standby is simply a data directory with standby.signal (made by setup-standby.sh).
set -e

# Who may connect: the app containers (Docker network), and, when a second server is set up,
# that server for replication and for its health heartbeat. Everything needs a password.
cat > /tmp/pg_hba.conf <<HBA
local   all          all                          trust
host    all          all          127.0.0.1/32    scram-sha-256
host    all          all          ::1/128         scram-sha-256
host    all          all          samenet         scram-sha-256
host    replication  all          samenet         scram-sha-256
HBA
if [ -n "$PEER_IP" ]; then
  peer=${PEER_HBA:-$PEER_IP/32}   # PEER_HBA: a network range, only if the peer's address varies
  cat >> /tmp/pg_hba.conf <<HBA
host    replication  replicator   $peer     scram-sha-256
host    all          clinic_monitor $peer   scram-sha-256
HBA
fi

# PostgreSQL (user postgres) hands WAL to the ops container through this shared folder.
mkdir -p /wal-staging && chown postgres:postgres /wal-staging

exec docker-entrypoint.sh postgres \
  -c hba_file=/tmp/pg_hba.conf \
  -c wal_level=replica \
  -c max_wal_senders=5 \
  -c max_replication_slots=5 \
  -c max_slot_wal_keep_size=10GB \
  -c hot_standby=on \
  -c archive_mode=on \
  -c archive_timeout=300 \
  -c "archive_command=test ! -f /wal-staging/%f && cp %p /wal-staging/%f.part && mv /wal-staging/%f.part /wal-staging/%f" \
  -c "restore_command=cp /wal-staging/restore/%f %p"
