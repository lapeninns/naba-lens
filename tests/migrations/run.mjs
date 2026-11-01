// Migration-safety suite, in three phases so each command stays short. Needs an
// isolated stack created by scripts/db/prepare-stack.mjs (never the default
// 554xx stack); every phase resets or inspects that stack's database only.
//
//   W=$(node scripts/db/prepare-stack.mjs --project nabalens-migrations --ports 611)
//   supabase --workdir "$W" start
//   node tests/migrations/run.mjs "$W" db-reset upgrade  # supabase db reset, log kept
//   node tests/migrations/run.mjs "$W" upgrade   # seed media, migration up, verify
//   node tests/migrations/run.mjs "$W" db-reset reset
//   node tests/migrations/run.mjs "$W" reset     # compare the second reset with the first
//   node tests/migrations/run.mjs "$W" lint      # db diff (no drift) and db lint
//
// The resets are separate commands because one reset can take several minutes on
// a loaded machine.
//   supabase --workdir "$W" stop --no-backup
import { spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [workdirArg, phase] = process.argv.slice(2)
const phases = ["upgrade", "reset", "lint"]
if (
  !workdirArg ||
  !(phases.includes(phase) || (phase === "db-reset" && phases.includes(process.argv[4])))
)
  throw new Error(
    "Usage: node tests/migrations/run.mjs <isolated Supabase workdir> upgrade|reset|lint|db-reset <phase>"
  )
const workdir = resolve(workdirArg)
const state = join(workdir, ".drill")
mkdirSync(state, { recursive: true })

// The TEST-ONLY migration is only present while the upgrade test applies it. It
// must sort after every real migration, or `supabase migration up` rejects it as
// "inserted before the last migration" and the upgrade phase fails for the wrong reason.
const later = "20991231000000_test_only_additive.sql"
const newer = readdirSync("supabase/migrations").filter(
  (f) => f.endsWith(".sql") && f > later
)
if (newer.length > 0)
  throw new Error(
    `supabase/migrations/${newer.join(", ")} sorts after the TEST-ONLY migration ${later}; give tests/migrations/later and LATER in tests/migrations/helpers.ts a later timestamp.`
  )
rmSync(join(workdir, "supabase", "migrations", later), { force: true })

if (phase === "db-reset") {
  const target = process.argv[4]
  rmSync(join(state, `${target}-reset.log`), { force: true })
  console.log(`[${target}] supabase db reset --local (${workdir})`)
  // The CLI reports "Applying migration ..." on stderr; keep both streams.
  const result = spawnSync(
    "supabase",
    ["--workdir", workdir, "db", "reset", "--local"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  )
  const out = `${result.stdout}\n${result.stderr}`
  console.log(out.replace(/^A new version of Supabase CLI.*\n.*recommend.*\n?/gim, ""))
  if (result.status !== 0) process.exit(result.status ?? 1)
  writeFileSync(join(state, `${target}-reset.log`), out)
  process.exit(0)
}

const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "tests/migrations/vitest.config.ts",
    `tests/migrations/${phase}.test.ts`,
    ...process.argv.slice(4),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NABALENS_DRILL_WORKDIR: workdir,
      NABALENS_DRILL_STATE: state,
    },
  }
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
