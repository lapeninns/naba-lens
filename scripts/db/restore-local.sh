#!/usr/bin/env bash
# Restores a backup made by scripts/db/backup-local.sh into a FRESH, isolated
# LOCAL stack, then verifies the object bytes. See docs/backup-restore.md.
#
#   T=$(node scripts/db/prepare-stack.mjs --project nabalens-restore --ports 612 --no-migrations --no-seed)
#   supabase --workdir "$T" start
#   scripts/db/restore-local.sh <backup-dir> "$T"
#
# The target must be a blank project: started with no migrations and no seed, so
# that it looks like a newly created hosted project (Supabase-managed auth and
# storage schemas only). The script refuses a target that already has app tables,
# auth users or storage objects, and refuses the default 554xx stack.
#
# Steps, database in ONE transaction: verify SHA256SUMS -> roles.sql ->
# schema.sql -> migrations-schema.sql -> storage-policies.sql -> data.sql and
# migrations-data.sql with triggers off (session_replication_role = replica, as
# the Supabase restore guide does) -> compare migration history and storage
# policies with the backup -> upload storage objects through the Storage API ->
# verify keys and sha256.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <backup-dir> <fresh-supabase-workdir>" >&2
  exit 2
fi
backup=$(cd "$1" && pwd)
workdir=$(cd "$2" && pwd)
repo=$(cd "$(dirname "$0")/../.." && pwd)

echo "== checking backup integrity"
(cd "$backup" && shasum -a 256 -c --quiet SHA256SUMS)

status=$(supabase --workdir "$workdir" status -o json 2>/dev/null)
db_url=$(sed -n '/^{/,/^}/p' <<<"$status" | jq -r '.DB_URL')
case "$db_url" in
  postgresql://*@127.0.0.1:554*|postgresql://*@localhost:554*)
    echo "Refusing to restore into the default 554xx stack." >&2; exit 1 ;;
  postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;;
  *) echo "Not a local stack; refusing." >&2; exit 1 ;;
esac

q() { psql "$db_url" -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }
existing=$(q "select (select count(*) from pg_tables where schemaname = 'public')
  + (select count(*) from auth.users) + (select count(*) from storage.objects)")
if [[ "$existing" != "0" ]]; then
  echo "Target is not blank ($existing app tables/users/objects); refusing." >&2
  exit 1
fi

echo "== restoring database"
psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction \
  --file "$backup/roles.sql" \
  --file "$backup/schema.sql" \
  --file "$backup/migrations-schema.sql" \
  --file "$backup/storage-policies.sql" \
  --command "set session_replication_role = replica" \
  --file "$backup/data.sql" \
  --file "$backup/migrations-data.sql" >/dev/null

restored=$(q "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations")
expected=$(paste -sd, "$backup/migrations.txt")
if [[ "$restored" != "$expected" ]]; then
  echo "Migration history differs after restore: $restored vs $expected" >&2
  exit 1
fi

policies=$(psql "$db_url" -X -A -t -v ON_ERROR_STOP=1 -c "
  select format('create policy %I on %I.%I as %s for %s to %s%s%s;',
    policyname, schemaname, tablename, permissive, cmd,
    (select string_agg(quote_ident(r), ', ') from unnest(roles) r),
    ' using (' || qual || ')', ' with check (' || with_check || ')')
  from pg_policies where schemaname = 'storage'
  order by tablename, policyname")
if [[ "$policies" != "$(cat "$backup/storage-policies.sql")" ]]; then
  echo "Storage policies differ from the backup after restore." >&2
  exit 1
fi
echo "   migrations: $restored"
echo "   storage policies: $(grep -c . <<<"$policies") restored and identical"

echo "== restoring storage objects"
(cd "$repo" && pnpm exec tsx scripts/db/storage-objects.ts import \
  --workdir "$workdir" --from "$backup/storage")
echo "== restore complete"
