#!/bin/bash
# Roles the second server uses: replicator (streaming replication) and clinic_monitor (heartbeat).
source /ops/lib.sh
[ -n "${REPLICATION_PASSWORD:-}" ] || { log "REPLICATION_PASSWORD not set; standby roles skipped"; exit 0; }
local_psql <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'replicator') then
    create role replicator with replication login;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'clinic_monitor') then
    create role clinic_monitor with login;
  end if;
end \$\$;
alter role replicator password '${REPLICATION_PASSWORD//\'/\'\'}';
alter role clinic_monitor password '${MONITOR_PASSWORD//\'/\'\'}';
grant select, insert, update on system_status to clinic_monitor;
select pg_create_physical_replication_slot('standby')
  where not exists (select 1 from pg_replication_slots where slot_name = 'standby');
SQL
