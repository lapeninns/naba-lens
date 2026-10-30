// CI step: the privacy runtime suite (tests/integration/privacy-runtime.test.ts)
// against the e2e production server, so it never silently skips. Reuses the
// `.next` build Playwright made against this stack (rebuilds if it targets
// another), serves it with `next start` on the e2e port with stdout+stderr
// captured for the suite's log check, and requires 11+ passed, 0 skipped.
//
//   node scripts/ci/privacy-runtime.mjs <workdir with status.json>
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs"
import { join } from "node:path"

const work = process.argv[2]
if (!work)
  throw new Error("Usage: node scripts/ci/privacy-runtime.mjs <workdir>")
const status = JSON.parse(readFileSync(`${work}/status.json`, "utf8"))
const port = Number(process.env.E2E_PORT ?? 3457)
const base = `http://127.0.0.1:${port}`
const log = join(work, "privacy-server.log")
const report = join(work, "privacy-vitest.json")
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    status.ANON_KEY ?? status.PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
  MAILPIT_URL: status.MAILPIT_URL ?? status.INBUCKET_URL,
  NEXT_PUBLIC_SITE_URL: base,
  CLEANUP_SECRET: randomBytes(32).toString("hex"),
}

// The suite reads Server Function IDs from .next, so the server must serve that
// build, and NEXT_PUBLIC_* are inlined at build time: it must target this stack.
function buildTargetsStack() {
  const dir = ".next/static/chunks"
  if (!existsSync(dir)) return false
  const files = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith(".js")) files.push(p)
    }
  }
  walk(dir)
  return files.some((p) => readFileSync(p, "utf8").includes(status.API_URL))
}
if (!buildTargetsStack()) {
  console.log("privacy-runtime: building against the CI stack")
  const built = spawnSync("pnpm", ["exec", "next", "build"], {
    stdio: "inherit",
    env,
  })
  if (built.status !== 0) process.exit(1)
}

const out = openSync(log, "w")
const server = spawn(
  "pnpm",
  ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    env,
    stdio: ["ignore", out, out],
    detached: true,
  }
)
const stop = () => {
  try {
    process.kill(-server.pid, "SIGTERM")
  } catch {}
}
process.on("exit", stop)

let ready = false
for (let i = 0; i < 120 && !ready; i++) {
  try {
    ready = (await fetch(`${base}/login`)).ok
  } catch {}
  if (!ready) await new Promise((r) => setTimeout(r, 1000))
}
if (!ready) {
  console.log(`privacy-runtime: server did not start on ${base}`)
  process.exit(1)
}

const run = spawnSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "--project",
    "integration",
    "tests/integration/privacy-runtime.test.ts",
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${report}`,
  ],
  {
    stdio: "inherit",
    env: {
      ...env,
      PRIVACY_BASE_URL: base,
      PRIVACY_SERVER_LOG: log,
      PRIVACY_RUNTIME_REQUIRED: "1",
    },
  }
)
stop()
closeSync(out)

const result = JSON.parse(readFileSync(report, "utf8"))
const skipped = result.numPendingTests + result.numTodoTests
const ok =
  run.status === 0 &&
  result.numFailedTests === 0 &&
  skipped === 0 &&
  result.numPassedTests >= 11
console.log(
  `privacy-runtime: ${result.numPassedTests} passed, ${result.numFailedTests} failed, ${skipped} skipped: ${ok ? "PASS" : "FAIL"}`
)
process.exit(ok ? 0 : 1)
