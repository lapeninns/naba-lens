/**
 * Reads the output of private.ops_metrics (B10-m1). The function returns a
 * closed structure: IDs, counts, ages in seconds, UTC timestamps, closed
 * states and venue UUIDs. This parser accepts exactly that structure and
 * nothing else, so an unexpected key, a nested payload or a string where a
 * count belongs is a contract breach rather than something shown.
 *
 * Each catalogue metric is a value, "not available" with a closed reason, or
 * "not measured" (log-only, OD-B10-4). The S2 coverage below is fixed: a
 * snapshot that reports a value for a metric without a source in this slice
 * is a breach too, so "not available" can never be read as 0.
 */

import {
  HEARTBEAT_BREACH_INTERVALS,
  OPS_JOB_ERROR_CODES,
  OPS_JOB_INTERVAL_MINUTES,
  OPS_JOB_OUTCOMES,
  OPS_JOBS,
  heartbeatState,
  type HeartbeatState,
  type OpsJob,
  type OpsJobOutcome,
} from "@/lib/ops/heartbeats"
import { METRICS } from "@/lib/ops/metrics"

export const OPS_METRICS_CONTRACT = "b10.ops_metrics.v1"

export const UNAVAILABLE_REASONS = [
  /** The source batch is not released. */
  "source_unreleased",
  /** A released B01 source this slice does not read. */
  "not_in_slice",
  /** The exact history the metric needs is not recorded (M-UP-4). */
  "missing_history",
  /** Only the independent archive checker reads it (M-JB-4). */
  "external_checker",
  /** It comes from the observation log, not the database (M-AD-3). */
  "external_record",
] as const
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]

export const NOT_MEASURED_REASONS = ["log_source_missing"] as const
export type NotMeasuredReason = (typeof NOT_MEASURED_REASONS)[number]

/** M-UP-4's missing sources: when each asset failed, and every finalisation. */
export const M_UP_4_MISSING = [
  "failed_transition_history",
  "finalisation_history",
] as const

type Coverage =
  | { kind: "available" | "partial" }
  | { kind: "not_available"; reason: UnavailableReason }
  | { kind: "not_measured"; reason: NotMeasuredReason }

const computed: Coverage = { kind: "available" }
const unreleased: Coverage = {
  kind: "not_available",
  reason: "source_unreleased",
}
const notInSlice: Coverage = { kind: "not_available", reason: "not_in_slice" }
const logOnly: Coverage = { kind: "not_measured", reason: "log_source_missing" }

/** What B10 S2 computes for every catalogue metric (b10-design §14.3). */
export const S2_METRIC_COVERAGE: Readonly<Record<string, Coverage>> = {
  "M-JB-1": computed,
  "M-JB-2": computed,
  "M-JB-3": computed,
  "M-JB-4": { kind: "not_available", reason: "external_checker" },
  "M-JB-5": unreleased,
  "M-JB-6": unreleased,
  "M-UP-1": computed,
  "M-UP-2": computed,
  "M-UP-3": computed,
  "M-UP-4": { kind: "not_available", reason: "missing_history" },
  "M-UP-5": computed,
  "M-UP-6": computed,
  "M-UP-7": logOnly,
  "M-KN-1": unreleased,
  "M-KN-2": unreleased,
  "M-KN-3": unreleased,
  "M-KN-4": unreleased,
  "M-KN-5": unreleased,
  "M-KN-6": notInSlice,
  "M-RV-1": notInSlice,
  "M-RV-2": unreleased,
  "M-RV-3": computed,
  "M-RV-4": unreleased,
  "M-RV-5": unreleased,
  "M-DL-1": unreleased,
  "M-DL-2": unreleased,
  "M-DL-3": unreleased,
  "M-DL-4": unreleased,
  "M-DL-5": unreleased,
  "M-DL-6": logOnly,
  "M-DL-7": unreleased,
  "M-DL-8": unreleased,
  "M-WD-1": unreleased,
  "M-WD-2": unreleased,
  "M-WD-3": unreleased,
  "M-WD-4": { kind: "partial" },
  "M-WD-5": unreleased,
  "M-AI-1": unreleased,
  "M-AI-2": unreleased,
  "M-AI-3": unreleased,
  "M-AI-4": unreleased,
  "M-AD-1": notInSlice,
  "M-AD-2": notInSlice,
  "M-AD-3": { kind: "not_available", reason: "external_record" },
}

// --- Shapes ------------------------------------------------------------------

type Shape =
  | "count"
  | "countOrNull"
  | "time"
  | "timeOrNull"
  | "uuid"
  | "uuidOrNull"
  | "month"
  | { oneOf: readonly (string | null)[] }
  | { object: Readonly<Record<string, Shape>> }
  | { list: Shape }

const COUNT_MAX = Number.MAX_SAFE_INTEGER
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const UTC_MICROS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const MONTH = /^\d{4}-\d{2}-01$/

const object = (fields: Record<string, Shape>): Shape => ({ object: fields })
const list = (item: Shape): Shape => ({ list: item })
const oneOf = (...values: (string | null)[]): Shape => ({ oneOf: values })
const venues = (fields: Record<string, Shape>) =>
  list(object({ venueId: "uuid", ...fields }))
const ages = { count: "count", oldestAgeSeconds: "countOrNull" } as const

const ALL_ERROR_CODES = [...new Set(Object.values(OPS_JOB_ERROR_CODES).flat())]

const SHAPES: Readonly<Record<string, Shape>> = {
  "M-JB-1": object({
    availability: oneOf("available"),
    scope: oneOf("global"),
    jobs: list(
      object({
        job: oneOf(...OPS_JOBS),
        intervalMinutes: "count",
        lastOkAt: "timeOrNull",
        secondsSinceOk: "countOrNull",
        state: oneOf("ok", "breach", "no_evidence"),
      })
    ),
  }),
  "M-JB-2": object({
    availability: oneOf("available"),
    scope: oneOf("global"),
    jobs: list(
      object({
        job: oneOf(...OPS_JOBS),
        failed24h: "count",
        partial24h: "count",
        consecutiveFailures: "count",
        lastOutcome: oneOf(...OPS_JOB_OUTCOMES, null),
        lastErrorCode: oneOf(...ALL_ERROR_CODES, null),
        lastFinishedAt: "timeOrNull",
      })
    ),
  }),
  "M-JB-3": object({
    availability: oneOf("available"),
    scope: oneOf("venue"),
    period: "month",
    successDueAt: "time",
    lastSuccessAt: "timeOrNull",
    venuesMissingTargets: "count",
    venues: venues({ staffWithoutTarget: "count" }),
  }),
  "M-UP-1": object({
    availability: oneOf("available"),
    scope: oneOf("venue"),
    totals: object({
      uploading: "count",
      processing: "count",
      ready: "count",
      failed: "count",
    }),
    venues: venues({
      uploading: "count",
      processing: "count",
      ready: "count",
      failed: "count",
    }),
  }),
  "M-UP-2": object({
    availability: oneOf("available"),
    scope: oneOf("venue"),
    total: "count",
    venues: venues(ages),
  }),
  "M-UP-3": object({
    availability: oneOf("available"),
    scope: oneOf("venue"),
    total: "count",
    venues: venues(ages),
  }),
  "M-UP-4": object({
    availability: oneOf("not_available"),
    reason: oneOf("missing_history"),
    missing: list(oneOf(...M_UP_4_MISSING)),
  }),
  "M-UP-5": object({
    availability: oneOf("available"),
    scope: oneOf("venue"),
    totals: object({ count: "count", olderThan24h: "count" }),
    venues: venues({ ...ages, olderThan24h: "count" }),
  }),
  "M-UP-6": object({
    availability: oneOf("available"),
    scope: oneOf("venue"),
    totals: object({
      needsAttention: "count",
      needsAttentionOlderThan7d: "count",
      stalePending: "count",
    }),
    venues: venues({
      needsAttention: "count",
      needsAttentionOlderThan7d: "count",
      oldestNeedsAttentionAgeSeconds: "countOrNull",
      stalePending: "count",
      oldestStalePendingAgeSeconds: "countOrNull",
    }),
  }),
  "M-RV-3": object({
    availability: oneOf("available"),
    scope: oneOf("venue"),
    total: "count",
    venues: venues(ages),
  }),
  "M-WD-4": object({
    availability: oneOf("partial"),
    scope: oneOf("venue"),
    parts: object({
      amenity_evidence_lost: object({
        availability: oneOf("available"),
        totals: object({ events: "count", checks: "count" }),
        venues: venues({ events: "count", checks: "count" }),
      }),
      knowledge_evidence_withdrawn: object({
        availability: oneOf("not_available"),
        reason: oneOf("not_in_slice"),
      }),
    }),
  }),
}

function shapeFor(id: string): Shape {
  const shape = SHAPES[id]
  if (shape) return shape
  const coverage = S2_METRIC_COVERAGE[id]
  if (coverage?.kind === "not_available" || coverage?.kind === "not_measured")
    return object({
      availability: oneOf(coverage.kind),
      reason: oneOf(coverage.reason),
    })
  throw new OpsMetricsContractError()
}

const SNAPSHOT_SHAPE = object({
  contract: oneOf(OPS_METRICS_CONTRACT),
  asOf: "time",
  venueId: "uuidOrNull",
  metrics: object(
    Object.fromEntries(
      METRICS.map((metric) => [metric.id, shapeFor(metric.id)])
    )
  ),
})

/** Names no value from the rejected input. */
export class OpsMetricsContractError extends Error {
  constructor() {
    super("ops_metrics_contract_breach")
    this.name = "OpsMetricsContractError"
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype

function matches(value: unknown, shape: Shape): boolean {
  switch (shape) {
    case "count":
      return (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= COUNT_MAX
      )
    case "countOrNull":
      return value === null || matches(value, "count")
    case "time":
      return (
        typeof value === "string" &&
        UTC_MICROS.test(value) &&
        Number.isFinite(Date.parse(value))
      )
    case "timeOrNull":
      return value === null || matches(value, "time")
    case "uuid":
      return typeof value === "string" && UUID.test(value)
    case "uuidOrNull":
      return value === null || matches(value, "uuid")
    case "month":
      return typeof value === "string" && MONTH.test(value)
  }
  if ("oneOf" in shape) return shape.oneOf.includes(value as string | null)
  if ("list" in shape)
    return (
      Array.isArray(value) && value.every((item) => matches(item, shape.list))
    )
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  const expected = Object.keys(shape.object)
  return (
    keys.length === expected.length &&
    expected.every(
      (key) =>
        Object.hasOwn(value, key) && matches(value[key], shape.object[key])
    )
  )
}

// --- Parsed types --------------------------------------------------------------

export type JobHeartbeatEntry = {
  job: OpsJob
  intervalMinutes: number
  lastOkAt: string | null
  secondsSinceOk: number | null
  state: HeartbeatState
}

export type JobFailureEntry = {
  job: OpsJob
  failed24h: number
  partial24h: number
  consecutiveFailures: number
  lastOutcome: OpsJobOutcome | null
  lastErrorCode: string | null
  lastFinishedAt: string | null
}

/** A metric with a value: its fields are those of its shape above. */
export type AvailableEntry = {
  availability: "available" | "partial"
  scope: "global" | "venue"
  [field: string]: unknown
}

export type MetricEntry =
  | AvailableEntry
  | {
      availability: "not_available"
      reason: UnavailableReason
      missing?: string[]
    }
  | { availability: "not_measured"; reason: NotMeasuredReason }

export type OpsMetricsSnapshot = {
  contract: typeof OPS_METRICS_CONTRACT
  asOf: string
  venueId: string | null
  metrics: Readonly<Record<string, MetricEntry>> & {
    "M-JB-1": {
      availability: "available"
      scope: "global"
      jobs: JobHeartbeatEntry[]
    }
    "M-JB-2": {
      availability: "available"
      scope: "global"
      jobs: JobFailureEntry[]
    }
  }
}

/**
 * Accepts exactly the ops_metrics contract. Throws OpsMetricsContractError on
 * any other key, type or value, on a job list that is not the four jobs in
 * order with their schedule intervals, or on a heartbeat state that the
 * as-of clock and last ok time do not give.
 */
export function parseOpsMetrics(value: unknown): OpsMetricsSnapshot {
  if (!matches(value, SNAPSHOT_SHAPE)) throw new OpsMetricsContractError()
  const snapshot = value as OpsMetricsSnapshot
  const asOf = new Date(snapshot.asOf)
  for (const id of ["M-JB-1", "M-JB-2"] as const) {
    const jobs = snapshot.metrics[id].jobs.map((entry) => entry.job)
    if (jobs.join() !== OPS_JOBS.join()) throw new OpsMetricsContractError()
  }
  for (const entry of snapshot.metrics["M-JB-1"].jobs) {
    if (entry.intervalMinutes !== OPS_JOB_INTERVAL_MINUTES[entry.job])
      throw new OpsMetricsContractError()
    if ((entry.lastOkAt === null) !== (entry.secondsSinceOk === null))
      throw new OpsMetricsContractError()
    // The database keeps microseconds and Date milliseconds, so a reading
    // within a millisecond of the breach line may fall either side.
    const boundary =
      entry.lastOkAt !== null &&
      Math.abs(
        asOf.getTime() -
          Date.parse(entry.lastOkAt) -
          HEARTBEAT_BREACH_INTERVALS * entry.intervalMinutes * 60_000
      ) <= 1
    if (
      !boundary &&
      heartbeatState(entry.job, entry.lastOkAt, asOf).state !== entry.state
    )
      throw new OpsMetricsContractError()
  }
  const missing = snapshot.metrics["M-UP-4"]
  if (
    missing.availability !== "not_available" ||
    (missing.missing ?? []).join() !== M_UP_4_MISSING.join()
  )
    throw new OpsMetricsContractError()
  return snapshot
}

export type MetricReading =
  | { kind: "value"; partial: boolean; entry: AvailableEntry }
  | { kind: "not_available"; reason: UnavailableReason; missing?: string[] }
  | { kind: "not_measured"; reason: NotMeasuredReason }

/** A metric's reading: a value, or why there is none. Never a default 0. */
export function readMetric(
  snapshot: OpsMetricsSnapshot,
  id: string
): MetricReading {
  const entry = snapshot.metrics[id]
  if (!entry) throw new OpsMetricsContractError()
  if (entry.availability === "not_available")
    return {
      kind: "not_available",
      reason: entry.reason,
      ...(entry.missing ? { missing: [...entry.missing] } : {}),
    }
  if (entry.availability === "not_measured")
    return { kind: "not_measured", reason: entry.reason }
  return { kind: "value", partial: entry.availability === "partial", entry }
}
