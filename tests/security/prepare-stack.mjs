// Creates the isolated Supabase workdir the security suite runs against: a copy
// of this checkout's supabase/ (migrations, seed, templates, auth config) with
// project_id "nabalens-security" and every 554xx port moved to 564xx, so it
// never collides with the default local stack. Prints the workdir path.
//
//   W=$(node tests/security/prepare-stack.mjs [workdir])
//   supabase --workdir "$W" start && supabase --workdir "$W" db reset
//   pnpm test:security "$W"
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const workdir = resolve(
  process.argv[2] ?? join(tmpdir(), "nabalens-security-stack")
)
const target = join(workdir, "supabase")
mkdirSync(target, { recursive: true })
cpSync("supabase", target, {
  recursive: true,
  filter: (src) => !/[/\\]\.(temp|branches)([/\\]|$)/.test(src),
})

const configPath = join(target, "config.toml")
const config = readFileSync(configPath, "utf8")
  .replace(/^project_id = ".*"$/m, 'project_id = "nabalens-security"')
  .replace(/^(\s*(?:\w+_)?port = )554(\d\d)$/gm, "$1564$2")
if (/= 554\d\d$/m.test(config)) {
  throw new Error("A 554xx port was left in the isolated config")
}
writeFileSync(configPath, config)
console.log(workdir)
