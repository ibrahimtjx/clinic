#!/bin/bash
# Patient images and documents (SPEC 15.2 "Files"): each new file is encrypted onto the backup drive
# within a minute. Files are never changed or removed by the app, so copying new ones is enough.
source /ops/lib.sh
need_key || exit 1
[ -d /files ] || exit 0
mkdir -p "$BACKUP/files"
new=0
while IFS= read -r -d '' f; do
  rel=${f#/files/}
  out="$BACKUP/files/$rel.gpg"
  [ -f "$out" ] && continue
  mkdir -p "$(dirname "$out")"
  encrypt "$f" "$out.part" && mv "$out.part" "$out"
  new=$((new + 1))
done < <(find /files -type f ! -path '/files/tmp/*' ! -name '*.part' -print0)
[ "$new" -gt 0 ] && log "backed up $new patient file(s)"
exit 0
