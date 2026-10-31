import { describe, expect, it, vi } from "vitest"

import {
  loadAudit,
  runAudit,
  startAudit,
  verifiedReceiptIds,
  type AuditModule,
} from "../support/driver"
import { watchCheckpoints } from "../support/invariants"
import { setupWorld } from "../support/module-mocks"

vi.mock(
  "@/lib/server/archive/config",
  async () => (await import("../support/module-mocks")).configMock
)
vi.mock(
  "@/lib/server/archive/index",
  async () => (await import("../support/module-mocks")).indexMock
)
vi.mock(
  "@/lib/server/archive/object-store",
  async () => (await import("../support/module-mocks")).objectStoreMock
)

// Agreed budget, pipelined watermark, cycle throttle and `idle` (§4.3, §4.4).
const audit = await loadAudit()
const suite = describe.skipIf(!audit)
const A = () => audit as AuditModule
const ctx = setupWorld()

const HOUR = 3_600_000

suite("agreed budget constants (§4.3)", () => {
  it("cron, soft budget, hard deadline, lease TTL, concurrency, checkpoint and backfill match the contract", () => {
    expect(A().ARCHIVE_AUDIT_INTERVAL_SECONDS).toBe(600)
    expect(A().ARCHIVE_AUDIT_SOFT_BUDGET_MS).toBe(480_000)
    expect(A().ARCHIVE_AUDIT_DEADLINE_MS).toBe(540_000)
    expect(A().ARCHIVE_AUDIT_LEASE_TTL_SECONDS).toBe(600)
    expect(A().ARCHIVE_AUDIT_CONCURRENCY).toBe(8)
    expect(A().ARCHIVE_AUDIT_CHECKPOINT_EVERY).toBe(20)
    expect(A().ARCHIVE_AUDIT_BACKFILL_LIMIT).toBe(5)
    expect(A().ARCHIVE_MAX_AGE_MS).toBe(26 * HOUR)
  })

  it("keeps the documented margins: hard deadline >= 60 s under maxDuration, soft budget >= 30 s under the hard deadline, lease outlives the deadline", () => {
    const maxDuration = 600_000
    expect(A().ARCHIVE_AUDIT_DEADLINE_MS + 60_000).toBeLessThanOrEqual(
      maxDuration
    )
    expect(A().ARCHIVE_AUDIT_SOFT_BUDGET_MS + 30_000).toBeLessThanOrEqual(
      A().ARCHIVE_AUDIT_DEADLINE_MS
    )
    expect(A().ARCHIVE_AUDIT_LEASE_TTL_SECONDS * 1000).toBeGreaterThan(
      A().ARCHIVE_AUDIT_DEADLINE_MS
    )
  })

  it("the run route's maxDuration is the literal 600 and the schedule runs every 10 minutes", async () => {
    vi.stubEnv("CLEANUP_SECRET", "c".repeat(40))
    const route = await import("@/app/api/internal/media-archive/route")
    expect(route.maxDuration).toBe(600)
    const { readFile } = await import("node:fs/promises")
    const config = JSON.parse(await readFile("vercel.json", "utf8")) as {
      crons?: { path: string; schedule: string }[]
    }
    const cron = config.crons?.find((entry) =>
      entry.path.startsWith("/api/internal/media-archive")
    )
    expect(cron?.schedule).toBe("*/10 * * * *")
    vi.unstubAllEnvs()
  })

  it("a run that is slow but progressing stops taking receipts at the soft budget and ends partial, before the hard deadline", async () => {
    const { world } = ctx
    world.seedReceipts(80)
    world.bucket.inject({ op: "verifyOriginal", kind: "latency", ms: 100_000 })
    const started = world.clock.now()
    const report = await runAudit(A(), world)
    expect(report).toMatchObject({ outcome: "partial", error: null })
    const elapsed = world.clock.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(A().ARCHIVE_AUDIT_SOFT_BUDGET_MS)
    expect(elapsed).toBeLessThan(A().ARCHIVE_AUDIT_DEADLINE_MS)
    expect(world.state().cursor_id).toBeGreaterThan(0)
    expect(world.state().consecutive_failures).toBe(0)
  })

  it("an in-flight receipt that outlives the hard deadline makes the run a timeout, even after the soft budget", async () => {
    const { world } = ctx
    world.seedReceipts(10)
    world.bucket.inject({
      op: "verifyOriginal",
      key: String(world.db.rows("media_archive_receipts")[9].blob_key),
      kind: "latency",
      ms: 800_000,
    })
    const report = await runAudit(A(), world)
    expect(report).toMatchObject({
      outcome: "timeout",
      error: "archive_audit_timeout",
    })
  })

  it("checkpoints roughly every 20 receipts with an increasing cursor, never past a receipt that is not yet verified", async () => {
    const { world } = ctx
    world.seedReceipts(65)
    const watch = watchCheckpoints(world)
    const report = await runAudit(A(), world)
    expect(report).toMatchObject({ outcome: "completed_cycle", checked: 65 })
    expect(watch.cursors.length).toBeGreaterThanOrEqual(3)
    expect(watch.cursors).toEqual([...watch.cursors].sort((a, b) => a - b))
    const gaps = watch.cursors.map(
      (cursor, i) => cursor - (watch.cursors[i - 1] ?? 0)
    )
    for (const gap of gaps.slice(0, -1)) expect(gap).toBeLessThanOrEqual(20 + 8)
    expect(watch.violations).toEqual([])
  })

  it("runs missing_count once per invocation, not per batch, and not at all when locked", async () => {
    const { world } = ctx
    world.seedReceipts(50)
    await runAudit(A(), world)
    const count = () =>
      world.db.rpcLog.filter(
        (call) => call.name === "media_archive_missing_count"
      ).length
    expect(count()).toBe(1)
    world.db.holdLease("other")
    await runAudit(A(), world)
    expect(count()).toBe(1)
  })

  it("records bytes_verified (blob plus manifest bytes read back) on the run row", async () => {
    const { world } = ctx
    world.seedReceipts(5)
    const expected = world.db
      .rows("media_archive_receipts")
      .reduce(
        (sum, row) =>
          sum +
          Number(row.size_bytes) +
          world.receiptFor(String(row.asset_id)).manifestSize,
        0
      )
    await runAudit(A(), world)
    expect(Number(world.runs()[0].bytes_verified)).toBe(expected)
  })
})

suite(
  "pipelined workers: the cursor follows the contiguous verified watermark (§4.3)",
  () => {
    const slowReceipt = 2

    it("a slow early receipt is never skipped by a checkpoint even though later ones finish first, across a timeout", async () => {
      const { world } = ctx
      world.seedReceipts(40)
      const watch = watchCheckpoints(world)
      const slow = world.bucket.inject({
        op: "verifyOriginal",
        key: String(
          world.db.rows("media_archive_receipts")[slowReceipt - 1].blob_key
        ),
        kind: "latency",
        ms: 5_000_000,
      })
      const first = await runAudit(A(), world)
      expect(first).toMatchObject({
        outcome: "timeout",
        error: "archive_audit_timeout",
      })
      // The rest of the range really was verified out of order...
      const verified = verifiedReceiptIds(world)
      expect(verified).not.toContain(slowReceipt)
      expect(verified.length).toBeGreaterThanOrEqual(30)
      // ...yet the durable cursor never passed the unverified receipt.
      expect(Math.max(0, ...watch.cursors)).toBeLessThan(slowReceipt)
      expect(world.state().cursor_id as number).toBeLessThan(slowReceipt)
      expect(watch.violations).toEqual([])

      slow()
      const resumed = await runAudit(A(), world)
      expect(resumed.outcome).toBe("completed_cycle")
      expect(verifiedReceiptIds(world)).toHaveLength(40)
      expect(verifiedReceiptIds(world)).toContain(slowReceipt)
      expect(watch.violations).toEqual([])
    })

    it("a slow early receipt never blocks the others from being verified, and the cursor catches up when it returns", async () => {
      const { world } = ctx
      world.seedReceipts(40)
      const watch = watchCheckpoints(world)
      world.bucket.inject({
        op: "verifyOriginal",
        key: String(
          world.db.rows("media_archive_receipts")[slowReceipt - 1].blob_key
        ),
        kind: "latency",
        ms: 20_000,
        times: 1,
      })
      const running = startAudit(A(), world)
      await world.clock.advance(5_000)
      expect(verifiedReceiptIds(world).length).toBeGreaterThanOrEqual(30)
      expect(world.state().cursor_id as number).toBeLessThan(slowReceipt)
      const report = await world.clock.drive(running)
      expect(report).toMatchObject({ outcome: "completed_cycle", checked: 40 })
      expect(watch.violations).toEqual([])
      expect(watch.cursors).toEqual([...watch.cursors].sort((a, b) => a - b))
    })

    it("a crash while the slow receipt is outstanding resumes at or below it and skips nothing", async () => {
      const { world } = ctx
      world.seedReceipts(40)
      const watch = watchCheckpoints(world)
      const victim = world.db.killable()
      world.bucket.inject({
        op: "verifyOriginal",
        key: String(
          world.db.rows("media_archive_receipts")[slowReceipt - 1].blob_key
        ),
        kind: "latency",
        ms: 1_000_000,
        times: 1,
      })
      const doomed = startAudit(A(), world, {
        service: victim.client,
        leaseTtlSeconds: 60,
      })
      doomed.catch(() => undefined)
      await world.clock.advance(5_000)
      expect(verifiedReceiptIds(world).length).toBeGreaterThanOrEqual(30)
      victim.kill()
      const durable = world.state().cursor_id as number
      expect(durable).toBeLessThan(slowReceipt)

      await world.clock.advance(61_000)
      world.bucket.calls.length = 0
      const resumed = await runAudit(A(), world)
      expect(resumed).toMatchObject({
        outcome: "completed_cycle",
        cursorFrom: durable,
      })
      expect(verifiedReceiptIds(world)).toContain(slowReceipt)
      expect(verifiedReceiptIds(world)).toHaveLength(40 - durable)
      expect(watch.violations).toEqual([])
    })

    it("a verification failure on an early receipt never lets later receipts advance the cursor past it", async () => {
      const { world } = ctx
      world.seedReceipts(40)
      const watch = watchCheckpoints(world)
      world.bucket.inject({
        op: "verifyManifest",
        key: String(
          world.db.rows("media_archive_receipts")[slowReceipt - 1].manifest_key
        ),
        kind: "corrupt",
      })
      const report = await runAudit(A(), world)
      expect(report).toMatchObject({
        outcome: "failed",
        error: "archive_audit_failed",
      })
      expect(world.state().cursor_id as number).toBeLessThan(slowReceipt)
      expect(Math.max(0, ...watch.cursors)).toBeLessThan(slowReceipt)
      expect(watch.violations).toEqual([])
    })
  }
)

suite("cycle throttle and the idle outcome (§4.3, §4.4)", () => {
  const completeFirstCycle = async () => {
    const { world } = ctx
    world.seedReceipts(3)
    world.bucket.inject({
      op: "verifyOriginal",
      kind: "latency",
      ms: 1_000,
      times: 3,
    })
    const started = world.clock.now()
    const report = await runAudit(A(), world, { concurrency: 1 })
    expect(report.outcome).toBe("completed_cycle")
    world.bucket.calls.length = 0
    return started
  }

  it("before 12 h since the last cycle started, the run is idle: not a failure, still records last_run_at and a run row", async () => {
    const { world } = ctx
    await completeFirstCycle()
    const completeAt = world.state().last_complete_at
    await world.clock.advance(HOUR)
    const report = await runAudit(A(), world)
    expect(report).toMatchObject({
      outcome: "idle",
      complete: false,
      checked: 0,
      error: null,
    })
    expect(world.bucket.callsTo("verifyOriginal")).toEqual([])
    expect(world.state()).toMatchObject({
      cycle_id: null,
      cursor_id: 0,
      last_complete_at: completeAt,
      last_run_at: world.clock.iso(),
      last_run_outcome: "idle",
      last_error: null,
      consecutive_failures: 0,
    })
    expect(world.runs().map((run) => run.outcome)).toEqual([
      "completed_cycle",
      "idle",
    ])
    expect(world.db.leases.size).toBe(0)
  })

  it("the throttle is measured from when the last cycle started, to the millisecond", async () => {
    const { world } = ctx
    const started = await completeFirstCycle()
    await world.clock.advance(started + 12 * HOUR - 1 - world.clock.now())
    expect((await runAudit(A(), world)).outcome).toBe("idle")
    await world.clock.advance(1)
    world.bucket.calls.length = 0
    const next = await runAudit(A(), world, { concurrency: 1 })
    expect(next.outcome).toBe("completed_cycle")
    expect(world.bucket.callsTo("verifyOriginal")).toHaveLength(3)
    // The new cycle's start becomes the next throttle reference.
    expect(world.state().last_complete_cycle_started_at).toBe(
      world.clock.iso(started + 12 * HOUR)
    )
  })

  it("idle still backfills ready originals that have no receipt", async () => {
    const { world } = ctx
    await completeFirstCycle()
    world.addAsset()
    const report = await runAudit(A(), world)
    expect(report).toMatchObject({ outcome: "idle", copied: 1, checked: 0 })
    expect(world.missing()).toBe(0)
    expect(world.state().cycle_id).toBeNull()
  })

  it("idle reports missing originals it could not backfill, and the status stays unhealthy", async () => {
    const { world } = ctx
    await completeFirstCycle()
    world.addAsset({ sourceExists: false })
    const report = await runAudit(A(), world)
    expect(report.outcome).toBe("failed")
    expect(world.state().last_error).toBe("archive_source_unavailable")
    expect((await A().archiveStatus(world.service, world.clock.now())).ok).toBe(
      false
    )
  })

  it("an open cycle is never throttled, so a failed run retries on the next invocation", async () => {
    const { world } = ctx
    await completeFirstCycle()
    await world.clock.advance(12 * HOUR)
    const damage = world.bucket.inject({
      op: "verifyOriginal",
      key: String(world.db.rows("media_archive_receipts")[1].blob_key),
      kind: "error",
      times: 1,
    })
    const failed = await runAudit(A(), world, { concurrency: 1 })
    expect(failed.outcome).toBe("failed")
    damage()
    // Immediately after: well inside 12 h of the new cycle's start, yet it must run.
    const retry = await runAudit(A(), world, { concurrency: 1 })
    expect(retry.outcome).toBe("completed_cycle")
    expect((await runAudit(A(), world)).outcome).toBe("idle")
  })

  it("the very first run on an empty state starts a cycle straight away", async () => {
    const { world } = ctx
    world.seedReceipts(2)
    expect((await runAudit(A(), world)).outcome).toBe("completed_cycle")
  })

  it("keeps the age of the last complete cycle under 26 h across repeated cycles at the 12 h cadence", async () => {
    const { world } = ctx
    const cycle = 3 * HOUR
    // 18 receipts at 10 minutes each: a 3 h cycle that spans several 16 min runs.
    world.seedReceipts(18)
    world.bucket.inject({
      op: "verifyOriginal",
      kind: "latency",
      ms: cycle / 18,
    })
    let worstAge = 0
    let last = Number.NaN
    // Ten simulated days of 10-minute cron invocations, each allowed a long budget.
    for (let tick = 0; tick < 24 * 10 * 6; tick++) {
      await world.clock.advance(600_000)
      const report = await runAudit(A(), world, {
        concurrency: 1,
        softBudgetMs: 1_000_000,
        deadlineMs: 1_700_000,
      })
      expect(["idle", "completed_cycle", "partial"]).toContain(report.outcome)
      const completed = Date.parse(String(world.state().last_complete_at ?? ""))
      if (Number.isFinite(completed)) {
        last = completed
        worstAge = Math.max(worstAge, world.clock.now() - last)
      }
    }
    expect(Number.isFinite(last)).toBe(true)
    expect(worstAge).toBeLessThan(A().ARCHIVE_MAX_AGE_MS)
  })
})
