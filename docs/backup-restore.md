# Migration safety and backup/restore (local drills)

This document covers two drills. Both run only against isolated **local** Supabase stacks:

1. **Migration safety.** The repo migrations apply in order to an empty database. A later,
   compatible migration keeps every retained row, storage object and policy.
   `supabase db reset` gives the same database every time, and `supabase db lint` is clean.
2. **Backup and restore.** A logical dump of the database plus a copy of every storage
   object is restored into a fresh stack. After the restore, staff can sign in and see their
   media rows, direct Storage access remains denied, and service-role reads prove
   byte-identical restored objects.

Neither drill touches a hosted project. The scripts refuse any URL that is not
`127.0.0.1`/`localhost`. Restores also refuse the default `554xx` stack and any target that
is not blank.

## Isolated stacks

`scripts/db/prepare-stack.mjs` copies `supabase/` into a temporary workdir. The copy gets its
own `project_id`, and every `554xx` port is moved to `<ports>xx`. Studio, Realtime, Mailpit,
analytics, the edge runtime and vector buckets are disabled to reduce machine load. The
checked-in `supabase/config.toml` is never modified.

```sh
W=$(node scripts/db/prepare-stack.mjs --project nabalens-migrations --ports 611)
T=$(node scripts/db/prepare-stack.mjs --project nabalens-restore --ports 612 --no-migrations --no-seed)
supabase --workdir "$W" start
supabase --workdir "$T" start           # a blank project: managed schemas only
...
supabase --workdir "$W" stop --no-backup
supabase --workdir "$T" stop --no-backup
```

Signing in uses the real magic-link token path: the service role generates a link and
`verifyOtp({ token_hash })` redeems it. This is the same path the app's `/auth/confirm` uses.
The DEV FIXTURE users from `supabase/seed.sql` have no passwords.

## 1. Migration safety (`tests/migrations`)

```sh
node tests/migrations/run.mjs "$W" db-reset upgrade   # supabase db reset, output kept
node tests/migrations/run.mjs "$W" upgrade
node tests/migrations/run.mjs "$W" db-reset reset
node tests/migrations/run.mjs "$W" reset
node tests/migrations/run.mjs "$W" lint
```

The resets are separate commands because each one recreates the database container. On a
loaded machine, one reset can take several minutes.

- **`upgrade`** (`tests/migrations/upgrade.test.ts`), on a freshly reset database:
  - The applied history equals the repo's `supabase/migrations`, and there is no media yet.
    The test saves a baseline snapshot and schema fingerprint for the `reset` phase.
  - It seeds DEV FIXTURE media with real objects (`scripts/db/lib/drill.ts`
    `seedFixtureMedia`). Staff reserve assets through `reserve_media_asset` and upload
    originals as themselves through the reserved-key storage policy. The service role writes
    derivatives and moves assets to `ready`, as the app does. The seed contains:
    - Staff A: a ready photo (original, preview and thumb), a ready MP4, a photo they deleted
      (tombstone), and an avatar.
    - Staff B: a ready photo and an unfinished (`uploading`) photo whose original is uploaded.

    That is 12 objects in total.

  - It records the access matrix: for each of admin, Staff A, Staff B and anon, every
    object's download result (sha256 or denied) and every visible `media_assets` row. Each
    entry is checked against the rules: owners and admins read ready media, and nobody reads
    deleted or unfinished media. Since the security hardening (`20261030100000`), no end user reads
    Storage directly, so all 48 direct downloads are denied; byte integrity is proven with the
    service role instead (`storedObjectShas`).
  - It copies the **TEST-ONLY** migration
    `tests/migrations/later/20261101090000_test_only_additive.sql` into the workdir. The
    migration is never committed to `supabase/migrations`. It applies with
    `supabase migration up --local` (no reset). It adds:
    - a nullable column with a check constraint and a partial index;
    - a `not null default 0` column on `venues`;
    - a new table that revokes anon/authenticated grants and enables RLS;
    - an unchanged redeploy (`create or replace`) of the storage policy helper
      `private.can_read_media_object`.
  - After the migration, these are byte-for-byte equal to before: venues, profiles,
    media_assets (all pre-existing columns), auth users, buckets, `storage.objects`, every
    `public`/`storage` policy and every anon/authenticated grant. Every public table still
    has RLS on.
  - The access matrix is identical both for sessions opened **before** the migration and for
    new sign-ins. Write paths still work: reserve plus owner upload succeeds, another staff
    member's upload to the same folder is denied, and staff still have no update grant on
    `media_assets`.
- **`reset`** (`reset.test.ts`) resets the seeded and upgraded database again. The CLI log
  shows every repo migration applied in filename order. The result matches the first reset
  exactly:
  - the same schema fingerprint (functions, columns, constraints, indexes, policies,
    triggers, grants) and the same policies, RLS flags and buckets;
  - the same seed rows (timestamps aside);
  - no media rows, no `storage.objects` rows and no TEST-ONLY table.
- **`lint`** (`lint.test.ts`) runs `supabase db lint --local --schema public,private --level
warning --fail-on warning` and `supabase db diff --local --schema public,private`. Lint
  must report no schema errors, and the diff between the migrations and the database must
  be empty.

**Note on `db reset` and storage.** A local reset recreates the database. Every
`storage.objects` row is gone afterwards, but the files can remain in the storage
container's volume as orphans. `db reset` is a development tool. Never point it at data you
need.

## 2. Backup and restore (`scripts/db/backup-local.sh`, `restore-local.sh`)

```sh
pnpm exec tsx scripts/db/seed-fixture-media.ts --workdir "$W" --out /tmp/nl-fixture.json  # DEV FIXTURE media
scripts/db/backup-local.sh "$W" /tmp/nl-backup
supabase --workdir "$W" stop --no-backup                  # the source is gone
scripts/db/restore-local.sh /tmp/nl-backup "$T"           # $T: blank stack, see above
pnpm exec tsx scripts/db/storage-objects.ts verify --workdir "$T" --from /tmp/nl-backup/storage
pnpm exec tsx scripts/db/verify-restore.ts --workdir "$T" --manifest /tmp/nl-fixture.json
```

### What the backup contains

| File                                           | Made by                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roles.sql`                                    | `supabase db dump --role-only`                                                                                                                                  |
| `schema.sql`                                   | `supabase db dump` (app schemas `public`, `private`; Supabase-managed schemas are excluded)                                                                     |
| `storage-policies.sql`                         | `CREATE POLICY` statements for `storage.*`, generated from `pg_policies`                                                                                        |
| `managed-triggers.sql`                        | App-owned triggers on managed `auth`/`storage` tables, including definitions and enabled states; their `public`/`private` functions are in `schema.sql`           |
| `app-acls.json`                               | Normalized schema, table, column, sequence, function, type and default ACLs, with role/object names instead of cluster-specific OIDs                               |
| `migrations-schema.sql`, `migrations-data.sql` | `supabase db dump [--data-only] --schema supabase_migrations`, the applied migration history                                                                    |
| `data.sql`                                     | `supabase db dump --data-only --use-copy -x storage.objects`: app data, `auth.*` (users, identities, sessions), `storage.buckets`, `private.maintenance_leases` |
| `migrations.txt`                               | applied versions, compared after the restore                                                                                                                    |
| `storage/manifest.json`, `storage/objects/**`  | every object, downloaded through the Storage API with the service role: bucket, key, content type, size, sha256                                                 |
| `SHA256SUMS`                                   | checksums of all of the above, verified before the restore                                                                                                      |

Four gaps in a plain `supabase db dump` are handled by the scripts:

- **`schema.sql` has no policies on `storage.objects`.** The CLI skips the managed
  `storage` schema, including the policies our migrations add to it. A database restored
  from `schema.sql` alone has private buckets with **no read or upload policies**, so every
  end-user download is denied. Hence `storage-policies.sql`, and the restore checks that the
  restored storage policies equal the backup's.
- **Neither dump includes `supabase_migrations`.** Without it, the restored project has no
  migration history, and the next `supabase migration up` would try to re-run every
  migration. Hence the two `migrations-*.sql` files, and the restore checks the history
  against `migrations.txt`.
- **`schema.sql` omits app triggers on managed tables.** The security-hardening migration
  adds `nabalens_guard_media_original_write` to `storage.objects`. Its function is dumped
  from `private`, but the trigger itself is excluded with the managed table. The shared
  `scripts/db/managed-triggers.sql` query exports app-owned triggers on managed tables and
  their enabled states. It refuses a source where the hardening migration is applied but
  its enabled original-write guard is missing.
- **A blank Supabase template has broader creation defaults than plain PostgreSQL.**
  When a source object explicitly revoked `anon`/`authenticated` privileges inherited
  from Supabase defaults, `pg_dump` can omit those revokes because its normal restore
  assumption has no such grants. On a fresh Supabase target those default grants would
  be inherited again. Inside the restore transaction,
  `scripts/db/reset-restore-defaults.sql` removes the target restore role's schema-local
  extra defaults for app schemas before `schema.sql` creates app objects. The dump's
  trailing default-privilege statements restore source defaults for future objects.
  The restore then compares the complete named ACL inventory, including service-only
  functions and column privileges, and fails before object import on any drift.

Ordinary enabled triggers use `CREATE TRIGGER`'s default enabled state. This avoids
requesting ownership of the managed `storage.objects` table merely to issue an
unnecessary `ENABLE TRIGGER`. Nondefault disabled/replica/always states are exported
explicitly; a restore fails if its role cannot replay those owner-level changes.

The managed-trigger query covers triggers whose functions live in the dumped `public`
or `private` schemas. If a future migration creates app functions inside `auth` or
`storage`, those functions also fall outside `schema.sql`; extend the backup before using
such a migration and re-run this drill.

### What the restore does

The target must be **blank**: started with no migrations and no seed, as a newly created
hosted project would be. The script refuses a target that already has public tables, auth
users or storage objects.

1. It requires checksummed `managed-triggers.sql` and `app-acls.json`, then checks
   `SHA256SUMS`. Older backups missing either file are refused before touching the target;
   create a new backup.
2. In **one transaction** (`psql --single-transaction`, `ON_ERROR_STOP`) it loads
   `roles.sql`, neutralizes schema-local creation defaults, loads `schema.sql`,
   `migrations-schema.sql` and `storage-policies.sql`, then sets
   `session_replication_role = replica` and loads `data.sql` and `migrations-data.sql`.
   With that setting, the app's guard triggers do not re-validate restored rows. This
   follows the Supabase restore guide.
3. It compares the app/default ACLs, migration history and storage policies with the
   backup and fails if any differs. A restore whose role/default setup differs from the
   source is not accepted merely because RLS still hides its rows.
4. It uploads every object through the Storage API (service role, `upsert: false`) to the
   same bucket and key with the recorded content type. It then downloads each one and checks
   its sha256, and checks that `storage.objects` holds exactly the manifest's keys.
5. It restores the app-owned managed-table triggers and their enabled states, then compares
   them exactly with the backup. This follows object import because the original-write
   guard correctly rejects re-uploading originals whose restored records are already
   ready or deleted. An EXIT handler also attempts to install the triggers after a failed
   import; any failure still returns a nonzero exit. The fresh local target must not be
   used until the entire restore and verification succeed.

Afterwards, `verify-restore.ts` signs in each DEV FIXTURE user afresh. It then checks the
whole access matrix against the manifest written **before** the backup:

- Staff A and Staff B each see exactly their own non-deleted media rows. The admin sees
  every ready asset, and anon sees no media rows.
- All end-user direct Storage downloads are denied, including owners and admins. This
  preserves the security-hardening rule that reads must go through the application's
  authorization routes; those app routes are not part of this CLI drill.
- Service-role reads prove that every restored object's bytes match the saved hash.
- All public tables have RLS enabled. The restored original-write guard rejects a no-op
  update of a ready original with `media_reservation_closed` while allowing a live uploading
  reservation. The latter check is rolled back and does not change the restored object.

### What this proves, and what it does NOT prove for hosted Supabase

It proves:

- The logical dump plus object copy is **complete enough for Naba-Lens**. Auth users and
  identities, profiles, venue snapshots, tombstones, migration history, buckets, storage
  policies, app-owned managed-table triggers and object bytes all come back, and the
  tested security boundaries still hold after the restore.
- The managed-schema gaps above are real, and the scripts handle them.
- The restore procedure works against a blank Supabase project of the same CLI image
  versions.

It does **not** prove:

- **Hosted backups.** Supabase's daily backups and **PITR** (a paid add-on, with
  plan-dependent retention) are managed by the platform. Nothing here exercises them. Before
  release, confirm the plan's backup retention and whether PITR is enabled. Then do one
  restore of a hosted backup into a **separate** project, never over production, with owner
  approval (spec v0.2 §M6: "verify storage and database backup arrangements separately").
- **Storage files in hosted backups.** Supabase database backups (daily and PITR) contain
  `storage.objects` _metadata_ only, **not the files**. A database restore without a
  separate object copy gives rows that point at missing or stale files. Hosted media needs
  its own copy, for example a scheduled job like `storage-objects.ts export` using the
  service role or the S3-compatible endpoint, kept somewhere else. Its retention must match
  the organisation's policy. Note also that deleted media is physically removed by
  `prepare_media_cleanup`, so a later object copy will not contain it.
- **Version skew.** Here the source and target run the same Postgres 17 image, GoTrue and
  Storage versions. A hosted project on newer auth/storage schemas may need the dump made
  with a matching CLI.
- **Scale and timing.** The drill uses 12 small objects. Restore time, egress and
  API rate limits for real libraries (up to 200 MiB videos) are untested.
- **Secrets and config.** The JWT secret, API keys, SMTP, auth redirect URLs, the
  disabled-signup setting and bucket limits that live in project settings are not in a
  database dump. A restored hosted project must be configured again (see `README.md`).
  Sessions copied in `auth.sessions` are only valid if the JWT secret is the same.
- **Signed URLs and downloaded copies** made before a restore are not affected by it.
- **The default stack.** The drill never backs up or restores the shared `nabalens` stack
  (554xx).

## Results

### 30 October 2026: current managed-trigger restore drill

The isolated source included nine migrations, through
`20261030150000_media_original_archives.sql`, and the DEV FIXTURE seed. It was based on
`80777c0` plus that archive migration and the backup/restore patch. The source and fresh
target used separate local port blocks, 643xx and 644xx. The source was stopped after
backup; no hosted project was used.

- The original restore returned success with nine migration-history rows, 16 public tables
  with RLS and all 12 objects, but no `nabalens_guard_media_original_write` trigger. The
  updated verifier rejected that result. This reproduced the security gap.
- The first corrected attempt exposed an owner-only `ENABLE TRIGGER` on the managed
  table. Ordinary enabled triggers now rely on `CREATE TRIGGER`'s default enabled state;
  no ownership or privilege grant was added.
- A stricter archive receipt test then exposed fresh-template default grants being
  re-inherited by service-only tables and functions. The final restore neutralizes those
  schema-local defaults during object creation, then requires exact ACL parity. All 97
  normalized ACL inventory entries matched the source, including schema, column,
  sequence and service-only function permissions.
- A fresh source backup and fresh target restore then both passed. All nine migrations,
  the storage policy and managed-trigger definitions/enabled states matched the backup.
- All 12 stored objects were byte-identical. All 48 direct Storage requests by fixture
  admin, staff and anon were denied as required. Fresh magic-link sign-ins saw the
  expected media rows: admin 3, staff A 2, staff B 2, anon 0.
- The restored original-write guard rejected a ready original and permitted a live upload
  reservation; the latter check rolled back. All 16 public tables had RLS enabled.
- The same four archive security tests passed on the fresh source and corrected restored
  target. Anon/authenticated table access and RPC execution were denied, service receipt
  insertion and retry worked, invalid attribution was rejected, and service updates/deletes
  remained denied.
- Shell-control checks passed normal completion, import failure with guard finalization,
  trigger-install failure, deliberate ACL mismatch and refusal of old backups missing the
  checksummed artifacts. Bash syntax, typecheck and targeted ESLint passed. Both owned
  stacks were stopped after verification.

Earlier five-migration results remain in `docs/fanout/handoffs/migrations-backup.md` as
historical evidence. This local drill does not establish hosted backup/restore readiness.
