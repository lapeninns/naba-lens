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
#   schema.sql             app schemas (supabase db dump). Supabase-managed schemas
#                          (auth, storage, supabase_migrations, ...) are NOT in it.
#   storage-policies.sql   CREATE POLICY statements for storage.* tables, generated
#                          from pg_policies: schema.sql omits them, and without them
#                          the private buckets would have no read/upload policies
#   migrations-schema.sql  supabase_migrations schema and
#   migrations-data.sql    its rows: the applied migration history
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
supabase --workdir "$workdir" db dump --local --schema supabase_migrations \
  -f "$out/migrations-schema.sql"
supabase --workdir "$workdir" db dump --local --data-only --schema supabase_migrations \
  -f "$out/migrations-data.sql"
psql "$db_url" -X -A -t -v ON_ERROR_STOP=1 -c \
  "select version from supabase_migrations.schema_migrations order by version" \
  >"$out/migrations.txt"
psql "$db_url" -X -A -t -v ON_ERROR_STOP=1 -c "
  select format('create policy %I on %I.%I as %s for %s to %s%s%s;',
    policyname, schemaname, tablename, permissive, cmd,
    (select string_agg(quote_ident(r), ', ') from unnest(roles) r),
    ' using (' || qual || ')', ' with check (' || with_check || ')')
  from pg_policies where schemaname = 'storage'
  order by tablename, policyname" >"$out/storage-policies.sql"
echo "   $(grep -c . "$out/storage-policies.sql") storage policies, $(grep -c . "$out/migrations.txt") migrations"

echo "== copying storage objects"
(cd "$repo" && pnpm exec tsx scripts/db/storage-objects.ts export \
  --workdir "$workdir" --out "$out/storage")

(cd "$out" && find . -type f ! -name SHA256SUMS -print0 | sort -z |
  xargs -0 shasum -a 256 >SHA256SUMS)
echo "== backup written to $out ($(wc -l <"$out/SHA256SUMS" | tr -d ' ') files)"
