# Handoff: migrations-backup

Branch `feat/nl-migrations` (base `feat/nabalens-mvp` @ 3a23c9b). Owns `scripts/db/**`,
`tests/migrations/**`, `docs/backup-restore.md` (plus this file).

## Goal

1. Migration safety on an isolated stack: migrations in order from empty, DEV FIXTURE
   users + real media objects, a TEST-ONLY later additive migration via
   `supabase migration up`, rows/objects/policies survive; `db reset` idempotent;
   `db lint` clean.
2. Local backup/restore drill: `scripts/db/backup-local.sh`, `restore-local.sh`,
   fresh stack, staff signs in and sees media, admin downloads identical bytes.

## Done

- `scripts/db/prepare-stack.mjs` (isolated, trimmed workdir; never edits supabase/config.toml)
- `scripts/db/lib/drill.ts` (fixture seeding, access matrix, snapshots)
- `tests/migrations/{run.mjs,vitest.config.ts,upgrade.test.ts,later/*.sql}`
- Drafts: `scripts/db/{backup-local.sh,restore-local.sh,storage-objects.ts,seed-fixture-media.ts,verify-restore.ts}`

## In progress / next steps

- First run of `node tests/migrations/run.mjs "$W"` (slow: machine load ~28).
- Experiment: does `supabase db dump --local` schema.sql include storage policies and
  `supabase_migrations`? Adjust restore-local.sh accordingly.
- Run the drill end to end, write docs/backup-restore.md, final checks.

## Stacks

- `nabalens-migrations` 611xx: `W=$(node scripts/db/prepare-stack.mjs --project nabalens-migrations --ports 611)`
- `nabalens-restore` 612xx: `T=$(node scripts/db/prepare-stack.mjs --project nabalens-restore --ports 612 --no-migrations --no-seed)`
- Stop with `supabase --workdir <dir> stop --no-backup`.
