// Creates the isolated Supabase workdir the library track runs its integration
// and e2e tests against: a copy of this checkout's supabase/ with project_id
// "nabalens-library", every 554xx port moved to 579xx, and the services the
// tests don't need (studio, realtime, analytics, edge runtime) disabled to keep
// machine load down while other worktrees run their own stacks. Prints the workdir.
//
//   W=$(node tests/library/prepare-stack.mjs [workdir])
//   supabase --workdir "$W" start && supabase --workdir "$W" db reset
//   supabase --workdir "$W" stop      # when finished
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const workdir = resolve(
  process.argv[2] ?? join(tmpdir(), "nabalens-library-stack")
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
  .replace(/^project_id = ".*"$/m, 'project_id = "nabalens-library"')
  .replace(/^(\s*(?:\w+_)?port = )554(\d\d)$/gm, "$1579$2")
if (/= 554\d\d$/m.test(config)) {
  throw new Error("A 554xx port was left in the isolated config")
}
for (const section of ["studio", "realtime", "analytics", "edge_runtime"]) {
  const header = new RegExp(`^\\[${section}\\]\\n(?:#.*\\n)*enabled = true$`, "m")
  config = config.replace(header, (block) =>
    block.replace(/enabled = true$/, "enabled = false")
  )
}
writeFileSync(configPath, config)
console.log(workdir)
