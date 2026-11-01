// Validator for journey results (scripts/ci/journeys/result.schema.json) and run
// directories. Hand-written so the harness adds no dependency; the schema file
// documents the same shape for editors and other tools.
//
//   node scripts/ci/journeys/validate.mjs <results-dir>
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { isAbsolute, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"

export const RESULT_SCHEMA = "nabalens.journey-result/v1"
export const SUMMARY_SCHEMA = "nabalens.journey-summary/v1"
export const RESULTS = ["pass", "fail", "unavailable"]
export const JOURNEY_ID =
  /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z0-9]+(-[a-z0-9]+)*$/
export const SCENARIO_ID = /^[A-Z][A-Z0-9]*(-[A-Za-z0-9]+)+$/

/** Credentials that must never appear in kept evidence. */
export const SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /sb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}/,
  /(?:sb-[a-z0-9-]+-auth-token|access_token|refresh_token)["'=:\s]+[A-Za-z0-9._-]{20,}/i,
]
const FORBIDDEN_EVIDENCE =
  /(^|[\\/])(trace[^\\/]*|status\.json|.*\.zip|.*\.har|.*cookies?.*|.*\.webm)$/i
const TEXT_EVIDENCE = /\.(log|txt|md|json|html|yml|yaml)$/i
const KINDS = ["log", "screenshot", "report", "note"]
const isoDate = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(v) &&
  Number.isFinite(Date.parse(v))
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v)
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0

export function containsSecret(text) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
}

function unknownKeys(obj, allowed, path, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`${path}${key}: unknown field`)
  }
}

/**
 * Returns a list of problems (empty when valid). `resultsDir` enables the
 * evidence checks: every path must exist under it, be free of traces and
 * cookies, and contain no credentials.
 */
export function validateResult(result, { resultsDir } = {}) {
  const errors = []
  if (!isObject(result)) return ["result must be an object"]
  unknownKeys(
    result,
    [
      "schema",
      "journey",
      "title",
      "result",
      "reason",
      "revision",
      "stack",
      "runner",
      "startedAt",
      "finishedAt",
      "scenarios",
      "checks",
      "historical",
      "evidence",
    ],
    "",
    errors
  )
  if (result.schema !== RESULT_SCHEMA)
    errors.push(`schema must be ${RESULT_SCHEMA}`)
  if (typeof result.journey !== "string" || !JOURNEY_ID.test(result.journey)) {
    errors.push("journey must be <area>.<slug> in lowercase kebab-case")
  }
  if (!nonEmpty(result.title)) errors.push("title is required")
  if (!RESULTS.includes(result.result)) {
    errors.push(`result must be one of ${RESULTS.join(", ")}`)
  }
  if (result.result === "pass") {
    if (result.reason !== null) errors.push("reason must be null for a pass")
  } else if (RESULTS.includes(result.result) && !nonEmpty(result.reason)) {
    errors.push(`reason is required when result is ${result.result}`)
  }

  const rev = result.revision
  if (!isObject(rev)) errors.push("revision is required")
  else {
    unknownKeys(rev, ["commit", "branch", "dirty"], "revision.", errors)
    if (typeof rev.commit !== "string" || !/^[0-9a-f]{40}$/.test(rev.commit)) {
      errors.push("revision.commit must be a full 40-character sha")
    }
    if (!nonEmpty(rev.branch)) errors.push("revision.branch is required")
    if (typeof rev.dirty !== "boolean")
      errors.push("revision.dirty must be a boolean")
  }

  const stack = result.stack
  if (!isObject(stack)) errors.push("stack is required")
  else {
    unknownKeys(stack, ["name", "apiPort", "migrations"], "stack.", errors)
    if (!nonEmpty(stack.name)) errors.push("stack.name is required")
    if (
      !Number.isInteger(stack.apiPort) ||
      stack.apiPort < 1 ||
      stack.apiPort > 65535
    ) {
      errors.push("stack.apiPort must be a port number")
    }
    if (!nonEmpty(stack.migrations)) errors.push("stack.migrations is required")
  }

  const runner = result.runner
  if (!isObject(runner)) errors.push("runner is required")
  else {
    unknownKeys(runner, ["kind", "version"], "runner.", errors)
    if (!["playwright", "agentic"].includes(runner.kind)) {
      errors.push("runner.kind must be playwright or agentic")
    }
    if (!nonEmpty(runner.version)) errors.push("runner.version is required")
  }

  if (!isoDate(result.startedAt))
    errors.push("startedAt must be a UTC ISO timestamp")
  if (!isoDate(result.finishedAt))
    errors.push("finishedAt must be a UTC ISO timestamp")
  if (
    isoDate(result.startedAt) &&
    isoDate(result.finishedAt) &&
    Date.parse(result.finishedAt) < Date.parse(result.startedAt)
  ) {
    errors.push("finishedAt is before startedAt")
  }

  if (!Array.isArray(result.scenarios))
    errors.push("scenarios must be an array")
  else {
    for (const id of result.scenarios) {
      if (typeof id !== "string" || !SCENARIO_ID.test(id)) {
        errors.push(`scenarios: "${id}" is not an acceptance id`)
      }
    }
  }

  if (result.checks !== undefined) {
    const c = result.checks
    if (!isObject(c)) errors.push("checks must be an object")
    else {
      unknownKeys(c, ["passed", "failed", "skipped"], "checks.", errors)
      for (const key of ["passed", "failed", "skipped"]) {
        if (!Number.isInteger(c[key]) || c[key] < 0) {
          errors.push(`checks.${key} must be a non-negative integer`)
        }
      }
    }
  }
  // A pass must rest on at least one deterministic assertion that held.
  if (result.result === "pass") {
    const c = result.checks
    if (!isObject(c) || !(c.passed >= 1) || c.failed !== 0 || c.skipped !== 0) {
      errors.push(
        "a pass needs checks with passed >= 1, failed = 0 and skipped = 0"
      )
    }
  }

  if (result.historical !== undefined) {
    const h = result.historical
    if (!isObject(h)) errors.push("historical must be an object")
    else {
      unknownKeys(
        h,
        ["source", "id", "reproducedOnHead"],
        "historical.",
        errors
      )
      if (!nonEmpty(h.source)) errors.push("historical.source is required")
      if (!nonEmpty(h.id)) errors.push("historical.id is required")
      if (
        typeof h.reproducedOnHead !== "boolean" &&
        h.reproducedOnHead !== null
      ) {
        errors.push("historical.reproducedOnHead must be a boolean or null")
      }
      if (result.result === "pass" && h.reproducedOnHead !== false) {
        errors.push("a passing historical journey has reproducedOnHead false")
      }
      if (result.result === "fail" && h.reproducedOnHead !== true) {
        errors.push("a failing historical journey has reproducedOnHead true")
      }
      if (result.result === "unavailable" && h.reproducedOnHead !== null) {
        errors.push(
          "an unavailable historical journey has reproducedOnHead null"
        )
      }
    }
  }

  if (!Array.isArray(result.evidence)) errors.push("evidence must be an array")
  else {
    result.evidence.forEach((item, index) => {
      const at = `evidence[${index}]`
      if (!isObject(item)) return errors.push(`${at} must be an object`)
      unknownKeys(item, ["kind", "path", "description"], `${at}.`, errors)
      if (!KINDS.includes(item.kind))
        errors.push(`${at}.kind must be one of ${KINDS.join(", ")}`)
      if (!nonEmpty(item.description))
        errors.push(`${at}.description is required`)
      if (!nonEmpty(item.path)) return errors.push(`${at}.path is required`)
      const path = normalize(item.path)
      if (isAbsolute(item.path) || path.split(sep).includes("..")) {
        return errors.push(
          `${at}.path must be relative to the results directory`
        )
      }
      if (FORBIDDEN_EVIDENCE.test(item.path)) {
        return errors.push(
          `${at}.path: traces, cookies and status files are not kept as evidence`
        )
      }
      if (!resultsDir) return
      const full = join(resultsDir, path)
      if (!existsSync(full) || !statSync(full).isFile()) {
        return errors.push(`${at}.path ${item.path} does not exist`)
      }
      if (TEXT_EVIDENCE.test(item.path) && statSync(full).size < 5_000_000) {
        if (containsSecret(readFileSync(full, "utf8"))) {
          errors.push(`${at}.path ${item.path} contains a credential`)
        }
      }
    })
  }
  return errors
}

export function validateSummary(summary, results) {
  const errors = []
  if (!isObject(summary)) return ["summary must be an object"]
  if (summary.schema !== SUMMARY_SCHEMA)
    errors.push(`schema must be ${SUMMARY_SCHEMA}`)
  if (!nonEmpty(summary.runId)) errors.push("runId is required")
  if (
    !isObject(summary.revision) ||
    !/^[0-9a-f]{40}$/.test(summary.revision.commit ?? "")
  ) {
    errors.push("revision.commit must be a full sha")
  }
  if (typeof summary.revision?.dirty !== "boolean")
    errors.push("revision.dirty must be a boolean")
  if (!Array.isArray(summary.journeys))
    return [...errors, "journeys must be an array"]
  const totals = { pass: 0, fail: 0, unavailable: 0 }
  for (const entry of summary.journeys) {
    const match = results.find((r) => r.journey === entry.journey)
    if (!match)
      errors.push(`summary lists ${entry.journey} but has no journey file`)
    else if (match.result !== entry.result)
      errors.push(`summary and file disagree for ${entry.journey}`)
  }
  for (const r of results) {
    if (RESULTS.includes(r.result)) totals[r.result]++
    if (!summary.journeys.some((e) => e.journey === r.journey)) {
      errors.push(`journey file ${r.journey} is missing from the summary`)
    }
  }
  for (const key of RESULTS) {
    if (summary.totals?.[key] !== totals[key])
      errors.push(`totals.${key} does not match the journeys`)
  }
  return errors
}

/** Validates every file of a run directory; returns { errors, results }. */
export function validateRunDir(dir) {
  const errors = []
  const results = []
  const journeysDir = join(dir, "journeys")
  const files = existsSync(journeysDir)
    ? readdirSync(journeysDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : []
  if (files.length === 0) errors.push("no journeys/<id>.json files")
  for (const file of files) {
    let result
    try {
      result = JSON.parse(readFileSync(join(journeysDir, file), "utf8"))
    } catch (error) {
      errors.push(`journeys/${file}: ${error.message}`)
      continue
    }
    results.push(result)
    if (file !== `${result.journey}.json`)
      errors.push(`journeys/${file}: file name must be <journey>.json`)
    for (const problem of validateResult(result, { resultsDir: dir })) {
      errors.push(`journeys/${file}: ${problem}`)
    }
  }
  for (const name of ["summary.json", "summary.md"]) {
    if (!existsSync(join(dir, name))) errors.push(`${name} is missing`)
  }
  if (existsSync(join(dir, "summary.json"))) {
    try {
      const summary = JSON.parse(
        readFileSync(join(dir, "summary.json"), "utf8")
      )
      errors.push(
        ...validateSummary(summary, results).map((e) => `summary.json: ${e}`)
      )
    } catch (error) {
      errors.push(`summary.json: ${error.message}`)
    }
  }
  return { errors, results }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2]
  if (!dir) {
    console.error("usage: validate.mjs <results-dir>")
    process.exit(2)
  }
  const { errors, results } = validateRunDir(dir)
  if (errors.length) {
    console.error(errors.map((e) => `invalid: ${e}`).join("\n"))
    process.exit(1)
  }
  console.log(`valid: ${results.length} journey result(s) in ${dir}`)
}
