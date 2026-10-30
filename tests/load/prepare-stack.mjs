// Creates the isolated Supabase workdir the load-sanity run uses: a copy of this
// checkout's supabase/ with project_id "nabalens-load", every 554xx port moved to
// 615xx, and the services a load run never touches (Studio, Realtime, Analytics,
// Edge Runtime, Mailpit) disabled to keep the shared Mac's load down. Prints
// the workdir.
//
//   W=$(node tests/load/prepare-stack.mjs [workdir])
//   supabase --workdir "$W" start -x imgproxy,postgres-meta,vector,logflare,supavisor
//   ... (see docs/runtime-sizing.md)
//   supabase --workdir "$W" stop
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const workdir = resolve(
  process.argv[2] ?? join(tmpdir(), "nabalens-load-stack")
)
const target = join(workdir, "supabase")
// Re-copy so new or changed migrations are always picked up.
rmSync(join(target, "migrations"), { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync("supabase", target, {
  recursive: true,
  filter: (src) => !/[/\\]\.(temp|branches)([/\\]|$)/.test(src),
})

const configPath = join(target, "config.toml")
let config = readFileSync(configPath, "utf8")
  .replace(/^project_id = ".*"$/m, 'project_id = "nabalens-load"')
  .replace(/^(\s*(?:\w+_)?port = )554(\d\d)$/gm, "$1615$2")
for (const section of [
  "studio",
  "realtime",
  "analytics",
  "edge_runtime",
  "local_smtp",
]) {
  const re = new RegExp(
    `(^\\[${section}\\]\\n(?:[^\\[].*\\n|\\n)*?)enabled = (?:true|false)`,
    "m"
  )
  if (!re.test(config)) throw new Error(`[${section}] enabled not found`)
  config = config.replace(re, "$1enabled = false")
}
if (/= 554\d\d$/m.test(config)) {
  throw new Error("A 554xx port was left in the isolated config")
}
writeFileSync(configPath, config)
console.log(workdir)
