// Migration-safety suite. Needs an isolated stack created by
// scripts/db/prepare-stack.mjs (never the default 554xx stack):
//
//   W=$(node scripts/db/prepare-stack.mjs --project nabalens-migrations --ports 611)
//   supabase --workdir "$W" start
//   pnpm test:migrations "$W"
//   supabase --workdir "$W" stop --no-backup
//
// The suite resets that stack's database several times.
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const workdir = process.argv[2]
if (!workdir)
  throw new Error("Usage: node tests/migrations/run.mjs <isolated Supabase workdir>")
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "tests/migrations/vitest.config.ts",
    ...process.argv.slice(3),
  ],
  {
    stdio: "inherit",
    env: { ...process.env, NABALENS_DRILL_WORKDIR: resolve(workdir) },
  }
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
