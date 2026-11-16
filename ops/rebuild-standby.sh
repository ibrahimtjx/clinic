#!/bin/bash
# After a failover: turn the repaired old primary into the standby of the new primary (SPEC 15.3 step 5).
# PEER_IP in .env already points to the other server, which is now the primary.
source "$(dirname "$0")/common.sh"
release_service_ip
exec "$(dirname "$0")/setup-standby.sh"
