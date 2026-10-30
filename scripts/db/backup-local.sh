#!/usr/bin/env bash
# Logical backup of a LOCAL Supabase stack: database (roles, schema, data incl.
# auth and storage metadata) plus a byte copy of every Storage object.
# See docs/backup-restore.md for what this does and does not prove for hosted
# Supabase.
#
#   scripts/db/backup-local.sh <supabase-workdir> <backup-dir>
#
# Layout of <backup-dir>:
#   roles.sql              cluster roles (supabase db dump --role-only)
#   schema.sql             app schemas (supabase db dump; Supabase-managed schemas excluded)
#   data.sql               all data incl. auth.* and storage.buckets (COPY), except
#                          storage.objects, which the object import recreates
#   migrations.txt         applied migration versions at backup time
#   storage/manifest.json  bucket, key, content type, size, sha256 per object
#   storage/objects/...    object bytes
#   SHA256SUMS             checksums of everything above
#
# Read-only against the source stack. Prints no keys or passwords.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <supabase-workdir> <backup-dir>" >&2
  exit 2
fi
workdir=$(cd "$1" && pwd)
out=$2
repo=$(cd "$(dirname "$0")/../.." && pwd)

if [[ -e "$out" && -n "$(ls -A "$out" 2>/dev/null)" ]]; then
  echo "Refusing to write into non-empty $out" >&2
  exit 1
fi
mkdir -p "$out"
out=$(cd "$out" && pwd)

status=$(supabase --workdir "$workdir" status -o json 2>/dev/null)
db_url=$(sed -n '/^{/,/^}/p' <<<"$status" | jq -r '.DB_URL')
case "$db_url" in
  postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;;
  *) echo "Not a local stack; refusing." >&2; exit 1 ;;
esac

echo "== dumping database from $workdir"
supabase --workdir "$workdir" db dump --local --role-only -f "$out/roles.sql"
supabase --workdir "$workdir" db dump --local -f "$out/schema.sql"
supabase --workdir "$workdir" db dump --local --data-only --use-copy \
  -x storage.objects -f "$out/data.sql"
psql "$db_url" -X -A -t -c \
  "select version from supabase_migrations.schema_migrations order by version" \
  >"$out/migrations.txt"

echo "== copying storage objects"
(cd "$repo" && pnpm exec tsx scripts/db/storage-objects.ts export \
  --workdir "$workdir" --out "$out/storage")

(cd "$out" && find . -type f ! -name SHA256SUMS -print0 | sort -z |
  xargs -0 shasum -a 256 >SHA256SUMS)
echo "== backup written to $out ($(wc -l <"$out/SHA256SUMS" | tr -d ' ') files)"
