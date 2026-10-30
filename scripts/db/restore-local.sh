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
# Steps, database in ONE transaction: verify SHA256SUMS -> roles.sql -> remove
# blank-template schema-local extra default grants ->
# schema.sql -> migrations-schema.sql -> storage-policies.sql -> data.sql and
# migrations-data.sql with triggers off (session_replication_role = replica, as
# the Supabase restore guide does) -> compare exact app/default ACLs, migration history and storage
# policies with the backup -> upload storage objects through the Storage API ->
# verify keys and sha256 -> restore/compare app-owned managed-table triggers.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <backup-dir> <fresh-supabase-workdir>" >&2
  exit 2
fi
backup=$(cd "$1" && pwd)
workdir=$(cd "$2" && pwd)
repo=$(cd "$(dirname "$0")/../.." && pwd)

# Older backups omit the security-hardening trigger. Refuse them before touching
# the target, rather than claiming a complete restore with its guard missing.
for artifact in managed-triggers.sql app-acls.json; do
  if [[ ! -f "$backup/$artifact" ]] ||
    ! grep -Fq "  ./$artifact" "$backup/SHA256SUMS"; then
    echo "Backup has no checksummed $artifact; make a new backup." >&2
    exit 1
  fi
done

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

database_restored=0
managed_triggers_restored=0
restore_managed_triggers() {
  if ! psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction \
    --file "$backup/managed-triggers.sql" >/dev/null; then
    return 1
  fi
  managed_triggers_restored=1
}
finish() {
  local exit_status=$?
  trap - EXIT
  # Importing ready/deleted originals intentionally precedes the original-write
  # guard. Never leave a normally failed import without attempting to install it.
  if [[ $database_restored == 1 && $managed_triggers_restored != 1 ]]; then
    if ! restore_managed_triggers; then
      echo "Could not restore managed-table triggers; target is not usable." >&2
      exit_status=1
    fi
  fi
  exit "$exit_status"
}
trap finish EXIT
trap 'exit 130' INT TERM

echo "== restoring database"
psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction \
  --file "$backup/roles.sql" \
  --file "$repo/scripts/db/reset-restore-defaults.sql" \
  --file "$backup/schema.sql" \
  --file "$backup/migrations-schema.sql" \
  --file "$backup/storage-policies.sql" \
  --command "set session_replication_role = replica" \
  --file "$backup/data.sql" \
  --file "$backup/migrations-data.sql" >/dev/null
database_restored=1

acls=$(psql "$db_url" -X -q -A -t -v ON_ERROR_STOP=1 \
  -f "$repo/scripts/db/app-acls.sql")
if [[ "$acls" != "$(cat "$backup/app-acls.json")" ]]; then
  echo "App/default privileges differ from the backup after restore; target is not usable." >&2
  exit 1
fi
echo "   schema, object, column and default privileges match"

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

echo "== restoring managed-table triggers"
restore_managed_triggers
triggers=$(psql "$db_url" -X -q -A -t -v ON_ERROR_STOP=1 \
  -f "$repo/scripts/db/managed-triggers.sql")
if [[ "$triggers" != "$(cat "$backup/managed-triggers.sql")" ]]; then
  echo "Managed-table triggers differ from the backup after restore." >&2
  exit 1
fi
echo "   managed-table trigger definitions and enabled states match"
echo "== restore complete"
