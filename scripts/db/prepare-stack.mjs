// Creates an isolated, trimmed Supabase workdir for the migration-safety and
// backup/restore drills: a copy of this checkout's supabase/ with its own
// project_id and every 554xx port moved to <ports>xx, so it never collides with
// the default stack (554xx) or other worktrees. Services the drills don't use
// (Studio, Realtime, Mailpit, analytics, edge runtime, vector buckets) are
// disabled to keep machine load down. Prints the workdir path.
//
//   W=$(node scripts/db/prepare-stack.mjs --project nabalens-migrations --ports 611 [--dir <workdir>])
//   supabase --workdir "$W" start
//   ...
//   supabase --workdir "$W" stop --no-backup
//
// Options:
//   --no-seed           do not run supabase/seed.sql on start/reset (restore target)
//   --no-migrations     start with an empty migrations dir (a blank project)
//
// The checked-in supabase/config.toml is never modified.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    ports: { type: "string" },
    dir: { type: "string" },
    "no-seed": { type: "boolean", default: false },
    "no-migrations": { type: "boolean", default: false },
  },
})
if (!values.project || !/^[a-z0-9-]+$/.test(values.project)) {
  throw new Error("--project <lowercase-id> is required")
}
if (!values.ports || !/^(5[6-9]|6[0-4])\d$/.test(values.ports)) {
  throw new Error("--ports <560..649> is required (three-digit port prefix)")
}
if (values.ports === "554") throw new Error("554xx is the default stack")

const workdir = resolve(values.dir ?? join(tmpdir(), `${values.project}-stack`))
const target = join(workdir, "supabase")
// Re-copy so new or changed migrations are always picked up.
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync("supabase", target, {
  recursive: true,
  filter: (src) => !/[/\\]\.(temp|branches)([/\\]|$)/.test(src),
})
if (values["no-migrations"]) {
  rmSync(join(target, "migrations"), { recursive: true, force: true })
  mkdirSync(join(target, "migrations"))
}

const disable = (text, section) => {
  const re = new RegExp(
    `(^\\[${section.replace(".", "\\.")}\\]\\n(?:[^\\[].*\\n)*?)enabled = true`,
    "m"
  )
  if (
    !re.test(text) &&
    !new RegExp(
      `^\\[${section.replace(".", "\\.")}\\]\\n(?:[^\\[].*\\n)*?enabled = false`,
      "m"
    ).test(text)
  ) {
    throw new Error(`Could not find [${section}] enabled in config.toml`)
  }
  return text.replace(re, "$1enabled = false")
}

let config = readFileSync(join(target, "config.toml"), "utf8")
  .replace(/^project_id = ".*"$/m, `project_id = "${values.project}"`)
  .replace(/^(\s*(?:\w+_)?port = )554(\d\d)$/gm, `$1${values.ports}$2`)
for (const section of [
  "studio",
  "realtime",
  "local_smtp",
  "analytics",
  "edge_runtime",
  "storage.vector",
]) {
  config = disable(config, section)
}
if (values["no-seed"]) {
  config = config.replace(
    /(^\[db\.seed\]\n(?:[^\[].*\n)*?)enabled = true/m,
    "$1enabled = false"
  )
}
if (/= 554\d\d$/m.test(config)) {
  throw new Error("A 554xx port was left in the isolated config")
}
writeFileSync(join(target, "config.toml"), config)
console.log(workdir)
