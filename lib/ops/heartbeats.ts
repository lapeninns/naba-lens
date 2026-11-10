/**
 * B10-01c job receipts (b10-design §3.1): the closed vocabulary of the shared
 * heartbeat that each scheduled route appends to private.ops_job_runs, and
 * the pure checks the server writer applies before it calls the database.
 * Migration 20261110220000_b10m1_ops_metrics.sql enforces the same lists.
 *
 * A receipt carries IDs, a closed outcome and error code, and bounded
 * aggregate counts only. coverage_preparation_runs and
 * media_archive_audit_runs stay the detailed records for their jobs.
 */

import type { ArchiveAuditReport } from "@/lib/server/archive/audit"
import type { CleanupReport } from "@/lib/server/lifecycle/cleanup"

export const OPS_JOBS = [
  "cleanup",
  "media_archive",
  "archive_watchdog",
  "monthly_preparation",
] as const
export type OpsJob = (typeof OPS_JOBS)[number]

/** Expected interval between runs, from the crons in vercel.json. */
export const OPS_JOB_INTERVAL_MINUTES: Readonly<Record<OpsJob, number>> = {
  cleanup: 60,
  media_archive: 10,
  archive_watchdog: 5,
  monthly_preparation: 60,
}

/** M-JB-1: a job breaches after this many intervals without an ok run. */
export const HEARTBEAT_BREACH_INTERVALS = 2

export const OPS_JOB_OUTCOMES = ["ok", "failed", "partial"] as const
export type OpsJobOutcome = (typeof OPS_JOB_OUTCOMES)[number]

/** Route-controlled failure identities; never a provider code or SQLSTATE. */
export const OPS_JOB_ERROR_CODES = {
  cleanup: ["cleanup_failed"],
  media_archive: [
    "archive_audit_failed",
    "archive_audit_timeout",
    "archive_lease_lost",
  ],
  archive_watchdog: ["watchdog_unavailable", "watchdog_failed"],
  monthly_preparation: ["preparation_failed"],
} as const satisfies Record<OpsJob, readonly string[]>
export type OpsJobErrorCode<J extends OpsJob = OpsJob> =
  (typeof OPS_JOB_ERROR_CODES)[J][number]

/** Only monthly preparation reports some venues done and some failed. */
export const OPS_JOB_PARTIAL: Readonly<Record<OpsJob, boolean>> = {
  cleanup: false,
  media_archive: false,
  archive_watchdog: false,
  monthly_preparation: true,
}

/** Allowed count fields per job: every value is a bounded integer. */
export const OPS_JOB_COUNT_FIELDS = {
  cleanup: [
    "reaped_assets",
    "removed_assets",
    "removed_objects",
    "failed_assets",
  ],
  media_archive: ["checked", "copied", "missing", "bytes_verified"],
  archive_watchdog: ["delivered"],
  monthly_preparation: [
    "succeeded_runs",
    "failed_runs",
    "staff_considered",
    "targets_copied",
    "placeholders_created",
    "already_present",
    "candidates_added",
  ],
} as const satisfies Record<OpsJob, readonly string[]>
export type OpsJobCountField<J extends OpsJob = OpsJob> =
  (typeof OPS_JOB_COUNT_FIELDS)[J][number]

/** Integer counts stay within int4; verified bytes may need the full safe range. */
export const OPS_COUNT_MAX = 2_147_483_647
export const OPS_BYTES_MAX = Number.MAX_SAFE_INTEGER
export const opsCountMax = (field: string) =>
  field === "bytes_verified" ? OPS_BYTES_MAX : OPS_COUNT_MAX

export type OpsJobCounts = Partial<Record<string, number>>

/** The terminal result a route reports; the writer adds identity and times. */
export type OpsJobResult =
  | { outcome: "ok"; errorCode?: null; counts?: OpsJobCounts }
  | {
      outcome: "failed" | "partial"
      errorCode: string
      counts?: OpsJobCounts
    }

/** Exactly the arguments of public.ops_record_job_run. */
export type OpsJobRunArgs = {
  p_run_id: string
  p_job: OpsJob
  p_started_at: string
  p_finished_at: string
  p_outcome: OpsJobOutcome
  p_counts: Record<string, number>
  p_error_code: string | null
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const isJob = (value: unknown): value is OpsJob =>
  typeof value === "string" && (OPS_JOBS as readonly string[]).includes(value)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype

/**
 * Builds the writer arguments, or null when anything is outside the closed
 * vocabulary: an unknown job, outcome, code or count key, a nested or
 * non-integer count, a reversed time or an ok run with an error code. Nothing
 * from the input is copied unless it passed its check.
 */
export function jobRunArgs(input: {
  runId: unknown
  job: unknown
  startedAt: unknown
  finishedAt: unknown
  result: unknown
}): OpsJobRunArgs | null {
  const { runId, job, startedAt, finishedAt, result } = input
  if (typeof runId !== "string" || !UUID.test(runId)) return null
  if (!isJob(job)) return null
  if (typeof startedAt !== "string" || !UTC_ISO.test(startedAt)) return null
  if (typeof finishedAt !== "string" || !UTC_ISO.test(finishedAt)) return null
  const started = Date.parse(startedAt)
  const finished = Date.parse(finishedAt)
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return null
  if (new Date(started).toISOString() !== startedAt) return null
  if (new Date(finished).toISOString() !== finishedAt) return null
  if (finished < started) return null
  if (!isPlainObject(result)) return null
  for (const key of Object.keys(result))
    if (key !== "outcome" && key !== "errorCode" && key !== "counts")
      return null
  const outcome = result.outcome
  if (
    typeof outcome !== "string" ||
    !(OPS_JOB_OUTCOMES as readonly string[]).includes(outcome)
  )
    return null
  if (outcome === "partial" && !OPS_JOB_PARTIAL[job]) return null
  const errorCode = result.errorCode ?? null
  if (outcome === "ok") {
    if (errorCode !== null) return null
  } else if (
    typeof errorCode !== "string" ||
    !(OPS_JOB_ERROR_CODES[job] as readonly string[]).includes(errorCode)
  )
    return null
  const counts = result.counts ?? {}
  if (!isPlainObject(counts)) return null
  const allowed: readonly string[] = OPS_JOB_COUNT_FIELDS[job]
  const clean: Record<string, number> = {}
  for (const [key, value] of Object.entries(counts)) {
    if (!allowed.includes(key)) return null
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > opsCountMax(key)
    )
      return null
    clean[key] = value
  }
  return {
    p_run_id: runId,
    p_job: job,
    p_started_at: startedAt,
    p_finished_at: finishedAt,
    p_outcome: outcome as OpsJobOutcome,
    p_counts: clean,
    p_error_code: errorCode,
  }
}

// --- What each route reports -------------------------------------------------

const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined

/** Drops unavailable fields instead of filling them in. */
function known(fields: Record<string, number | undefined>): OpsJobCounts {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  )
}

/** Cleanup: a lease skip is a healthy run; any failed removal is a failure. */
export function cleanupResult(report: CleanupReport): OpsJobResult {
  if (report.status !== "completed") return { outcome: "ok", counts: {} }
  const counts = known({
    reaped_assets: count(report.reaped.assetIds.length),
    removed_assets: count(report.removed.assets),
    removed_objects: count(report.removed.objects),
    failed_assets: count(report.failed.length),
  })
  return report.failed.length > 0
    ? { outcome: "failed", errorCode: "cleanup_failed", counts }
    : { outcome: "ok", counts }
}

const ARCHIVE_HEALTHY: readonly string[] = [
  "completed_cycle",
  "partial",
  "locked",
  "idle",
]

/**
 * Media archive: completed, partial, locked and idle invocations are healthy
 * (a cycle spans invocations). Timeout and lease loss keep their own codes.
 */
export function archiveAuditResult(report: ArchiveAuditReport): OpsJobResult {
  const counts = known({
    checked: count(report.checked),
    copied: count(report.copied),
    missing: count(report.missing),
    bytes_verified: count(report.bytesVerified),
  })
  if (ARCHIVE_HEALTHY.includes(report.outcome)) return { outcome: "ok", counts }
  const errorCode =
    report.outcome === "timeout"
      ? "archive_audit_timeout"
      : report.outcome === "lease_lost"
        ? "archive_lease_lost"
        : "archive_audit_failed"
  return { outcome: "failed", errorCode, counts }
}

/** Archive watchdog: a stopped monitor is reported as unavailable. */
export function watchdogResult(report: {
  ok: boolean
  delivered: number
}): OpsJobResult {
  const counts = known({ delivered: count(report.delivered) })
  return report.ok
    ? { outcome: "ok", counts }
    : { outcome: "failed", errorCode: "watchdog_unavailable", counts }
}

type PreparationRunCounts = {
  status: string
  staffConsidered: number
  targetsCopied: number
  placeholdersCreated: number
  alreadyPresent: number
  candidatesAdded: number
}

/** Monthly preparation: some venues failed and some succeeded is partial. */
export function monthlyPreparationResult(
  runs: readonly PreparationRunCounts[]
): OpsJobResult {
  const sum = (pick: (run: PreparationRunCounts) => number) => {
    let total = 0
    for (const run of runs) {
      const value = count(pick(run))
      if (value === undefined) return undefined
      total += value
    }
    return total <= OPS_COUNT_MAX ? total : undefined
  }
  const succeeded = runs.filter((r) => r.status === "succeeded").length
  const failed = runs.filter((r) => r.status === "failed").length
  const counts = known({
    succeeded_runs: succeeded,
    failed_runs: failed,
    staff_considered: sum((r) => r.staffConsidered),
    targets_copied: sum((r) => r.targetsCopied),
    placeholders_created: sum((r) => r.placeholdersCreated),
    already_present: sum((r) => r.alreadyPresent),
    candidates_added: sum((r) => r.candidatesAdded),
  })
  if (failed === 0) return { outcome: "ok", counts }
  return {
    outcome: succeeded > 0 ? "partial" : "failed",
    errorCode: "preparation_failed",
    counts,
  }
}

// --- M-JB-1 heartbeat --------------------------------------------------------

export type HeartbeatState = "ok" | "breach" | "no_evidence"

/**
 * M-JB-1 for one job at a fixed clock. Without any ok run there is no
 * evidence either way: it is neither healthy nor a claimed missed run.
 */
export function heartbeatState(
  job: OpsJob,
  lastOkAt: string | null,
  now: Date
): { state: HeartbeatState; intervalsSinceOk: number | null } {
  if (lastOkAt === null) return { state: "no_evidence", intervalsSinceOk: null }
  const last = Date.parse(lastOkAt)
  if (!Number.isFinite(last))
    return { state: "no_evidence", intervalsSinceOk: null }
  const elapsed = Math.max(0, now.getTime() - last)
  const intervals = elapsed / (OPS_JOB_INTERVAL_MINUTES[job] * 60_000)
  return {
    state: intervals > HEARTBEAT_BREACH_INTERVALS ? "breach" : "ok",
    intervalsSinceOk: intervals,
  }
}
