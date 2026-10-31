import "server-only"

import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/db/types"

import { readArchiveConfig } from "./config"
import type { ArchiveStore } from "./core"
import { ensureMediaOriginalArchived } from "./index"
import { createArchiveStore } from "./object-store"

type Service = SupabaseClient<Database>

export const ARCHIVE_MAX_AGE_MS = 26 * 60 * 60 * 1000

/**
 * Production schedule and per-invocation budget (sized from
 * `docs/archive-capacity.md`). `ARCHIVE_AUDIT_CRON` must equal the `vercel.json`
 * entry and the route's literal `maxDuration` must stay at least 60 s above the
 * hard deadline; unit tests enforce both because Next.js needs a static value.
 */
export const ARCHIVE_AUDIT_CRON = "*/10 * * * *"
export const ARCHIVE_AUDIT_INTERVAL_SECONDS = 10 * 60
/** Verifications in flight at once; workers pull continuously, no batch barrier. */
export const ARCHIVE_AUDIT_CONCURRENCY = 8
/** The cursor is checkpointed once the verified watermark advances this far. */
export const ARCHIVE_AUDIT_CHECKPOINT_EVERY = 20
/** Receipts read from the database per page while workers drain them. */
export const ARCHIVE_AUDIT_FETCH_SIZE = 100
export const ARCHIVE_AUDIT_BACKFILL_LIMIT = 5
/** After this long no new receipt is taken and the run ends `partial`. */
export const ARCHIVE_AUDIT_SOFT_BUDGET_MS = 480_000
/** Hard deadline: in-flight work is abandoned and the run ends `timeout`. */
export const ARCHIVE_AUDIT_DEADLINE_MS = 540_000
export const ARCHIVE_AUDIT_LEASE_TTL_SECONDS = 600
/** A new cycle starts only this long after the previous complete cycle started. */
export const ARCHIVE_AUDIT_CYCLE_MIN_SPACING_MS = 12 * 60 * 60 * 1000
export const ARCHIVE_AUDIT_RUN_RETENTION_DAYS = 90

const LEASE_NAME = "media_archive_audit"
const STATE_NAME = "originals"

export type ArchiveAuditOutcome =
  | "completed_cycle"
  | "partial"
  | "locked"
  | "timeout"
  | "lease_lost"
  | "failed"
  | "idle"

export type ArchiveAuditError =
  | "archive_audit_failed"
  | "archive_audit_timeout"
  | "archive_lease_lost"
  | "archive_checkpoint_failed"
  | "archive_store_unavailable"
  | "archive_source_unavailable"

const ERROR_CODES: ReadonlySet<string> = new Set<ArchiveAuditError>([
  "archive_audit_failed",
  "archive_audit_timeout",
  "archive_lease_lost",
  "archive_checkpoint_failed",
  "archive_store_unavailable",
  "archive_source_unavailable",
])

export type ArchiveLeaseClient = {
  /** True when `holder` now holds the lease; the same holder again renews it. */
  acquire(holder: string, ttlSeconds: number): Promise<boolean>
  release(holder: string): Promise<void>
}

export type ArchiveAuditOptions = {
  /** Injected stores are owned (and closed) by the caller. */
  store?: ArchiveStore
  /** Archives one ready original that has no receipt yet. */
  archive?: (
    service: Service,
    assetId: string,
    signal: AbortSignal
  ) => Promise<void>
  lease?: ArchiveLeaseClient
  now?: () => number
  signal?: AbortSignal
  deadlineMs?: number
  softBudgetMs?: number
  concurrency?: number
  checkpointEvery?: number
  fetchSize?: number
  backfillLimit?: number
  leaseTtlSeconds?: number
  cycleMinSpacingMs?: number
  randomId?: () => string
}

export type ArchiveAuditReport = {
  outcome: ArchiveAuditOutcome
  complete: boolean
  checked: number
  copied: number
  missing: number | null
  bytesVerified: number
  error: ArchiveAuditError | null
  cursorFrom: number | null
  cursorTo: number | null
}

class AuditStop extends Error {
  constructor(
    readonly outcome: "timeout" | "lease_lost" | "failed",
    readonly code: ArchiveAuditError
  ) {
    super(code)
  }
}

function codeFrom(error: unknown, fallback: ArchiveAuditError) {
  if (error instanceof AuditStop) return error.code
  const message = error instanceof Error ? error.message : ""
  return ERROR_CODES.has(message) ? (message as ArchiveAuditError) : fallback
}

/** Maps errors thrown while archiving a legacy original to a stored code. */
function backfillCode(error: unknown): ArchiveAuditError {
  const message = error instanceof Error ? error.message : ""
  if (error instanceof AuditStop || ERROR_CODES.has(message))
    return codeFrom(error, "archive_audit_failed")
  if (
    [
      "archive_source_read_failed",
      "archive_source_unavailable",
      "archive_source_mismatch",
      "archive_source_size_changed",
      "archive_asset_unavailable",
      "archive_attribution_unavailable",
    ].includes(message)
  )
    return "archive_source_unavailable"
  if (
    [
      "archive_destination_write_failed",
      "archive_manifest_write_failed",
      "archive_destination_verification_failed",
    ].includes(message)
  )
    return "archive_store_unavailable"
  return "archive_audit_failed"
}

/**
 * Settles with `work` or rejects at the hard deadline, so a store that hangs
 * and ignores its own signal still ends the run as a timeout.
 */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  const timeout = () => new AuditStop("timeout", "archive_audit_timeout")
  if (signal.aborted) {
    void work.catch(() => undefined)
    return Promise.reject(timeout())
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(timeout())
    signal.addEventListener("abort", onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      }
    )
  })
}

function rpcLeaseClient(service: Service): ArchiveLeaseClient {
  return {
    async acquire(holder, ttlSeconds) {
      const lease = await service.rpc("acquire_maintenance_lease", {
        p_name: LEASE_NAME,
        p_holder: holder,
        p_ttl: `${ttlSeconds} seconds`,
      })
      if (lease.error) throw new Error("archive_lease_failed")
      return lease.data === true
    },
    async release(holder) {
      await service.rpc("release_maintenance_lease", {
        p_name: LEASE_NAME,
        p_holder: holder,
      })
    },
  }
}

type StateRow = Pick<
  Database["public"]["Tables"]["media_archive_audit_state"]["Row"],
  | "cursor_id"
  | "cycle_id"
  | "cycle_started_at"
  | "cycle_target_id"
  | "cycle_target_count"
  | "cycle_checked"
  | "consecutive_failures"
  | "last_complete_cycle_started_at"
>
const STATE_COLUMNS =
  "cursor_id,cycle_id,cycle_started_at,cycle_target_id,cycle_target_count,cycle_checked,consecutive_failures,last_complete_cycle_started_at"

type Receipt = Database["public"]["Tables"]["media_archive_receipts"]["Row"]

/**
 * One invocation of the resumable verification cycle. Workers verify receipts
 * continuously and the cursor is checkpointed at the contiguous verified
 * watermark under a renewed lease, so a timeout or crash resumes the same cycle.
 * Every outcome is returned; it throws only before it holds the lease.
 */
export async function runArchiveAudit(
  service: Service,
  options: ArchiveAuditOptions = {}
): Promise<ArchiveAuditReport> {
  const now = options.now ?? Date.now
  const randomId = options.randomId ?? randomUUID
  const lease = options.lease ?? rpcLeaseClient(service)
  const concurrency = Math.max(
    1,
    options.concurrency ?? ARCHIVE_AUDIT_CONCURRENCY
  )
  const checkpointEvery = Math.max(
    1,
    options.checkpointEvery ?? ARCHIVE_AUDIT_CHECKPOINT_EVERY
  )
  const fetchSize = Math.max(1, options.fetchSize ?? ARCHIVE_AUDIT_FETCH_SIZE)
  const backfillLimit = options.backfillLimit ?? ARCHIVE_AUDIT_BACKFILL_LIMIT
  const softBudgetMs = options.softBudgetMs ?? ARCHIVE_AUDIT_SOFT_BUDGET_MS
  const leaseTtl = options.leaseTtlSeconds ?? ARCHIVE_AUDIT_LEASE_TTL_SECONDS
  const spacingMs =
    options.cycleMinSpacingMs ?? ARCHIVE_AUDIT_CYCLE_MIN_SPACING_MS
  const archive =
    options.archive ??
    ((client, assetId, signal) =>
      ensureMediaOriginalArchived(client, assetId, undefined, signal))
  const config = options.store ? null : readArchiveConfig()
  if (!options.store && !config) throw new Error("archive_disabled")

  const signal =
    options.signal ??
    AbortSignal.timeout(options.deadlineMs ?? ARCHIVE_AUDIT_DEADLINE_MS)
  const holder = randomId()
  const runId = randomId()
  const startedMs = now()
  const iso = (ms = now()) => new Date(ms).toISOString()

  let acquired: boolean
  try {
    acquired = await lease.acquire(holder, leaseTtl)
  } catch {
    throw new Error("archive_lease_failed")
  }

  const run = {
    outcome: "locked" as ArchiveAuditOutcome,
    error: null as ArchiveAuditError | null,
    checked: 0,
    copied: 0,
    missing: null as number | null,
    bytesVerified: 0,
    cycleId: null as string | null,
    cursorFrom: null as number | null,
    cursorTo: null as number | null,
  }
  const report = (): ArchiveAuditReport => ({
    outcome: run.outcome,
    complete: run.outcome === "completed_cycle",
    checked: run.checked,
    copied: run.copied,
    missing: run.missing,
    bytesVerified: run.bytesVerified,
    error: run.error,
    cursorFrom: run.cursorFrom,
    cursorTo: run.cursorTo,
  })
  const recordRun = async () => {
    const inserted = await service.from("media_archive_audit_runs").insert({
      run_id: runId,
      cycle_id: run.cycleId,
      started_at: iso(startedMs),
      finished_at: iso(),
      outcome: run.outcome,
      checked: run.checked,
      copied: run.copied,
      missing: run.missing,
      bytes_verified: run.bytesVerified,
      error: run.error,
      cursor_from: run.cursorFrom,
      cursor_to: run.cursorTo,
    })
    if (inserted.error) console.error("media archive audit run record failed")
  }

  if (!acquired) {
    await recordRun()
    return report()
  }

  const store = options.store ?? createArchiveStore(config!, signal)
  let state: StateRow | null = null
  try {
    try {
      state = await readState()
      await work(state)
    } catch (error) {
      const stop = error instanceof AuditStop ? error : null
      const aborted = signal.aborted && stop?.outcome !== "lease_lost"
      run.outcome = aborted ? "timeout" : (stop?.outcome ?? "failed")
      run.error =
        run.outcome === "timeout"
          ? "archive_audit_timeout"
          : run.outcome === "lease_lost"
            ? "archive_lease_lost"
            : codeFrom(error, "archive_audit_failed")
    }
    if (run.outcome !== "lease_lost" && run.outcome !== "completed_cycle") {
      const failing = run.outcome === "failed" || run.outcome === "timeout"
      try {
        await writeEnd(failing)
      } catch {
        if (!failing) {
          run.outcome = "failed"
          run.error = "archive_checkpoint_failed"
        }
      }
    }
    await recordRun()
    if (run.outcome !== "lease_lost") await prune()
    return report()
  } finally {
    if (!options.store) store.close?.()
    await lease.release(holder).catch(() => undefined)
  }

  async function readState(): Promise<StateRow> {
    const read = await service
      .from("media_archive_audit_state")
      .select(STATE_COLUMNS)
      .eq("name", STATE_NAME)
      .single()
    if (read.error || !read.data)
      throw new AuditStop("failed", "archive_audit_failed")
    run.cycleId = read.data.cycle_id
    run.cursorFrom = read.data.cycle_id ? read.data.cursor_id : 0
    run.cursorTo = run.cursorFrom
    return read.data
  }

  async function renew() {
    let held: boolean
    try {
      // After the deadline the final checkpoint still has to confirm ownership.
      held = await (signal.aborted
        ? lease.acquire(holder, leaseTtl)
        : abortable(lease.acquire(holder, leaseTtl), signal))
    } catch (error) {
      if (error instanceof AuditStop) throw error
      throw new AuditStop("failed", "archive_audit_failed")
    }
    if (!held) throw new AuditStop("lease_lost", "archive_lease_lost")
  }

  function softExceeded() {
    return now() - startedMs >= softBudgetMs
  }

  async function work(initial: StateRow) {
    let cycleId = initial.cycle_id
    let startedAtMs = Date.parse(initial.cycle_started_at ?? "")
    let target = initial.cycle_target_id ?? 0
    let cursor = cycleId ? initial.cursor_id : 0
    const lastStartedMs = Date.parse(
      initial.last_complete_cycle_started_at ?? ""
    )
    const throttled =
      !cycleId &&
      Number.isFinite(lastStartedMs) &&
      now() - lastStartedMs < spacingMs

    if (!cycleId && !throttled) {
      await renew()
      const newest = await abortable(
        Promise.resolve(
          service
            .from("media_archive_receipts")
            .select("id")
            .order("id", { ascending: false })
            .limit(1)
        ),
        signal
      )
      if (newest.error) throw new AuditStop("failed", "archive_audit_failed")
      target = newest.data[0]?.id ?? 0
      const counted = await abortable(
        Promise.resolve(
          service
            .from("media_archive_receipts")
            .select("id", { count: "exact", head: true })
            .lte("id", target)
        ),
        signal
      )
      if (counted.error) throw new AuditStop("failed", "archive_audit_failed")
      cycleId = randomId()
      startedAtMs = now()
      const started = await service
        .from("media_archive_audit_state")
        .update({
          cycle_id: cycleId,
          cycle_started_at: iso(startedAtMs),
          cycle_target_id: target,
          cycle_target_count: counted.count ?? 0,
          cursor_id: 0,
          cycle_checked: 0,
        })
        .eq("name", STATE_NAME)
        .is("cycle_id", null)
        .select("cycle_id")
      if (started.error || started.data?.length !== 1)
        throw new AuditStop("failed", "archive_checkpoint_failed")
      run.cycleId = cycleId
      run.cursorFrom = 0
      run.cursorTo = 0
    }

    // A failing backfill must not freeze verification: it is surfaced as a
    // failed run after progress is saved, and stops further backfill this run.
    let backfillFailure: AuditStop | null = null
    if (backfillLimit > 0) {
      const candidates = await abortable(
        Promise.resolve(
          service.rpc("media_archive_backfill_candidates", {
            p_limit: backfillLimit,
          })
        ),
        signal
      )
      if (candidates.error)
        throw new AuditStop("failed", "archive_audit_failed")
      for (const row of candidates.data) {
        if (now() - startedMs >= softBudgetMs / 2) break
        await renew()
        try {
          await abortable(archive(service, row.asset_id, signal), signal)
          run.copied++
        } catch (error) {
          if (signal.aborted) throw error
          backfillFailure = new AuditStop("failed", backfillCode(error))
          break
        }
      }
    }

    if (cycleId) {
      cursor = await verifyCycle(
        cycleId,
        cursor,
        target,
        cycleId === initial.cycle_id ? initial.cycle_checked : 0
      )
    }

    const missing = await abortable(
      Promise.resolve(service.rpc("media_archive_missing_count")),
      signal
    )
    if (missing.error || typeof missing.data !== "number")
      throw new AuditStop("failed", "archive_audit_failed")
    run.missing = missing.data
    if (backfillFailure) throw backfillFailure

    if (!cycleId) {
      run.outcome = "idle"
      return
    }
    if (cursor >= target && missing.data === 0) {
      await renew()
      const finishedMs = now()
      const completed = await service
        .from("media_archive_audit_state")
        .update({
          cycle_id: null,
          cycle_started_at: null,
          cycle_target_id: null,
          cycle_target_count: null,
          cursor_id: 0,
          cycle_checked: 0,
          last_complete_at: iso(finishedMs),
          last_complete_cycle_started_at: iso(startedAtMs),
          last_cycle_duration_seconds: Math.max(
            0,
            Math.round((finishedMs - startedAtMs) / 1000)
          ),
          last_run_at: iso(finishedMs),
          last_run_outcome: "completed_cycle",
          last_error: null,
          consecutive_failures: 0,
        })
        .eq("name", STATE_NAME)
        .eq("cycle_id", cycleId)
        .select("cycle_id")
      if (completed.error || completed.data?.length !== 1)
        throw new AuditStop("failed", "archive_checkpoint_failed")
      run.outcome = "completed_cycle"
      return
    }
    run.outcome = "partial"
  }

  /**
   * Workers pull receipts without a per-batch barrier. The cursor only ever
   * moves to the end of the unbroken run of verified receipts, so a slow or
   * failed receipt holds it back while later receipts keep being verified.
   */
  async function verifyCycle(
    cycleId: string,
    from: number,
    target: number,
    checkedBefore: number
  ): Promise<number> {
    const issued: { id: number; done: boolean }[] = []
    const queue: { receipt: Receipt; entry: { id: number; done: boolean } }[] =
      []
    let fetchedTo = from
    let exhausted = from >= target
    let fetching: Promise<void> | null = null
    let failure = null as AuditStop | null
    let watermark = 0
    let saved = 0
    let saving = false
    let cursor = from
    let cycleChecked = checkedBefore

    const fail = (error: unknown) => {
      const stop =
        error instanceof AuditStop
          ? error
          : new AuditStop("failed", codeFrom(error, "archive_audit_failed"))
      if (!failure || stop.outcome === "lease_lost") failure = stop
    }
    const halted = () => failure !== null || signal.aborted || softExceeded()

    async function fill() {
      fetching ??= (async () => {
        try {
          const page = await abortable(
            Promise.resolve(
              service
                .from("media_archive_receipts")
                .select("*")
                .gt("id", fetchedTo)
                .lte("id", target)
                .order("id", { ascending: true })
                .limit(fetchSize)
            ),
            signal
          )
          if (page.error) throw new AuditStop("failed", "archive_audit_failed")
          for (const receipt of page.data) {
            queue.push({ receipt, entry: { id: receipt.id, done: false } })
          }
          if (page.data.length) fetchedTo = page.data[page.data.length - 1].id
          if (page.data.length < fetchSize) exhausted = true
        } finally {
          fetching = null
        }
      })()
      await fetching
    }

    async function next() {
      while (!halted()) {
        const item = queue.shift()
        if (item) {
          issued.push(item.entry)
          return item
        }
        if (exhausted) return null
        await fill()
      }
      return null
    }

    async function persist(cursorTo: number, checkedTotal: number) {
      const written = await service
        .from("media_archive_audit_state")
        .update({ cursor_id: cursorTo, cycle_checked: checkedTotal })
        .eq("name", STATE_NAME)
        .eq("cycle_id", cycleId)
        .lt("cursor_id", cursorTo)
        .select("cursor_id")
      if (written.error || written.data?.length !== 1)
        throw new AuditStop("failed", "archive_checkpoint_failed")
    }

    async function save(force: boolean) {
      if (saving || failure?.outcome === "lease_lost") return
      while (watermark < issued.length && issued[watermark].done) watermark++
      if (watermark === saved) return
      if (!force && watermark - saved < checkpointEvery) return
      saving = true
      const covered = watermark
      try {
        await renew()
        const last = issued[covered - 1].id
        const total = cycleChecked + covered - saved
        await persist(last, total)
        run.checked += covered - saved
        cycleChecked = total
        saved = covered
        cursor = last
        run.cursorTo = cursor
      } catch (error) {
        fail(error)
      } finally {
        saving = false
      }
    }

    async function worker() {
      try {
        for (;;) {
          const item = await next()
          if (!item) return
          try {
            const bytes = await abortable(verifyReceipt(item.receipt), signal)
            run.bytesVerified += bytes
            item.entry.done = true
          } catch (error) {
            fail(error)
            return
          }
          await save(false)
        }
      } catch (error) {
        fail(error)
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker))
    if (failure?.outcome !== "lease_lost") {
      await save(true)
      if (!failure && exhausted && saved === issued.length && cursor < target) {
        try {
          await renew()
          await persist(target, cycleChecked)
          cursor = target
          run.cursorTo = target
        } catch (error) {
          fail(error)
        }
      }
    }
    if (failure) throw failure
    return cursor
  }

  /** Reads both objects back; returns the bytes read. */
  async function verifyReceipt(receipt: Receipt) {
    const manifestSize = new TextEncoder().encode(
      JSON.stringify(receipt.manifest)
    ).byteLength
    await store.verifyOriginal(
      receipt.blob_key,
      receipt.sha256,
      receipt.size_bytes
    )
    await store.verifyManifest(
      receipt.manifest_key,
      receipt.manifest_sha256,
      manifestSize
    )
    return receipt.size_bytes + manifestSize
  }

  async function writeEnd(failing: boolean) {
    if (!state) return
    const saved = await service
      .from("media_archive_audit_state")
      .update({
        last_run_at: iso(),
        last_run_outcome: run.outcome,
        last_error: failing ? run.error : null,
        consecutive_failures: failing ? state.consecutive_failures + 1 : 0,
      })
      .eq("name", STATE_NAME)
      .select("name")
    if (saved.error || saved.data?.length !== 1)
      throw new Error("archive_checkpoint_failed")
  }

  async function prune() {
    const cutoff = iso(now() - ARCHIVE_AUDIT_RUN_RETENTION_DAYS * 86_400_000)
    const pruned = await service
      .from("media_archive_audit_runs")
      .delete()
      .lt("finished_at", cutoff)
    if (pruned.error) console.error("media archive audit run prune failed")
  }
}

export type ArchiveStatusReport =
  | {
      ok: false
      status: "disabled"
      maxAgeSeconds: number
      scheduleIntervalSeconds: number
    }
  | {
      ok: boolean
      status: "current" | "stale"
      missing: number
      lastCompleteAt: string | null
      lastRunAt: string | null
      failed: boolean
      inProgress: boolean
      lastError: string | null
      lastRunOutcome: string | null
      consecutiveFailures: number
      cycleStartedAt: string | null
      cycleProgress: { checked: number; target: number } | null
      lastCycleDurationSeconds: number | null
      maxAgeSeconds: number
      scheduleIntervalSeconds: number
    }

/** Read-only health boundary for an independently configured failure monitor. */
export async function archiveStatus(
  service: Service,
  now?: number
): Promise<ArchiveStatusReport> {
  const shared = {
    maxAgeSeconds: ARCHIVE_MAX_AGE_MS / 1000,
    scheduleIntervalSeconds: ARCHIVE_AUDIT_INTERVAL_SECONDS,
  }
  if (!readArchiveConfig())
    return { ok: false, status: "disabled" as const, ...shared }
  const [state, missing] = await Promise.all([
    service
      .from("media_archive_audit_state")
      .select(
        "last_complete_at,last_run_at,last_error,last_run_outcome,consecutive_failures,cycle_id,cycle_started_at,cycle_target_count,cycle_checked,last_cycle_duration_seconds"
      )
      .eq("name", STATE_NAME)
      .single(),
    service.rpc("media_archive_missing_count"),
  ])
  if (state.error || missing.error || !state.data)
    throw new Error("archive_status_unavailable")
  const completed = Date.parse(state.data.last_complete_at ?? "")
  // An audit can complete while these reads await. Use validation time while
  // preserving an explicitly injected clock for deterministic callers/tests.
  const checkedAt = now ?? Date.now()
  const fresh =
    Number.isFinite(completed) &&
    completed <= checkedAt &&
    checkedAt - completed <= ARCHIVE_MAX_AGE_MS
  const inProgress = state.data.cycle_id !== null
  return {
    ok: fresh && !state.data.last_error && missing.data === 0,
    status: fresh ? ("current" as const) : ("stale" as const),
    missing: missing.data,
    lastCompleteAt: state.data.last_complete_at,
    lastRunAt: state.data.last_run_at,
    failed: Boolean(state.data.last_error),
    inProgress,
    lastError: state.data.last_error,
    lastRunOutcome: state.data.last_run_outcome,
    consecutiveFailures: state.data.consecutive_failures,
    cycleStartedAt: state.data.cycle_started_at,
    cycleProgress: inProgress
      ? {
          checked: state.data.cycle_checked,
          target: state.data.cycle_target_count ?? 0,
        }
      : null,
    lastCycleDurationSeconds: state.data.last_cycle_duration_seconds,
    ...shared,
  }
}
