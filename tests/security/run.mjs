import { execFileSync, spawnSync } from "node:child_process"
import { resolve } from "node:path"

const workdir = process.argv[2]
if (!workdir)
  throw new Error(
    "Usage: node tests/security/run.mjs <isolated Supabase workdir>"
  )
const raw = execFileSync(
  "supabase",
  ["--workdir", resolve(workdir), "status", "-o", "json"],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }
)
const status = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1))
const url = new URL(status.API_URL)
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.port.startsWith("554")
) {
  throw new Error(
    "Security tests require an isolated local stack outside foundation's 554xx block"
  )
}
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "tests/security/vitest.config.ts",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        status.ANON_KEY ?? status.PUBLISHABLE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
      // Regression R7 ages a claim by database time with psql (local only).
      NABALENS_TEST_DB_URL: status.DB_URL,
    },
  }
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
