// Creates the isolated Supabase workdir the journey E2E suite runs against: a copy
// of this checkout's supabase/ with project_id "nabalens-journey", every 554xx port
// moved to 583xx (override with E2E_PORT_BLOCK=NNN), the auth site URL pointed at the e2e app server, and services the
// suite does not use (studio, realtime, analytics, edge runtime) disabled to keep
// machine load down. Prints the workdir.
//
//   W=$(node tests/e2e/prepare-stack.mjs [workdir])
//   supabase --workdir "$W" start && supabase --workdir "$W" db reset
//   E2E_SUPABASE_WORKDIR="$W" pnpm test:e2e
//   supabase --workdir "$W" stop
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const APP_PORT = Number(process.env.E2E_PORT ?? 3457)
const BLOCK = process.env.E2E_PORT_BLOCK ?? "583"
if (!/^\d{3}$/.test(BLOCK) || BLOCK === "554")
  throw new Error("E2E_PORT_BLOCK must be three digits other than 554")
const workdir = resolve(
  process.argv[2] ?? join(tmpdir(), "nabalens-journey-stack")
)
const target = join(workdir, "supabase")
// Re-copy so new or changed migrations are always picked up.
rmSync(join(target, "migrations"), { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync("supabase", target, {
  recursive: true,
  filter: (src) => !/[/\\]\.(temp|branches)([/\\]|$)/.test(src),
})

const site = `http://127.0.0.1:${APP_PORT}`
const disable = (text, section) =>
  text.replace(
    new RegExp(`(^\\[${section}\\]\\n(?:[^\\[].*\\n)*?)enabled = true`, "m"),
    "$1enabled = false"
  )

const configPath = join(target, "config.toml")
let config = readFileSync(configPath, "utf8")
  .replace(/^project_id = ".*"$/m, 'project_id = "nabalens-journey"')
  .replace(/^(\s*(?:\w+_)?port = )554(\d\d)$/gm, `$1${BLOCK}$2`)
  .replace(/^site_url = ".*"$/m, `site_url = "${site}"`)
  .replace(
    /^additional_redirect_urls = .*$/m,
    `additional_redirect_urls = ["${site}/auth/callback", "${site}/auth/confirm"]`
  )
// Every browser context shares one client IP, and the suite signs in far more
// often than one person would. Raise only the per-IP sign-in/verification
// limits of this throwaway stack; the committed config keeps the real values.
config = config
  .replace(/^sign_in_sign_ups = \d+$/m, "sign_in_sign_ups = 300")
  .replace(/^token_verifications = \d+$/m, "token_verifications = 300")
for (const section of ["realtime", "studio", "analytics", "edge_runtime"]) {
  config = disable(config, section)
}
if (/= 554\d\d$/m.test(config)) {
  throw new Error("A 554xx port was left in the isolated config")
}
for (const section of ["realtime", "studio"]) {
  if (!new RegExp(`^\\[${section}\\]\\nenabled = false`, "m").test(config)) {
    throw new Error(`Could not disable [${section}]`)
  }
}
writeFileSync(configPath, config)
console.log(workdir)
