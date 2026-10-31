import { readFileSync } from "node:fs"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ config: vi.fn() }))
vi.mock("@/lib/server/archive/config", () => ({
  readArchiveConfig: mocks.config,
}))
vi.mock("@/lib/server/archive/index", () => ({
  ensureMediaOriginalArchived: vi.fn(),
}))
vi.mock("@/lib/server/archive/object-store", () => ({
  createArchiveStore: vi.fn(),
}))

import {
  ARCHIVE_AUDIT_BACKFILL_LIMIT,
  ARCHIVE_AUDIT_CHECKPOINT_EVERY,
  ARCHIVE_AUDIT_CONCURRENCY,
  ARCHIVE_AUDIT_CRON,
  ARCHIVE_AUDIT_CYCLE_MIN_SPACING_MS,
  ARCHIVE_AUDIT_DEADLINE_MS,
  ARCHIVE_AUDIT_INTERVAL_SECONDS,
  ARCHIVE_AUDIT_LEASE_TTL_SECONDS,
  ARCHIVE_AUDIT_SOFT_BUDGET_MS,
  ARCHIVE_MAX_AGE_MS,
  archiveStatus,
  runArchiveAudit,
  type ArchiveAuditOptions,
} from "@/lib/server/archive/audit"

import {
  createFakeArchiveService,
  createFakeArchiveStore,
  type FakeArchiveService,
  type FakeServiceOptions,
} from "./media-archive-audit-fixture"

beforeEach(() => {
  mocks.config.mockReturnValue({ sourceProjectRef: "fixture" })
})
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

const HOUR = 3_600_000
const ids = (count: number) => Array.from({ length: count }, (_, i) => i + 1)
// Each fake receipt is a 4-byte blob plus the 8-byte manifest `{"id":N}`.
const BYTES_PER_RECEIPT = 12
function audit(
  fake: FakeArchiveService,
  store = createFakeArchiveStore(),
  extra: ArchiveAuditOptions = {}
) {
  return runArchiveAudit(fake.client, {
    store,
    now: fake.clock.now,
    archive: fake.archive,
    checkpointEvery: 2,
    concurrency: 1,
    fetchSize: 3,
    ...extra,
  })
}
const iso = (fake: FakeArchiveService) => new Date(fake.clock.t).toISOString()
const openCycle = (
  target: number,
  cursor = 0
): FakeServiceOptions["state"] => ({
  cycle_id: "11111111-1111-4111-8111-111111111111",
  cycle_started_at: "2026-10-30T11:00:00.000Z",
  cycle_target_id: target,
  cycle_target_count: target,
  cursor_id: cursor,
})
const advanceOnOriginal =
  (fake: FakeArchiveService, ms = 1000) =>
  (kind: "original" | "manifest") => {
    if (kind === "original") fake.clock.advance(ms)
  }

describe("resumable archive verification cycle", () => {
  it("verifies bytes and immutable attribution for every receipt, then completes the cycle", async () => {
    const fake = createFakeArchiveService({ receipts: ids(3) })
    const store = createFakeArchiveStore({
      onVerify: () => fake.clock.advance(1000),
    })
    const report = await audit(fake, store)
    expect(report).toEqual({
      outcome: "completed_cycle",
      complete: true,
      checked: 3,
      copied: 0,
      missing: 0,
      bytesVerified: 3 * BYTES_PER_RECEIPT,
      error: null,
      cursorFrom: 0,
      cursorTo: 3,
    })
    expect(store.verified.filter((key) => key.startsWith("blob-"))).toEqual([
      "blob-1",
      "blob-2",
      "blob-3",
    ])
    expect(
      store.verified.filter((key) => key.startsWith("manifest-"))
    ).toHaveLength(3)
    expect(fake.state).toMatchObject({
      cursor_id: 0,
      cycle_id: null,
      cycle_started_at: null,
      cycle_target_id: null,
      cycle_target_count: null,
      cycle_checked: 0,
      last_complete_at: iso(fake),
      last_run_at: iso(fake),
      last_run_outcome: "completed_cycle",
      last_error: null,
      consecutive_failures: 0,
    })
    expect(fake.state.last_cycle_duration_seconds).toBe(6)
    expect(fake.state.last_complete_cycle_started_at).toBe(
      new Date(fake.clock.t - 6000).toISOString()
    )
    expect(fake.runs).toHaveLength(1)
    expect(fake.runs[0]).toMatchObject({
      outcome: "completed_cycle",
      checked: 3,
      error: null,
      cursor_from: 0,
      cursor_to: 3,
      missing: 0,
      bytes_verified: 3 * BYTES_PER_RECEIPT,
    })
    expect(fake.lease.holder).toBeNull()
    expect(store.closed).toBe(0)
  })

  it("completes immediately when there are no receipts and no missing originals", async () => {
    const fake = createFakeArchiveService()
    expect(await audit(fake)).toMatchObject({
      outcome: "completed_cycle",
      checked: 0,
    })
    expect(fake.state.last_complete_at).toBe(iso(fake))
    expect(fake.state.last_cycle_duration_seconds).toBe(0)
  })

  it("targets receipts that exist at cycle start and counts them despite id gaps", async () => {
    const fake = createFakeArchiveService({ receipts: [5, 9, 100] })
    const store = createFakeArchiveStore()
    // The run stops after starting the cycle so the target is observable.
    await audit(fake, store, { softBudgetMs: 0, backfillLimit: 0 })
    expect(fake.state).toMatchObject({
      cycle_target_id: 100,
      cycle_target_count: 3,
      cycle_checked: 0,
      cursor_id: 0,
    })
    expect(fake.state.cycle_id).not.toBeNull()
    expect(fake.state.cycle_started_at).toBe(iso(fake))
    expect(store.verified).toEqual([])
  })

  it("jumps the cursor across id gaps once every receipt in range is verified", async () => {
    const fake = createFakeArchiveService({ receipts: [5, 9, 100] })
    const report = await audit(fake)
    expect(report).toMatchObject({
      outcome: "completed_cycle",
      checked: 3,
      cursorTo: 100,
    })
  })

  it("resumes the same cycle after a partial run and ignores receipts created later", async () => {
    const fake = createFakeArchiveService({ receipts: ids(6) })
    const store = createFakeArchiveStore({ onVerify: advanceOnOriginal(fake) })
    const first = await audit(fake, store, { softBudgetMs: 3000 })
    expect(first).toMatchObject({
      outcome: "partial",
      complete: false,
      checked: 3,
      cursorTo: 3,
    })
    const cycleId = fake.state.cycle_id
    expect(cycleId).not.toBeNull()
    expect(fake.state).toMatchObject({
      cursor_id: 3,
      cycle_checked: 3,
      cycle_target_id: 6,
      last_run_outcome: "partial",
      last_complete_at: null,
      consecutive_failures: 0,
    })
    const startedAt = fake.state.cycle_started_at
    fake.addReceipt(7)
    fake.clock.advance(10 * 60 * 1000)
    const second = await audit(fake, store, { softBudgetMs: 3500 })
    expect(second).toMatchObject({
      outcome: "completed_cycle",
      checked: 3,
      cursorFrom: 3,
      cursorTo: 6,
    })
    expect(store.verified).not.toContain("blob-7")
    expect(fake.state.last_complete_cycle_started_at).toBe(startedAt)
    expect(fake.runs.map((run) => run.outcome)).toEqual([
      "partial",
      "completed_cycle",
    ])
    expect(fake.runs[1].cycle_id).toBe(cycleId)
    // Past the throttle the next cycle starts and includes the new receipt.
    fake.clock.advance(ARCHIVE_AUDIT_CYCLE_MIN_SPACING_MS)
    await audit(fake, store, { softBudgetMs: 0, backfillLimit: 0 })
    expect(fake.state).toMatchObject({
      cycle_target_id: 7,
      cycle_target_count: 7,
    })
    expect(fake.state.cycle_id).not.toBe(cycleId)
  })

  it("does not complete a cycle while ready originals still lack receipts", async () => {
    const fake = createFakeArchiveService({
      receipts: ids(2),
      missingAssets: ["legacy-a", "legacy-b"],
    })
    const first = await audit(fake, undefined, { backfillLimit: 1 })
    expect(first).toMatchObject({
      outcome: "partial",
      copied: 1,
      checked: 2,
      missing: 1,
    })
    expect(fake.state.last_complete_at).toBeNull()
    expect(fake.state.cycle_id).not.toBeNull()
    const second = await audit(fake, undefined, { backfillLimit: 1 })
    expect(second).toMatchObject({
      outcome: "completed_cycle",
      copied: 1,
      missing: 0,
    })
    expect(fake.state.last_complete_at).not.toBeNull()
  })

  it("counts missing originals once per invocation however many checkpoints it makes", async () => {
    const fake = createFakeArchiveService({ receipts: ids(9) })
    await audit(fake, undefined, { checkpointEvery: 2 })
    expect(
      fake.calls.filter((call) => call === "rpc.media_archive_missing_count")
    ).toHaveLength(1)
  })

  it("verifies with the configured concurrency", async () => {
    const fake = createFakeArchiveService({ receipts: ids(8) })
    const store = createFakeArchiveStore({
      onVerify: () => new Promise((resolve) => setTimeout(resolve, 2)),
    })
    await audit(fake, store, { concurrency: 3 })
    expect(store.maxActive).toBe(3)
    expect(fake.state.last_complete_at).not.toBeNull()
  })

  it("checkpoints at the verified watermark every N receipts and once more at the end", async () => {
    const fake = createFakeArchiveService({ receipts: ids(9) })
    const cursors: number[] = []
    fake.before = (key) => {
      if (key === "media_archive_audit_state.update")
        cursors.push(fake.state.cursor_id)
    }
    await audit(fake, undefined, { checkpointEvery: 4 })
    // cycle start, checkpoint at 4, at 8, final at 9, then cycle completion
    expect(cursors).toEqual([0, 0, 4, 8, 9])
  })

  it("keeps verifying later receipts while a slow one holds the cursor back", async () => {
    const fake = createFakeArchiveService({ receipts: ids(6) })
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const store = createFakeArchiveStore({
      onVerify: async (kind, key) => {
        if (kind === "original" && key === "blob-1") await gate
      },
    })
    const running = audit(fake, store, { concurrency: 2, checkpointEvery: 2 })
    await vi.waitFor(() => expect(store.verified).toContain("manifest-6"))
    // Receipts 2..6 are verified, but the cursor never passes unverified 1.
    expect(fake.state.cursor_id).toBe(0)
    release()
    expect(await running).toMatchObject({
      outcome: "completed_cycle",
      checked: 6,
    })
  })
})

describe("archive audit failures keep honest progress", () => {
  it("checkpoints only the contiguous verified prefix and records a failed run", async () => {
    const fake = createFakeArchiveService({ receipts: ids(4) })
    const store = createFakeArchiveStore()
    store.corrupt.add("blob-2")
    const report = await audit(fake, store, { concurrency: 4 })
    expect(report).toMatchObject({
      outcome: "failed",
      complete: false,
      error: "archive_audit_failed",
      checked: 1,
      cursorTo: 1,
    })
    // Receipt 3 was in flight and read back too (the first page holds 1 to 3),
    // so its bytes count as verified although the cursor cannot pass 2.
    expect(report.bytesVerified).toBe(2 * BYTES_PER_RECEIPT)
    expect(fake.state).toMatchObject({
      cursor_id: 1,
      cycle_checked: 1,
      last_complete_at: null,
      last_error: "archive_audit_failed",
      last_run_outcome: "failed",
      consecutive_failures: 1,
    })
    expect(fake.runs[0]).toMatchObject({
      outcome: "failed",
      error: "archive_audit_failed",
    })
    expect(fake.lease.holder).toBeNull()
    // A second failing run increments, the next clean run clears.
    await audit(fake, store, { concurrency: 4 })
    expect(fake.state.consecutive_failures).toBe(2)
    store.corrupt.clear()
    expect(await audit(fake, store)).toMatchObject({
      outcome: "completed_cycle",
      checked: 3,
    })
    expect(fake.state).toMatchObject({
      last_error: null,
      consecutive_failures: 0,
    })
  })

  it("maps an unavailable store to its own code without leaking the message", async () => {
    const fake = createFakeArchiveService({ receipts: ids(2) })
    const store = createFakeArchiveStore()
    store.unavailable.add("manifest-1")
    const report = await audit(fake, store)
    expect(report).toMatchObject({
      outcome: "failed",
      error: "archive_store_unavailable",
    })
    expect(JSON.stringify(fake.runs)).not.toContain("manifest-1")
  })

  it("keeps verification progress when backfill fails, and reports the run as failed", async () => {
    const fake = createFakeArchiveService({
      receipts: ids(2),
      missingAssets: ["legacy"],
    })
    const report = await audit(fake, undefined, {
      archive: async () => {
        throw new Error("archive_source_read_failed")
      },
    })
    expect(report).toMatchObject({
      outcome: "failed",
      error: "archive_source_unavailable",
      checked: 2,
      missing: 1,
    })
    expect(fake.state).toMatchObject({
      cursor_id: 2,
      last_error: "archive_source_unavailable",
      consecutive_failures: 1,
    })
  })

  it("maps destination write failures during backfill to archive_store_unavailable", async () => {
    const fake = createFakeArchiveService({ missingAssets: ["legacy"] })
    const report = await audit(fake, undefined, {
      archive: async () => {
        throw new Error("archive_destination_write_failed")
      },
    })
    expect(report).toMatchObject({
      outcome: "failed",
      error: "archive_store_unavailable",
    })
  })

  it("records archive_checkpoint_failed and leaves the cursor where it was", async () => {
    const fake = createFakeArchiveService({
      receipts: ids(3),
      state: openCycle(3),
    })
    fake.fail(
      "media_archive_audit_state.update",
      "injected_database_failure",
      2
    )
    const report = await audit(fake)
    expect(report).toMatchObject({
      outcome: "failed",
      error: "archive_checkpoint_failed",
      checked: 0,
    })
    expect(fake.state).toMatchObject({
      cursor_id: 0,
      last_error: "archive_checkpoint_failed",
      consecutive_failures: 1,
    })
  })

  it("fails a run whose final state write cannot be saved instead of claiming progress", async () => {
    const fake = createFakeArchiveService({
      receipts: ids(4),
      state: openCycle(4),
    })
    const store = createFakeArchiveStore({ onVerify: advanceOnOriginal(fake) })
    // The checkpoint after receipt 2 succeeds; the end-of-run update then fails.
    let updates = 0
    fake.before = (key) => {
      if (key === "media_archive_audit_state.update" && ++updates === 2)
        fake.fail(key, "injected", 1)
    }
    const report = await audit(fake, store, { softBudgetMs: 1500 })
    expect(report).toMatchObject({
      outcome: "failed",
      error: "archive_checkpoint_failed",
      checked: 2,
    })
    expect(fake.state).toMatchObject({ cursor_id: 2, last_run_outcome: null })
  })

  it("still reports the outcome when the run history cannot be written", async () => {
    const fake = createFakeArchiveService({ receipts: ids(1) })
    fake.fail("media_archive_audit_runs.insert")
    const silence = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(await audit(fake)).toMatchObject({ outcome: "completed_cycle" })
      expect(fake.state.last_complete_at).not.toBeNull()
      expect(silence).toHaveBeenCalledWith(
        "media archive audit run record failed"
      )
    } finally {
      silence.mockRestore()
    }
  })

  it("prunes run history beyond the 90-day retention window only", async () => {
    const fake = createFakeArchiveService({ receipts: ids(1) })
    const finished = (days: number) =>
      new Date(fake.clock.t - days * 24 * HOUR).toISOString()
    fake.runs.push(
      { id: 1, run_id: "old", finished_at: finished(91) },
      { id: 2, run_id: "recent", finished_at: finished(89) }
    )
    await audit(fake)
    expect(fake.runs.map((run) => run.run_id)).toContain("recent")
    expect(fake.runs.map((run) => run.run_id)).not.toContain("old")
  })
})

describe("cycle throttle", () => {
  const completedHoursAgo = (hours: number) =>
    new Date(Date.parse("2026-10-30T12:00:00Z") - hours * HOUR).toISOString()

  it("idles inside the 12-hour window: backfills, records the run, and is not a failure", async () => {
    const fake = createFakeArchiveService({
      receipts: ids(3),
      missingAssets: ["legacy-a", "legacy-b"],
      state: {
        last_complete_at: completedHoursAgo(5),
        last_complete_cycle_started_at: completedHoursAgo(5.5),
        last_error: "archive_audit_failed",
        last_run_outcome: "failed",
        consecutive_failures: 2,
      },
    })
    const store = createFakeArchiveStore()
    const report = await audit(fake, store)
    expect(report).toMatchObject({
      outcome: "idle",
      complete: false,
      checked: 0,
      copied: 2,
      missing: 0,
      error: null,
    })
    expect(store.verified).toEqual([])
    expect(fake.state).toMatchObject({
      cycle_id: null,
      cursor_id: 0,
      last_run_at: iso(fake),
      last_run_outcome: "idle",
      last_error: null,
      consecutive_failures: 0,
      last_complete_at: completedHoursAgo(5),
    })
    expect(fake.runs).toHaveLength(1)
    expect(fake.runs[0]).toMatchObject({
      outcome: "idle",
      cycle_id: null,
      copied: 2,
      error: null,
    })
  })

  it("reports a failed backfill during idle as a failed run", async () => {
    const fake = createFakeArchiveService({
      missingAssets: ["legacy"],
      state: {
        last_complete_at: completedHoursAgo(1),
        last_complete_cycle_started_at: completedHoursAgo(2),
      },
    })
    const report = await audit(fake, undefined, {
      archive: async () => {
        throw new Error("archive_source_read_failed")
      },
    })
    expect(report).toMatchObject({
      outcome: "failed",
      error: "archive_source_unavailable",
    })
    expect(fake.state.consecutive_failures).toBe(1)
  })

  it("starts the next cycle once the previous one started at least 12 hours ago", async () => {
    const fake = createFakeArchiveService({
      receipts: ids(2),
      state: {
        last_complete_at: completedHoursAgo(11),
        last_complete_cycle_started_at: completedHoursAgo(12),
      },
    })
    expect(await audit(fake)).toMatchObject({
      outcome: "completed_cycle",
      checked: 2,
    })
  })

  it("never delays an open cycle", async () => {
    const fake = createFakeArchiveService({
      receipts: ids(3),
      state: {
        ...openCycle(3),
        last_complete_cycle_started_at: completedHoursAgo(1),
      },
    })
    expect(await audit(fake)).toMatchObject({
      outcome: "completed_cycle",
      checked: 3,
    })
  })

  it("retries an open cycle at the next invocation after a failure", async () => {
    const fake = createFakeArchiveService({ receipts: ids(3) })
    const store = createFakeArchiveStore()
    store.unavailable.add("blob-2")
    await audit(fake, store)
    expect(fake.state.cycle_id).not.toBeNull()
    store.unavailable.clear()
    fake.clock.advance(10 * 60 * 1000)
    expect(await audit(fake, store)).toMatchObject({
      outcome: "completed_cycle",
    })
  })
})

describe("deadline, lease and overlap", () => {
  it("records a timeout when a store call hangs, keeping progress up to the last checkpoint", async () => {
    const fake = createFakeArchiveService({ receipts: ids(3) })
    const store = createFakeArchiveStore()
    store.hang.add("blob-2")
    const report = await audit(fake, store, {
      checkpointEvery: 1,
      deadlineMs: 40,
    })
    expect(report).toMatchObject({
      outcome: "timeout",
      complete: false,
      error: "archive_audit_timeout",
      checked: 1,
      cursorTo: 1,
    })
    expect(fake.state).toMatchObject({
      cursor_id: 1,
      last_error: "archive_audit_timeout",
      last_run_outcome: "timeout",
      consecutive_failures: 1,
    })
    expect(fake.runs[0]).toMatchObject({
      outcome: "timeout",
      error: "archive_audit_timeout",
    })
    expect(fake.lease.holder).toBeNull()
  })

  it("saves the verified watermark when the deadline hits mid-run", async () => {
    const fake = createFakeArchiveService({ receipts: ids(5) })
    const store = createFakeArchiveStore()
    store.hang.add("blob-4")
    const report = await audit(fake, store, {
      checkpointEvery: 100,
      deadlineMs: 40,
    })
    expect(report).toMatchObject({ outcome: "timeout", checked: 3 })
    expect(fake.state.cursor_id).toBe(3)
  })

  it("ends a run as timeout when the supplied signal aborts, even if the store ignores it", async () => {
    const fake = createFakeArchiveService({ receipts: ids(2) })
    const controller = new AbortController()
    const store = createFakeArchiveStore({
      onVerify: () => controller.abort(),
    })
    store.hang.add("blob-1")
    const report = await audit(fake, store, { signal: controller.signal })
    expect(report).toMatchObject({ outcome: "timeout", checked: 0 })
    expect(fake.state.cycle_id).not.toBeNull()
  })

  it("returns locked for an overlapping run without touching cycle state", async () => {
    const fake = createFakeArchiveService({
      receipts: ids(3),
      state: {
        ...openCycle(3, 1),
        cycle_checked: 1,
        last_run_outcome: "partial",
      },
    })
    fake.lease.holder = "someone-else"
    fake.lease.expiresAt = fake.clock.t + 60_000
    const before = structuredClone(fake.state)
    const store = createFakeArchiveStore()
    const report = await audit(fake, store)
    expect(report).toMatchObject({
      outcome: "locked",
      complete: false,
      checked: 0,
      cursorFrom: null,
    })
    expect(fake.state).toEqual(before)
    expect(store.verified).toEqual([])
    expect(fake.runs).toHaveLength(1)
    expect(fake.runs[0]).toMatchObject({
      outcome: "locked",
      cycle_id: null,
      error: null,
    })
    expect(fake.lease.holder).toBe("someone-else")
  })

  it("takes over an expired lease", async () => {
    const fake = createFakeArchiveService({ receipts: ids(1) })
    fake.lease.holder = "crashed"
    fake.lease.expiresAt = fake.clock.t - 1
    expect(await audit(fake)).toMatchObject({ outcome: "completed_cycle" })
  })

  it("stops writing and records lease_lost when a renewal is refused", async () => {
    const fake = createFakeArchiveService({ receipts: ids(4) })
    fake.before = (key) => {
      if (
        key === "rpc.acquire_maintenance_lease" &&
        fake.state.cursor_id === 1
      ) {
        fake.lease.holder = "thief"
        fake.lease.expiresAt = fake.clock.t + 60_000
      }
    }
    const store = createFakeArchiveStore()
    const report = await audit(fake, store, { checkpointEvery: 1 })
    expect(report).toMatchObject({
      outcome: "lease_lost",
      error: "archive_lease_lost",
      checked: 1,
      cursorTo: 1,
    })
    // The new holder owns state: nothing but the first checkpoint was written.
    expect(fake.state).toMatchObject({
      cursor_id: 1,
      last_run_outcome: null,
      last_error: null,
      consecutive_failures: 0,
    })
    expect(fake.runs).toHaveLength(1)
    expect(fake.runs[0]).toMatchObject({
      outcome: "lease_lost",
      error: "archive_lease_lost",
    })
    expect(fake.lease.holder).toBe("thief")
  })

  it("renews the lease at every checkpoint with a TTL longer than the deadline", async () => {
    const fake = createFakeArchiveService({ receipts: ids(4) })
    const acquire = vi.spyOn(fake.leaseClient, "acquire")
    await audit(fake, undefined, {
      lease: fake.leaseClient,
      checkpointEvery: 1,
    })
    const holders = new Set(acquire.mock.calls.map(([holder]) => holder))
    expect(holders.size).toBe(1)
    expect(acquire.mock.calls.length).toBeGreaterThanOrEqual(5)
    expect(
      acquire.mock.calls.every(
        ([, ttl]) => ttl * 1000 > ARCHIVE_AUDIT_DEADLINE_MS
      )
    ).toBe(true)
  })

  it("uses a fresh lease holder for every invocation", async () => {
    const fake = createFakeArchiveService({ receipts: ids(1) })
    const holders: string[] = []
    const lease = {
      acquire: async (holder: string, ttl: number) => {
        holders.push(holder)
        return fake.leaseClient.acquire(holder, ttl)
      },
      release: fake.leaseClient.release,
    }
    await audit(fake, undefined, { lease, cycleMinSpacingMs: 0 })
    await audit(fake, undefined, { lease, cycleMinSpacingMs: 0 })
    expect(new Set(holders).size).toBe(2)
  })

  it("throws only before it holds the lease: disabled archive and lease errors", async () => {
    const fake = createFakeArchiveService({ receipts: ids(1) })
    mocks.config.mockReturnValue(null)
    await expect(runArchiveAudit(fake.client)).rejects.toThrow(
      "archive_disabled"
    )
    mocks.config.mockReturnValue({ sourceProjectRef: "fixture" })
    fake.fail("rpc.acquire_maintenance_lease")
    await expect(audit(fake)).rejects.toThrow("archive_lease_failed")
    expect(fake.runs).toHaveLength(0)
    expect(fake.state.last_run_at).toBeNull()
  })

  it("does not close a store it did not create", async () => {
    const fake = createFakeArchiveService()
    const store = createFakeArchiveStore()
    await audit(fake, store)
    expect(store.closed).toBe(0)
  })
})

describe("schedule and per-invocation budget", () => {
  it("keeps the cron entry, interval and budget consistent", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[]
    }
    const entry = vercel.crons.find(
      (cron) => cron.path === "/api/internal/media-archive"
    )
    expect(entry?.schedule).toBe(ARCHIVE_AUDIT_CRON)
    expect(ARCHIVE_AUDIT_CRON).toBe(
      `*/${ARCHIVE_AUDIT_INTERVAL_SECONDS / 60} * * * *`
    )
    const route = readFileSync(
      "app/api/internal/media-archive/route.ts",
      "utf8"
    )
    const maxDuration = Number(
      /export const maxDuration = (\d+)/.exec(route)?.[1]
    )
    expect(maxDuration).toBe(600)
    expect(ARCHIVE_AUDIT_DEADLINE_MS).toBeLessThanOrEqual(
      maxDuration * 1000 - 60_000
    )
    expect(ARCHIVE_AUDIT_SOFT_BUDGET_MS).toBeLessThanOrEqual(
      ARCHIVE_AUDIT_DEADLINE_MS - 30_000
    )
    expect(ARCHIVE_AUDIT_LEASE_TTL_SECONDS * 1000).toBeGreaterThan(
      ARCHIVE_AUDIT_DEADLINE_MS
    )
    // The database function accepts at most one hour.
    expect(ARCHIVE_AUDIT_LEASE_TTL_SECONDS).toBeLessThanOrEqual(3600)
  })

  it("pins the agreed schedule and budget", () => {
    expect(ARCHIVE_AUDIT_INTERVAL_SECONDS).toBe(600)
    expect(ARCHIVE_AUDIT_SOFT_BUDGET_MS).toBe(480_000)
    expect(ARCHIVE_AUDIT_DEADLINE_MS).toBe(540_000)
    expect(ARCHIVE_AUDIT_LEASE_TTL_SECONDS).toBe(600)
    expect(ARCHIVE_AUDIT_CONCURRENCY).toBe(8)
    expect(ARCHIVE_AUDIT_CHECKPOINT_EVERY).toBe(20)
    expect(ARCHIVE_AUDIT_BACKFILL_LIMIT).toBe(5)
    expect(ARCHIVE_AUDIT_CYCLE_MIN_SPACING_MS).toBe(12 * HOUR)
  })

  it("keeps the cycle throttle and a representative cycle time under the 26-hour limit", () => {
    expect(ARCHIVE_MAX_AGE_MS).toBe(26 * HOUR)
    // Throttle plus a 14-hour cycle is the longest the age can reach when the
    // previous cycle was much shorter than the next one.
    expect(ARCHIVE_AUDIT_CYCLE_MIN_SPACING_MS + 14 * HOUR).toBeLessThanOrEqual(
      ARCHIVE_MAX_AGE_MS
    )
  })
})

describe("independent archive freshness status", () => {
  const now = Date.parse("2026-10-30T12:00:00Z")
  const status = (fake: FakeArchiveService, at?: number) =>
    archiveStatus(fake.client, at)

  it("fails for no completed audit, stale/future timestamps, missing copies or last failure", async () => {
    for (const options of [
      {},
      { state: { last_complete_at: "2026-10-28T00:00:00Z" } },
      { state: { last_complete_at: "2026-11-01T00:00:00Z" } },
      {
        state: { last_complete_at: "2026-10-30T11:00:00Z" },
        missingAssets: ["a"],
      },
      {
        state: {
          last_complete_at: "2026-10-30T11:00:00Z",
          last_error: "archive_audit_failed",
        },
      },
    ]) {
      expect((await status(createFakeArchiveService(options), now)).ok).toBe(
        false
      )
    }
  })

  it("reports the cycle fields as counts and never ids or keys", async () => {
    const fake = createFakeArchiveService({
      state: {
        ...openCycle(7000, 4000),
        cycle_target_count: 6500,
        cycle_checked: 3900,
        last_complete_at: "2026-10-30T11:00:00Z",
        last_run_at: "2026-10-30T11:50:00Z",
        last_run_outcome: "partial",
        last_cycle_duration_seconds: 80000,
        consecutive_failures: 0,
      },
    })
    const report = await status(fake, now)
    expect(report).toEqual({
      ok: true,
      status: "current",
      missing: 0,
      lastCompleteAt: "2026-10-30T11:00:00Z",
      lastRunAt: "2026-10-30T11:50:00Z",
      failed: false,
      inProgress: true,
      lastError: null,
      lastRunOutcome: "partial",
      consecutiveFailures: 0,
      cycleStartedAt: "2026-10-30T11:00:00.000Z",
      cycleProgress: { checked: 3900, target: 6500 },
      lastCycleDurationSeconds: 80000,
      maxAgeSeconds: 93600,
      scheduleIntervalSeconds: ARCHIVE_AUDIT_INTERVAL_SECONDS,
    })
    expect(JSON.stringify(report)).not.toContain("1111")
  })

  it("is not in progress without an open cycle, whatever the cursor says", async () => {
    const fake = createFakeArchiveService({
      state: {
        last_complete_at: "2026-10-30T11:00:00Z",
        last_run_outcome: "idle",
      },
    })
    expect(await status(fake, now)).toMatchObject({
      ok: true,
      inProgress: false,
      cycleProgress: null,
      cycleStartedAt: null,
      lastRunOutcome: "idle",
    })
    const open = createFakeArchiveService({
      state: { ...openCycle(5), last_complete_at: "2026-10-30T11:00:00Z" },
    })
    expect(await status(open, now)).toMatchObject({
      inProgress: true,
      ok: true,
    })
  })

  it("surfaces failure details as codes and counts", async () => {
    const fake = createFakeArchiveService({
      state: {
        last_complete_at: "2026-10-30T11:00:00Z",
        last_error: "archive_audit_timeout",
        last_run_outcome: "timeout",
        consecutive_failures: 3,
      },
    })
    expect(await status(fake, now)).toMatchObject({
      ok: false,
      failed: true,
      lastError: "archive_audit_timeout",
      lastRunOutcome: "timeout",
      consecutiveFailures: 3,
    })
  })

  it("reports a disabled archive with the configured schedule", async () => {
    mocks.config.mockReturnValue(null)
    expect(await status(createFakeArchiveService(), now)).toEqual({
      ok: false,
      status: "disabled",
      maxAgeSeconds: 93600,
      scheduleIntervalSeconds: ARCHIVE_AUDIT_INTERVAL_SECONDS,
    })
  })

  it("throws when state cannot be read", async () => {
    const fake = createFakeArchiveService()
    fake.fail("media_archive_audit_state.select")
    await expect(status(fake, now)).rejects.toThrow(
      "archive_status_unavailable"
    )
  })

  it("samples freshness after awaited reads while preserving an explicitly injected now", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(now)
    const fake = createFakeArchiveService({
      state: { last_complete_at: new Date(now + 1000).toISOString() },
    })
    fake.before = (key) => {
      if (key === "media_archive_audit_state.select")
        vi.setSystemTime(now + 2000)
    }
    // The cycle completed after request start but before the query returned.
    expect(await status(fake)).toMatchObject({ ok: true, status: "current" })
    expect(await status(fake, now)).toMatchObject({
      ok: false,
      status: "stale",
    })
  })

  it("rejects a cycle that becomes stale during a slow status read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(now)
    const fake = createFakeArchiveService({
      state: {
        last_complete_at: new Date(
          now - 26 * 60 * 60 * 1000 + 1000
        ).toISOString(),
      },
    })
    fake.before = (key) => {
      if (key === "media_archive_audit_state.select")
        vi.setSystemTime(now + 2000)
    }
    expect(await status(fake)).toMatchObject({ ok: false, status: "stale" })
    expect(await status(fake, now)).toMatchObject({
      ok: true,
      status: "current",
    })
  })
})
