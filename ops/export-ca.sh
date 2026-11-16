#!/bin/bash
# Copy the clinic's certificate authority off the primary, to install it on the standby with
# import-ca.sh. Both servers must use the SAME CA or the PCs will not trust the standby.
# The file contains the CA's private key: move it by USB, then delete it.
source "$(dirname "$0")/common.sh"
docker compose cp proxy:/data/caddy/pki ./caddy-pki
tar -czf clinic-ca-export.tgz caddy-pki && rm -rf caddy-pki
say "Wrote clinic-ca-export.tgz. Copy it to the standby's clinic folder and run ./ops/import-ca.sh there."
