# Handoff: migrations-backup

Branch `feat/nl-migrations`, based on `feat/nabalens-mvp` @ 3a23c9b.

The track owns `scripts/db/**`, `tests/migrations/**` and `docs/backup-restore.md`, plus this
file. Nothing outside those paths was changed. There are no SQL, app, config or
`package.json` changes.

## Status: done (30 October 2026)

Both drills ran to completion on isolated local stacks:

- `nabalens-migrations`, ports 611xx;
- `nabalens-restore`, ports 612xx.

Both stacks are stopped with `--no-backup`. Full description: `docs/backup-restore.md`.

## Files

- `scripts/db/prepare-stack.mjs` creates an isolated workdir (own project_id, port block,
  Studio/Realtime/Mailpit/analytics/edge/vector off, optional `--no-migrations --no-seed`).
  It never edits `supabase/config.toml`.
- `scripts/db/lib/drill.ts` holds the shared helpers:
  - DEV FIXTURE media seeding with real objects through the real reserve/upload policy path;
  - magic-link token sign-in;
  - the access matrix;
  - snapshots.
- `scripts/db/backup-local.sh`, `restore-local.sh`, `storage-objects.ts`
  (export/import/verify), `seed-fixture-media.ts` and `verify-restore.ts`.
- `tests/migrations/`:
  - `run.mjs` runs the phases `db-reset <phase>`, `upgrade`, `reset` and `lint`;
  - `upgrade.test.ts`, `reset.test.ts`, `lint.test.ts`, `helpers.ts` and
    `vitest.config.ts`;
  - `later/20261101090000_test_only_additive.sql` is TEST ONLY and is copied into the
    temporary workdir only.

## Results (real output)

Migration safety (`node tests/migrations/run.mjs "$W" <phase>`):

- **`db-reset upgrade`** then **`upgrade`**: 7/7 passed.
  - All repo migrations were applied from empty.
  - 5 fixture assets and 1 avatar were seeded (12 objects). The access matrix had 48 checks:
    16 granted with matching sha256 and 32 denied.
  - `supabase migration up --local` applied the TEST-ONLY migration without a reset.
  - Afterwards, venues, profiles, media_assets, auth users, buckets, storage.objects,
    policies and grants were all unchanged. The access matrix was identical for live and new
    sessions, and the write paths still worked.
- **`db-reset reset`** then **`reset`**: 3/3 passed. The CLI log shows all 5 migrations
  applied in filename order. Compared with the first reset, the schema fingerprint,
  policies, grants, RLS, buckets and seed are identical, with no media and no TEST-ONLY
  table.
- **`lint`**: 3/3 passed.
  - `db lint --level warning --fail-on warning`: `{"results":[]}`.
  - `db diff --schema public,private`: `{"diff":"", "dropStatements":[]}` (pg-delta).

Backup and restore:

```
seeded 5 DEV FIXTURE assets and 1 avatar (12 objects)
(source control) 48 download checks, 16 granted with matching sha256, 32 denied as expected
backup: 3 storage policies, 5 migrations, exported 12 objects, 20 files
source stack stopped (--no-backup)
restore: migrations 20261029120000..20261029160000 identical; storage policies: 3 restored and identical
imported 12 objects; verified 12 objects: keys and sha256 match
verify-restore on the restored stack: signed in admin, staffA, staffB (magic-link token);
  48 download checks, 16 granted with matching sha256, 32 denied as expected
  admin 3 rows, staffA 2, staffB 2, anon 0 -> verified (exit 0)
restored buckets: avatars private 5242880 {image/webp}; media private 209715200; RLS on for all 3 public tables
```

Repo checks on the final tree:

- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm test`: 12 files, 102 passed.
- `pnpm build`: exit 0, all routes compiled.

The last code edit was type-only: snapshot row types in `drill.ts` and one `.every` callback in
`upgrade.test.ts`. That edit came after the stack runs above, and the stacks were not
re-run for it.

## Findings the next wave must know

1. **`supabase db dump` misses our storage policies.** `schema.sql` contains no
   `storage.objects` policies (`grep nabalens_media_select` returns 0 lines). A restore
   from a plain dump leaves the private buckets with no read or upload policies.
   `backup-local.sh` writes `storage-policies.sql` from `pg_policies`, and the restore
   checks it.
2. **No dump contains the `supabase_migrations` history.** The scripts dump it separately.
3. **Storage feature tables block the restore.** `storage.buckets_vectors` and
   `vector_indexes` are owned by `supabase_storage_admin`, so a `data.sql` that includes
   them fails on restore ("permission denied"). They are excluded together with the other
   unused storage feature tables, but only after the backup asserts that they are empty.
4. **Hosted backups do not include storage files.** Hosted daily/PITR backups do not
   contain object bytes. M6 must set up a separate object copy and must restore one hosted
   backup into a separate project (`docs/backup-restore.md`, "does NOT prove").
5. **`db reset` is slow under load.** Each `db reset` took 3.5 to 9 minutes with about 13
   local stacks running, so the suite is split into short phases.

## Open questions and not done

- No `package.json` script was added, because the contract assigns that file to no
  track. If wanted, the integrator could add
  `"test:migrations": "node tests/migrations/run.mjs"`.
- Not tested: a restored project followed by a further `supabase migration up`, hosted
  PITR, and scale (large videos).

## How to rerun

```sh
W=$(node scripts/db/prepare-stack.mjs --project nabalens-migrations --ports 611)
T=$(node scripts/db/prepare-stack.mjs --project nabalens-restore --ports 612 --no-migrations --no-seed)
supabase --workdir "$W" start
node tests/migrations/run.mjs "$W" db-reset upgrade && node tests/migrations/run.mjs "$W" upgrade
node tests/migrations/run.mjs "$W" db-reset reset && node tests/migrations/run.mjs "$W" reset
node tests/migrations/run.mjs "$W" lint
node tests/migrations/run.mjs "$W" db-reset upgrade        # fresh seed for the drill
pnpm exec tsx scripts/db/seed-fixture-media.ts --workdir "$W" --out /tmp/nl-fixture.json
scripts/db/backup-local.sh "$W" /tmp/nl-backup
supabase --workdir "$W" stop --no-backup
supabase --workdir "$T" start
scripts/db/restore-local.sh /tmp/nl-backup "$T"
pnpm exec tsx scripts/db/verify-restore.ts --workdir "$T" --manifest /tmp/nl-fixture.json
supabase --workdir "$T" stop --no-backup
```
