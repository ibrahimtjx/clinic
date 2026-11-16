#!/bin/bash
# Put patient files back from the backup drive into /files-rw (failover or restore). Existing files
# are kept; only missing ones are written.
source /ops/lib.sh
need_key
[ -d "$BACKUP/files" ] || { log "no patient files on the backup drive"; exit 0; }
restored=0
while IFS= read -r -d '' g; do
  rel=${g#"$BACKUP"/files/}
  rel=${rel%.gpg}
  dest="/files-rw/$rel"
  [ -f "$dest" ] && continue
  mkdir -p "$(dirname "$dest")"
  decrypt "$g" "$dest.part" && mv "$dest.part" "$dest"
  restored=$((restored + 1))
done < <(find "$BACKUP/files" -type f -name '*.gpg' -print0)
log "restored $restored patient file(s)"
