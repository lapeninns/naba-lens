// Journey declarations: tests/journeys/**/<slug>.journey.json. Each declares one
// journey and points at the Playwright spec (and optional --grep) that holds its
// deterministic assertions.
//
//   {
//     "id": "menus.activation",            // <area>.<slug>, unique
//     "title": "Admin activates a reviewed draft menu",
//     "spec": "tests/e2e/menus-admin.spec.ts",
//     "grep": "rows 1\\+3",                 // optional, passed to --grep
//     "projects": ["chromium"],            // optional; chromium|firefox|webkit|mobile-chromium
//     "scenarios": ["MENUS-QA-03"],         // acceptance ids
//     "historical": {                       // optional: a previously reported failure
//       "source": "docs/qa/menus-qa-report.md#4-defects-for-the-lead",
//       "id": "MENUS-D2"
//     },
//     "needs": ["psql"],                   // optional extra prerequisite: psql
//     "agentic": { "file": "tests/journeys/x.e2e.ts", "config": "e2e.config.ts" }, // optional, run with --agentic; evidence only
//     "timeoutSeconds": 600                // optional
//   }
//
// A historical journey's spec asserts the CORRECT behaviour: it fails while the
// defect reproduces and passes once the defect is fixed.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { JOURNEY_ID, SCENARIO_ID } from "./validate.mjs"

export const PROJECTS = ["chromium", "firefox", "webkit", "mobile-chromium"]
const NEEDS = ["psql"]
const KEYS = [
  "id",
  "title",
  "spec",
  "grep",
  "projects",
  "scenarios",
  "historical",
  "needs",
  "agentic",
  "timeoutSeconds",
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (name.endsWith(".journey.json")) out.push(full)
  }
  return out.sort()
}

export function validateDefinition(def, root) {
  const errors = []
  if (typeof def !== "object" || def === null || Array.isArray(def)) {
    return ["definition must be an object"]
  }
  for (const key of Object.keys(def)) {
    if (!KEYS.includes(key)) errors.push(`${key}: unknown field`)
  }
  if (typeof def.id !== "string" || !JOURNEY_ID.test(def.id)) {
    errors.push("id must be <area>.<slug> in lowercase kebab-case")
  }
  if (typeof def.title !== "string" || !def.title.trim())
    errors.push("title is required")
  if (typeof def.spec !== "string" || !def.spec.endsWith(".spec.ts")) {
    errors.push("spec must be a path to a *.spec.ts file")
  } else if (root && !existsSync(join(root, def.spec))) {
    errors.push(`spec ${def.spec} does not exist`)
  }
  if (def.grep !== undefined) {
    try {
      new RegExp(def.grep)
    } catch {
      errors.push("grep must be a valid regular expression")
    }
  }
  const projects = def.projects ?? ["chromium"]
  if (
    !Array.isArray(projects) ||
    projects.length === 0 ||
    projects.some((p) => !PROJECTS.includes(p))
  ) {
    errors.push(`projects must be a non-empty subset of ${PROJECTS.join(", ")}`)
  }
  if (
    !Array.isArray(def.scenarios) ||
    def.scenarios.some((s) => !SCENARIO_ID.test(s))
  ) {
    errors.push(
      "scenarios must be an array of acceptance ids (e.g. MENUS-QA-03)"
    )
  }
  if (def.historical !== undefined) {
    const h = def.historical
    if (!h || typeof h.source !== "string" || typeof h.id !== "string") {
      errors.push("historical needs { source, id }")
    }
  }
  if (
    def.needs !== undefined &&
    (!Array.isArray(def.needs) || def.needs.some((n) => !NEEDS.includes(n)))
  ) {
    errors.push(`needs must be a subset of ${NEEDS.join(", ")}`)
  }
  if (def.agentic !== undefined) {
    if (typeof def.agentic?.file !== "string")
      errors.push("agentic needs { file }")
    else if (root && !existsSync(join(root, def.agentic.file))) {
      errors.push(`agentic file ${def.agentic.file} does not exist`)
    }
  }
  if (
    def.timeoutSeconds !== undefined &&
    !(Number.isInteger(def.timeoutSeconds) && def.timeoutSeconds > 0)
  ) {
    errors.push("timeoutSeconds must be a positive integer")
  }
  return errors
}

/** Loads and validates every declaration under <root>/tests/journeys. */
export function loadJourneys(root) {
  const dir = join(root, "tests/journeys")
  const journeys = []
  const problems = []
  for (const file of existsSync(dir) ? walk(dir) : []) {
    const name = relative(root, file)
    let def
    try {
      def = JSON.parse(readFileSync(file, "utf8"))
    } catch (error) {
      problems.push(`${name}: ${error.message}`)
      continue
    }
    const errors = validateDefinition(def, root)
    problems.push(...errors.map((e) => `${name}: ${e}`))
    if (errors.length === 0) {
      journeys.push({
        ...def,
        projects: def.projects ?? ["chromium"],
        needs: def.needs ?? [],
        file: name,
      })
    }
  }
  const seen = new Map()
  for (const j of journeys) {
    if (seen.has(j.id))
      problems.push(
        `${j.file}: id ${j.id} is also declared in ${seen.get(j.id)}`
      )
    seen.set(j.id, j.file)
  }
  return { journeys, problems }
}

const toRegExp = (pattern) =>
  new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`
  )

/** Selects by exact id, `area.*` style glob, or `--all`. Unknown selectors are errors. */
export function selectJourneys(journeys, selectors, all) {
  if (all) return { selected: journeys, unknown: [] }
  const selected = new Set()
  const unknown = []
  for (const selector of selectors) {
    const pattern = toRegExp(selector)
    const matches = journeys.filter((j) => pattern.test(j.id))
    if (matches.length === 0) unknown.push(selector)
    matches.forEach((j) => selected.add(j))
  }
  return { selected: journeys.filter((j) => selected.has(j)), unknown }
}
