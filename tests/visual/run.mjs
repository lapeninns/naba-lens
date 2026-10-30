// Runs the visual/accessibility suite (tests/e2e/visual.spec.ts) against a
// PRODUCTION build (`next build` + `next start`) and an isolated local stack,
// in Chromium (360/390/768/1280/1440), Firefox and WebKit (1280).
//
//   W=$(node tests/visual/prepare-stack.mjs)
//   supabase --workdir "$W" start
//   pnpm test:visual "$W"              # builds first
//   pnpm test:visual "$W" --no-build   # reuse the last build of this stack
//   supabase --workdir "$W" stop
//
// Screenshots go to .artifacts/screenshots/visual/<project>/ (gitignored).
import { execFileSync, spawnSync } from "node:child_process"
import { resolve } from "node:path"

const [workdir, ...rest] = process.argv.slice(2)
if (!workdir)
  throw new Error(
    "Usage: node tests/visual/run.mjs <isolated Supabase workdir>"
  )
const raw = execFileSync(
  "supabase",
  ["--workdir", resolve(workdir), "status", "-o", "json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
)
const status = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1))
const url = new URL(status.API_URL)
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.port.startsWith("554")
) {
  throw new Error(
    "The visual suite requires an isolated local stack outside foundation's 554xx block"
  )
}
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    status.PUBLISHABLE_KEY ?? status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
  MAILPIT_URL: status.MAILPIT_URL ?? status.INBUCKET_URL ?? "",
}
const run = (args) => {
  const result = spawnSync(args[0], args.slice(1), { stdio: "inherit", env })
  if (result.error) throw result.error
  return result.status ?? 1
}

const noBuild = rest.includes("--no-build")
const playwrightArgs = rest.filter((arg) => arg !== "--no-build")
if (!noBuild) {
  const code = run(["pnpm", "exec", "next", "build"])
  if (code !== 0) process.exit(code)
}
process.exit(
  run([
    "pnpm",
    "exec",
    "playwright",
    "test",
    "--config",
    "playwright.visual.config.ts",
    ...playwrightArgs,
  ])
)
