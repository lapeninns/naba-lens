// B10 programme records: create the identity-only onboarding records, empty
// observation logs and the destination checklist, or lint existing ones.
// Records live outside this repository (they carry production venue IDs).
//
//   pnpm exec tsx scripts/ops/b10-records.ts init --roster <file> --crosswalk <file> --out <dir>
//   pnpm exec tsx scripts/ops/b10-records.ts lint --roster <file> --dir <dir>
//
// init never overwrites a file: it stops if any target exists. lint exits 1
// when any record has a problem.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"

import {
  initialChecklist,
  lintDestinationChecklist,
  websiteDestinationFor,
} from "../../lib/ops/destinations"
import {
  emptyObservationLog,
  lintObservationLog,
} from "../../lib/ops/observations"
import {
  CROSSWALK_STATUSES,
  identityOnlyRecord,
  lintOnboardingRecord,
} from "../../lib/ops/onboarding"
import { parseRoster, type LintProblem } from "../../lib/ops/roster"

type CrosswalkRow = {
  venueId: string
  siteRepository: string
  status: (typeof CROSSWALK_STATUSES)[number]
  source: string
}

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

function init() {
  const rosterPath = arg("--roster")
  const roster = parseRoster(readFileSync(rosterPath, "utf8"))
  const crosswalk = readJson(arg("--crosswalk")) as CrosswalkRow[]
  const out = arg("--out")
  const targets = [
    ...roster.map((v) => join(out, "onboarding", `${v.id}.json`)),
    ...roster.map((v) => join(out, "observations", `${v.id}.json`)),
    join(out, "destinations.json"),
  ]
  const existing = targets.filter((t) => existsSync(t))
  if (existing.length)
    throw new Error(`Refusing to overwrite: ${existing.join(", ")}`)
  mkdirSync(join(out, "onboarding"), { recursive: true })
  mkdirSync(join(out, "observations"), { recursive: true })
  const updatedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z")
  for (const venue of roster) {
    const row = crosswalk.find((c) => c.venueId === venue.id)
    const site = row ? websiteDestinationFor(row.siteRepository) : undefined
    if (!row || !site?.generation)
      throw new Error(`No crosswalk proposal with a known site for ${venue.id}`)
    write(
      join(out, "onboarding", `${venue.id}.json`),
      identityOnlyRecord({
        venue,
        rosterSource: basename(rosterPath),
        crosswalkStatus: row.status,
        crosswalkSource: row.source,
        generation: site.generation,
        generationSource: `${row.source}; b10-design §9.3 ${site.id}`,
        updatedAt,
      })
    )
    write(
      join(out, "observations", `${venue.id}.json`),
      emptyObservationLog(venue.id)
    )
  }
  write(join(out, "destinations.json"), initialChecklist(roster))
  console.log(`created ${targets.length} files under ${out}`)
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
else if (command === "lint") lint()
else {
  console.error("Use init or lint")
  process.exitCode = 2
}
