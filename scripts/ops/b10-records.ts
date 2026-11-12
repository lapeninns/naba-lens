// B10 programme records: create identity-only onboarding records and empty
// observation logs, carry schema-1 records to schema 2, fill records from an
// aggregate read, or lint existing records. Records live outside this
// repository (they carry production venue IDs).
//
//   pnpm exec tsx scripts/ops/b10-records.ts init --roster <file> --out <dir>
//   pnpm exec tsx scripts/ops/b10-records.ts upgrade --roster <file> --from <dir> --out <dir>
//   pnpm exec tsx scripts/ops/b10-records.ts apply-aggregate --from <dir> --aggregate <file> --source <text> --out <dir>
//   pnpm exec tsx scripts/ops/b10-records.ts lint --roster <file> --dir <dir>
//
// Every writing command refuses to overwrite a file. lint exits 1 when any
// record has a problem. The B10-07 destination checklist is out of scope
// (owner correction, 11 Nov 2026): init no longer creates it, and lint only
// checks an existing one.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"

import { lintDestinationChecklist } from "../../lib/ops/destinations"
import {
  emptyObservationLog,
  lintObservationLog,
} from "../../lib/ops/observations"
import {
  applyAggregate,
  identityOnlyRecord,
  lintOnboardingRecord,
  upgradeV1Record,
  type OnboardingRecord,
  type VenueAggregate,
} from "../../lib/ops/onboarding"
import { parseRoster, type LintProblem } from "../../lib/ops/roster"

function arg(name: string) {
  const i = process.argv.indexOf(name)
  const value = i > 0 ? process.argv[i + 1] : undefined
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8"))
const write = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" })
const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z")

function refuseExisting(targets: string[]) {
  const existing = targets.filter((t) => existsSync(t))
  if (existing.length)
    throw new Error(`Refusing to overwrite: ${existing.join(", ")}`)
}

function init() {
  const rosterPath = arg("--roster")
  const roster = parseRoster(readFileSync(rosterPath, "utf8"))
  const out = arg("--out")
  const targets = [
    ...roster.map((v) => join(out, "onboarding", `${v.id}.json`)),
    ...roster.map((v) => join(out, "observations", `${v.id}.json`)),
  ]
  refuseExisting(targets)
  mkdirSync(join(out, "onboarding"), { recursive: true })
  mkdirSync(join(out, "observations"), { recursive: true })
  const updatedAt = now()
  for (const venue of roster) {
    write(
      join(out, "onboarding", `${venue.id}.json`),
      identityOnlyRecord({
        venue,
        rosterSource: basename(rosterPath),
        updatedAt,
      })
    )
    write(
      join(out, "observations", `${venue.id}.json`),
      emptyObservationLog(venue.id)
    )
  }
  console.log(`created ${targets.length} files under ${out}`)
}

function upgrade() {
  const rosterPath = arg("--roster")
  const roster = parseRoster(readFileSync(rosterPath, "utf8"))
  const from = arg("--from")
  const out = arg("--out")
  const targets = roster.map((v) => join(out, `${v.id}.json`))
  refuseExisting(targets)
  mkdirSync(out, { recursive: true })
  const updatedAt = now()
  for (const venue of roster) {
    const { record, dropped } = upgradeV1Record(
      readJson(join(from, `${venue.id}.json`)) as Record<string, unknown>,
      { venue, rosterSource: basename(rosterPath), updatedAt }
    )
    write(join(out, `${venue.id}.json`), record)
    console.log(`${venue.id}: dropped ${dropped.join(", ") || "nothing"}`)
  }
}

function applyAggregateCommand() {
  const from = arg("--from")
  const out = arg("--out")
  const source = arg("--source")
  const rows = readJson(arg("--aggregate"))
  if (!Array.isArray(rows)) throw new Error("aggregate must be a JSON array")
  const targets = (rows as VenueAggregate[]).map((r) =>
    join(out, `${r.venueId}.json`)
  )
  refuseExisting(targets)
  mkdirSync(out, { recursive: true })
  const updatedAt = now()
  for (const row of rows as VenueAggregate[]) {
    const record = readJson(
      join(from, `${row.venueId}.json`)
    ) as OnboardingRecord
    write(
      join(out, `${row.venueId}.json`),
      applyAggregate(record, row, { source, updatedAt })
    )
  }
  console.log(`filled ${rows.length} records under ${out}`)
}

function lint() {
  const roster = parseRoster(readFileSync(arg("--roster"), "utf8"))
  const dir = arg("--dir")
  const problems: (LintProblem & { file: string })[] = []
  const add = (file: string, list: LintProblem[]) =>
    problems.push(...list.map((p) => ({ ...p, file })))
  let files = 0
  for (const [sub, lintOne] of [
    ["onboarding", lintOnboardingRecord],
    ["observations", lintObservationLog],
  ] as const) {
    const folder = join(dir, sub)
    if (!existsSync(folder)) continue
    for (const name of readdirSync(folder).filter((n) => n.endsWith(".json"))) {
      files++
      add(
        `${sub}/${name}`,
        lintOne(
          readJson(join(folder, name)),
          roster,
          name.replace(/\.json$/, "")
        )
      )
    }
  }
  const destinations = join(dir, "destinations.json")
  if (existsSync(destinations)) {
    files++
    add(
      "destinations.json",
      lintDestinationChecklist(readJson(destinations), roster)
    )
  }
  for (const p of problems) console.log(`${p.file} ${p.path}: ${p.message}`)
  console.log(`${files} files checked, ${problems.length} problems`)
  if (problems.length || files === 0) process.exitCode = 1
}

const command = process.argv[2]
if (command === "init") init()
else if (command === "upgrade") upgrade()
else if (command === "apply-aggregate") applyAggregateCommand()
else if (command === "lint") lint()
else {
  console.error("Use init, upgrade, apply-aggregate or lint")
  process.exitCode = 2
}
