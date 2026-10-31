// Coverage check between docs/qa/acceptance-ids.md and the journey declarations.
//
//   node tests/journeys/acceptance-coverage.mjs [<repo root>]
//
// Exit 0 when they agree, 1 with one line per problem otherwise. The same
// functions back tests/unit/acceptance-coverage.test.ts.
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { loadJourneys } from "../../scripts/ci/journeys/registry.mjs"
import { SCENARIO_ID } from "../../scripts/ci/journeys/validate.mjs"

export const KINDS = [
  "smoke",
  "matrix",
  "defect",
  "observation",
  "known-gap",
  "media",
  "flaky",
]
export const STATUSES = ["covered", "gap", "not covered"]
const HISTORICAL = ["defect", "observation", "known-gap", "flaky"]

const CATALOGUE_PATH = "docs/qa/acceptance-ids.md"
const JOURNEY_IN_CELL = /`([a-z][a-z0-9-]*\.[a-z0-9-]+)`/g
const ROW = /^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/

/**
 * Reads every `| `ID` | kind | source | journeys | status | note |` row.
 * @returns {{ entries: Array<{id:string,kind:string,source:string,journeys:string[],status:string,note:string}>, problems: string[] }}
 */
export function parseCatalogue(markdown) {
  const entries = []
  const problems = []
  for (const line of markdown.split("\n")) {
    const match = ROW.exec(line)
    if (!match) continue
    const id = match[1]
    // Journey rows of the legend table (`id`, `Meaning`) have no id shape.
    if (!SCENARIO_ID.test(id)) continue
    const cells = match[2].split("|").map((cell) => cell.trim())
    if (cells.length !== 5) {
      problems.push(`${id}: expected kind, source, journeys, status and note`)
      continue
    }
    const [kind, source, journeysCell, status, note] = cells
    entries.push({
      id,
      kind,
      source,
      journeys: [...journeysCell.matchAll(JOURNEY_IN_CELL)].map((m) => m[1]),
      status,
      note,
    })
  }
  return { entries, problems }
}

/**
 * @param {{ entries: ReturnType<typeof parseCatalogue>["entries"] }} catalogue
 * @param {Array<{id:string,scenarios:string[],historical?:{id:string}}>} journeys
 * @returns {string[]} one message per disagreement
 */
export function checkCoverage(catalogue, journeys) {
  const problems = []
  const byId = new Map()
  for (const entry of catalogue.entries) {
    if (byId.has(entry.id)) problems.push(`${entry.id}: listed twice`)
    byId.set(entry.id, entry)
    if (!KINDS.includes(entry.kind)) {
      problems.push(`${entry.id}: kind "${entry.kind}" is not one of ${KINDS}`)
    }
    if (!STATUSES.includes(entry.status)) {
      problems.push(
        `${entry.id}: status "${entry.status}" is not one of ${STATUSES}`
      )
    }
    if (!entry.source || entry.source === "-") {
      problems.push(`${entry.id}: source is required`)
    }
  }
  const journeyById = new Map(journeys.map((j) => [j.id, j]))

  for (const journey of journeys) {
    for (const id of journey.scenarios) {
      const entry = byId.get(id)
      if (!entry) {
        problems.push(
          `${journey.id}: declares ${id}, which is not in ${CATALOGUE_PATH}`
        )
      } else if (!entry.journeys.includes(journey.id)) {
        problems.push(
          `${journey.id}: declares ${id}, but its row does not list this journey`
        )
      }
    }
    if (journey.historical) {
      const { id } = journey.historical
      if (!HISTORICAL.includes(byId.get(id)?.kind)) {
        problems.push(
          `${journey.id}: historical.id ${id} must be a historical row (defect, observation, known-gap or flaky) in ${CATALOGUE_PATH}`
        )
      }
      if (!journey.scenarios.includes(id)) {
        problems.push(`${journey.id}: historical.id ${id} is not in scenarios`)
      }
    }
  }

  for (const entry of catalogue.entries) {
    for (const journeyId of entry.journeys) {
      const journey = journeyById.get(journeyId)
      if (!journey) {
        problems.push(`${entry.id}: journey ${journeyId} does not exist`)
      } else if (!journey.scenarios.includes(entry.id)) {
        problems.push(
          `${entry.id}: journey ${journeyId} does not declare this id`
        )
      }
    }
    if (entry.status === "covered" && entry.journeys.length === 0) {
      problems.push(`${entry.id}: is covered but lists no journey`)
    }
    if (entry.status !== "covered" && entry.journeys.length > 0) {
      problems.push(
        `${entry.id}: is "${entry.status}" but lists ${entry.journeys.join(", ")}`
      )
    }
    if (entry.status !== "covered" && (!entry.note || entry.note === "-")) {
      problems.push(`${entry.id}: "${entry.status}" needs the reason in note`)
    }
    if (HISTORICAL.includes(entry.kind)) {
      if (entry.status !== "covered") {
        problems.push(
          `${entry.id}: a historical ${entry.kind} must have a journey`
        )
      } else if (
        !entry.journeys.some(
          (id) => journeyById.get(id)?.historical?.id === entry.id
        )
      ) {
        problems.push(
          `${entry.id}: no journey carries historical.id ${entry.id}`
        )
      }
    }
  }
  return problems
}

export function checkRepository(root) {
  const catalogue = parseCatalogue(
    readFileSync(join(root, CATALOGUE_PATH), "utf8")
  )
  const { journeys, problems: declarationProblems } = loadJourneys(root)
  return [
    ...catalogue.problems,
    ...declarationProblems,
    ...checkCoverage(catalogue, journeys),
  ]
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const root = resolve(
    process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "../..")
  )
  const problems = checkRepository(root)
  for (const problem of problems) console.error(`✗ ${problem}`)
  console.log(
    problems.length === 0
      ? "Acceptance ids and journey declarations agree."
      : `${problems.length} problem(s).`
  )
  process.exit(problems.length === 0 ? 0 : 1)
}
