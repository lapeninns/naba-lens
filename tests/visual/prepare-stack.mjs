// Creates the isolated Supabase workdir the visual/a11y suite runs against: a
// copy of this checkout's supabase/ with project_id "nabalens-visual", every
// 554xx port moved to 577xx, and the services the suite does not use (studio,
// realtime) switched off to keep machine load down. Prints the workdir.
//
//   W=$(node tests/visual/prepare-stack.mjs [workdir])
//   supabase --workdir "$W" start && supabase --workdir "$W" db reset
//   pnpm build && pnpm test:visual "$W"
//   supabase --workdir "$W" stop
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const workdir = resolve(
  process.argv[2] ?? join(tmpdir(), "nabalens-visual-stack")
)
const target = join(workdir, "supabase")
// Re-copy so new or changed migrations are always picked up.
rmSync(join(target, "migrations"), { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync("supabase", target, {
  recursive: true,
  filter: (src) => !/[/\\]\.(temp|branches)([/\\]|$)/.test(src),
})

const disable = (text, section) =>
  text.replace(
    new RegExp(`^(\\[${section}\\]\\nenabled = )true$`, "m"),
    "$1false"
  )

const configPath = join(target, "config.toml")
let config = readFileSync(configPath, "utf8")
  .replace(/^project_id = ".*"$/m, 'project_id = "nabalens-visual"')
  .replace(/^(\s*(?:\w+_)?port = )554(\d\d)$/gm, "$1577$2")
for (const section of ["studio", "realtime", "analytics", "edge_runtime"]) {
  config = disable(config, section)
}
if (/= 554\d\d$/m.test(config)) {
  throw new Error("A 554xx port was left in the isolated config")
}
writeFileSync(configPath, config)
console.log(workdir)
