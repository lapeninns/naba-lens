/**
 * B10-04 observation logs (b10-design §6.1, B10-04b). One file per venue, one
 * row per observed ordinary contribution attempt. Rows hold role kinds and
 * outcomes, never names. M-AD-3 is computed from them.
 */

import {
  isIsoDate,
  isObject,
  personalDataProblems,
  type LintProblem,
  type RosterVenue,
} from "./roster"

export const OBSERVATIONS_SCHEMA = "b10-observations/1"
export const ROLE_KINDS = [
  "kitchen",
  "bar",
  "service",
  "venue_manager",
  "admin",
] as const
export const TASK_TYPES = [
  "capture",
  "finding",
  "confirmation",
  "correction",
  "recheck",
  "review",
] as const
export const OUTCOMES = ["completed", "abandoned", "failed"] as const
export const EVIDENCE_TYPES = ["F", "E", "D", "P", "H", "S"] as const

export type ObservationRow = {
  date: string
  roleKind: (typeof ROLE_KINDS)[number]
  taskType: (typeof TASK_TYPES)[number]
  outcome: (typeof OUTCOMES)[number]
  helpNeeded: boolean
  evidenceType: (typeof EVIDENCE_TYPES)[number]
  frictionNote?: string
}

export type ObservationLog = {
  schema: typeof OBSERVATIONS_SCHEMA
  venueId: string
  rows: ObservationRow[]
}

export function emptyObservationLog(venueId: string): ObservationLog {
  return { schema: OBSERVATIONS_SCHEMA, venueId, rows: [] }
}

/** M-AD-3: completed without implementer help, as a share of observed attempts. */
export function observedCompletion(rows: readonly ObservationRow[]): {
  value: number
  sample: number
} {
  const sample = rows.length
  const done = rows.filter((r) => r.outcome === "completed" && !r.helpNeeded)
  return { value: sample === 0 ? 0 : (done.length / sample) * 100, sample }
}

const ROW_KEYS = new Set([
  "date",
  "roleKind",
  "taskType",
  "outcome",
  "helpNeeded",
  "evidenceType",
  "frictionNote",
])

const oneOf = (list: readonly string[], v: unknown) =>
  typeof v === "string" && list.includes(v)

export function lintObservationLog(
  log: unknown,
  roster: readonly RosterVenue[],
  fileVenueId?: string
): LintProblem[] {
  if (!isObject(log)) return [{ path: "$", message: "is not an object" }]
  const problems: LintProblem[] = []
  if (Object.keys(log).sort().join(",") !== "rows,schema,venueId")
    problems.push({ path: "$", message: "keys must be rows, schema, venueId" })
  if (log.schema !== OBSERVATIONS_SCHEMA)
    problems.push({
      path: "$.schema",
      message: `must be ${OBSERVATIONS_SCHEMA}`,
    })
  if (!roster.some((v) => v.id === log.venueId))
    problems.push({ path: "$.venueId", message: "is not in the roster" })
  if (fileVenueId !== undefined && fileVenueId !== log.venueId)
    problems.push({
      path: "$.venueId",
      message: "does not match the file name",
    })
  if (!Array.isArray(log.rows)) {
    problems.push({ path: "$.rows", message: "is not a list" })
    return problems
  }
  log.rows.forEach((row: unknown, i: number) => {
    const path = `$.rows[${i}]`
    if (!isObject(row)) {
      problems.push({ path, message: "is not an object" })
      return
    }
    for (const key of Object.keys(row))
      if (!ROW_KEYS.has(key))
        problems.push({
          path: `${path}.${key}`,
          message: "is not an allowed column",
        })
    if (!isIsoDate(row.date))
      problems.push({ path: `${path}.date`, message: "must be YYYY-MM-DD" })
    if (!oneOf(ROLE_KINDS, row.roleKind))
      problems.push({ path: `${path}.roleKind`, message: "is not a role kind" })
    if (!oneOf(TASK_TYPES, row.taskType))
      problems.push({ path: `${path}.taskType`, message: "is not a task type" })
    if (!oneOf(OUTCOMES, row.outcome))
      problems.push({ path: `${path}.outcome`, message: "is not an outcome" })
    if (typeof row.helpNeeded !== "boolean")
      problems.push({
        path: `${path}.helpNeeded`,
        message: "must be true or false",
      })
    if (!oneOf(EVIDENCE_TYPES, row.evidenceType))
      problems.push({
        path: `${path}.evidenceType`,
        message: "is not an evidence type",
      })
    if (
      row.frictionNote !== undefined &&
      !(typeof row.frictionNote === "string" && row.frictionNote.length <= 500)
    )
      problems.push({
        path: `${path}.frictionNote`,
        message: "must be text of 500 characters or fewer",
      })
  })
  problems.push(...personalDataProblems(log, "$"))
  return problems
}
