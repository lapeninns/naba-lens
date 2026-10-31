import { randomUUID } from "node:crypto"

import type { ArchiveStore } from "../../../lib/server/archive/core"

import type { World } from "./world"

export type AuditOutcome =
  "completed_cycle" | "partial" | "locked" | "timeout" | "lease_lost" | "failed"

export type AuditReport = {
  outcome: AuditOutcome
  complete: boolean
  checked: number
  copied: number
  missing: number | null
  bytesVerified: number
  error: string | null
  cursorFrom: number | null
  cursorTo: number | null
}

export type AuditOptions = {
  store?: ArchiveStore
  archive?: (
    service: unknown,
    assetId: string,
    signal: AbortSignal
  ) => Promise<void>
  lease?: {
    acquire(holder: string, ttlSeconds: number): Promise<boolean>
    release(holder: string): Promise<void>
  }
  now?: () => number
  signal?: AbortSignal
  deadlineMs?: number
  softBudgetMs?: number
  checkpointEvery?: number
  fetchSize?: number
  cycleMinSpacingMs?: number
  concurrency?: number
  backfillLimit?: number
  leaseTtlSeconds?: number
  randomId?: () => string
}

export type AuditModule = {
  runArchiveAudit(
    service: unknown,
    options?: AuditOptions
  ): Promise<AuditReport>
  archiveStatus(
    service: unknown,
    now?: number
  ): Promise<Record<string, unknown>>
  ARCHIVE_MAX_AGE_MS: number
  ARCHIVE_AUDIT_INTERVAL_SECONDS: number
  ARCHIVE_AUDIT_CHECKPOINT_EVERY: number
  ARCHIVE_AUDIT_CONCURRENCY: number
  ARCHIVE_AUDIT_BACKFILL_LIMIT: number
  ARCHIVE_AUDIT_SOFT_BUDGET_MS: number
  ARCHIVE_AUDIT_DEADLINE_MS: number
  ARCHIVE_AUDIT_LEASE_TTL_SECONDS: number
  ARCHIVE_AUDIT_FETCH_SIZE: number
  ARCHIVE_AUDIT_CYCLE_MIN_SPACING_MS: number
  ARCHIVE_AUDIT_RUN_RETENTION_DAYS: number
}

/** Allowed `last_error` / run `error` codes (contract §4.2). */
export const ERROR_CODES = [
  "archive_audit_failed",
  "archive_audit_timeout",
  "archive_lease_lost",
  "archive_checkpoint_failed",
  "archive_store_unavailable",
  "archive_source_unavailable",
] as const

export const HARD_DEADLINE_MS = 540_000

/**
 * Loads the audit module, or null while it still predates the contract (no
 * injectable options / constants). Suites use this to skip themselves until
 * Audit's branch is merged, then run unchanged.
 */
export async function loadAudit(): Promise<AuditModule | null> {
  const loaded =
    (await import("@/lib/server/archive/audit")) as unknown as Partial<AuditModule>
  return typeof loaded.ARCHIVE_AUDIT_CHECKPOINT_EVERY === "number"
    ? (loaded as AuditModule)
    : null
}

/**
 * One audit invocation against `world`, with the test clock, an injected
 * per-invocation store view bound to the hard-deadline signal, and the
 * bucket-backed backfill. Time only passes through the clock, so the run is
 * driven to completion with `clock.drive`.
 */
export function startAudit(
  audit: AuditModule,
  world: World,
  options: AuditOptions & { service?: unknown } = {}
) {
  const { service = world.service, ...rest } = options
  const signal =
    rest.signal ?? world.clock.deadline(rest.deadlineMs ?? HARD_DEADLINE_MS)
  return audit.runArchiveAudit(service, {
    store: world.bucket.store(signal),
    archive: (_service, assetId, assetSignal) =>
      world.archiveAsset(assetId, assetSignal),
    now: world.clock.now,
    signal,
    randomId: randomUUID,
    ...rest,
  })
}

export function runAudit(
  audit: AuditModule,
  world: World,
  options: AuditOptions & { service?: unknown } = {}
) {
  return world.clock.drive(startAudit(audit, world, options))
}

/** Invoke until a cycle completes (or give up), returning every report. */
export async function runCycle(
  audit: AuditModule,
  world: World,
  options: AuditOptions = {},
  maxRuns = 50
) {
  const reports: AuditReport[] = []
  for (let i = 0; i < maxRuns; i++) {
    const report = await runAudit(audit, world, options)
    reports.push(report)
    if (report.outcome === "completed_cycle") break
    if (report.outcome === "failed" || report.outcome === "timeout") break
  }
  return reports
}

/** Receipt ids whose original and manifest were each read back at least once. */
export function verifiedReceiptIds(world: World) {
  const receipts = world.db.rows("media_archive_receipts")
  const read = (op: "verifyOriginal" | "verifyManifest", column: string) =>
    new Set(
      world.bucket
        .callsTo(op)
        .filter((call) => call.outcome === "ok")
        .map((call) => call.key)
        .flatMap((key) =>
          receipts.filter((r) => r[column] === key).map((r) => r.id as number)
        )
    )
  const originals = read("verifyOriginal", "blob_key")
  const manifests = read("verifyManifest", "manifest_key")
  return [...originals].filter((id) => manifests.has(id)).sort((a, b) => a - b)
}
