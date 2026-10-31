import { describe, expect, it, vi } from "vitest"

import {
  ERROR_CODES,
  HARD_DEADLINE_MS,
  loadAudit,
  runAudit,
  startAudit,
  verifiedReceiptIds,
  type AuditModule,
} from "../support/driver"
import type { Operation } from "../support/fake-db"
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

// Store errors, corruption, hangs, timeouts, stale late results, checkpoint
// and DB failures (§4.2, §4.3, §4.4). Skipped until Audit's code is present.
const audit = await loadAudit()
const suite = describe.skipIf(!audit)
const A = () => audit as AuditModule
const ctx = setupWorld()

const stateUpdate = (op: Operation) =>
  op.kind === "update" && op.table === "media_archive_audit_state"
const checkpoint = (op: Operation) =>
  stateUpdate(op) &&
  op.kind === "update" &&
  typeof op.patch?.cursor_id === "number" &&
  op.patch.cursor_id > 0 &&
  op.patch.last_complete_at === undefined
const completionWrite = (op: Operation) =>
  stateUpdate(op) &&
  op.kind === "update" &&
  op.patch?.last_complete_at !== undefined

const receipt = (id: number) =>
  ctx.world.db.rows("media_archive_receipts").find((row) => row.id === id)!

suite("store failures: error, corruption, missing object (§4.2, §4.4)", () => {
  const damages = ["error", "corrupt", "vanish"] as const
  const targets = [
    { op: "verifyOriginal", column: "blob_key" },
    { op: "verifyManifest", column: "manifest_key" },
  ] as const

  for (const damage of damages) {
    for (const target of targets) {
      it(`${damage} on ${target.op} at receipt 4 fails the run, stops the cursor below it and heals after repair`, async () => {
        const { world } = ctx
        world.seedReceipts(8)
        const key = String(receipt(4)[target.column])
        const fault = world.bucket.inject({
          op: target.op,
          key,
          kind: damage,
          ...(damage === "error"
            ? { error: "SECRET_PROVIDER_DETAIL_xyz" }
            : {}),
        })
        const options = { checkpointEvery: 2, concurrency: 2 }

        for (const expected of [1, 2, 3]) {
          const report = await runAudit(A(), world, options)
          expect(report).toMatchObject({
            outcome: "failed",
            complete: false,
            error: "archive_audit_failed",
          })
          const state = world.state()
          // No skipped receipt: the cursor never passes the damaged one.
          expect(state.cursor_id).toBeGreaterThanOrEqual(2)
          expect(state.cursor_id).toBeLessThan(4)
          expect(state).toMatchObject({
            last_complete_at: null,
            last_error: "archive_audit_failed",
            last_run_outcome: "failed",
            consecutive_failures: expected,
          })
          expect(ERROR_CODES).toContain(state.last_error)
        }
        // Provider messages are never persisted or returned.
        expect(JSON.stringify([world.state(), world.runs()])).not.toContain(
          "SECRET_PROVIDER_DETAIL"
        )
        const cycleId = world.state().cycle_id
        expect(cycleId).not.toBeNull()

        fault()
        world.reseed(4)
        const healed = await runAudit(A(), world, options)
        expect(healed.outcome).toBe("completed_cycle")
        expect(verifiedReceiptIds(world)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
        expect(world.runs().at(-1)?.cycle_id).toBe(cycleId)
        expect(world.state()).toMatchObject({
          last_error: null,
          consecutive_failures: 0,
          cycle_id: null,
        })
      })
    }
  }

  it("a damaged object in the first batch fails without any checkpoint and without completing", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    world.bucket.inject({
      op: "verifyOriginal",
      key: String(receipt(1).blob_key),
      kind: "corrupt",
    })
    const report = await runAudit(A(), world)
    expect(report.outcome).toBe("failed")
    expect(world.state().cursor_id).toBe(0)
    expect(world.state().last_complete_at).toBeNull()
  })

  it("concurrent verification with uneven latencies never skips a receipt and never moves the cursor backwards", async () => {
    const { world } = ctx
    world.seedReceipts(20)
    for (let id = 1; id <= 20; id++)
      world.bucket.inject({
        op: "verifyOriginal",
        key: String(receipt(id).blob_key),
        kind: "latency",
        ms: (id * 379) % 900,
      })
    const report = await runAudit(A(), world, {
      checkpointEvery: 7,
      concurrency: 4,
    })
    expect(report).toMatchObject({ outcome: "completed_cycle", checked: 20 })
    expect(verifiedReceiptIds(world)).toHaveLength(20)
    const cursors = world.db.writeLog
      .filter((entry) => checkpoint(entry.op))
      .map(
        (entry) =>
          (entry.op as unknown as { patch: { cursor_id: number } }).patch
            .cursor_id
      )
    expect(cursors.length).toBeGreaterThanOrEqual(3)
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b))
  })

  it("a store failure while backfilling fails with a store error and leaves the original missing", async () => {
    const { world } = ctx
    world.seedReceipts(2)
    world.addAsset()
    world.bucket.inject({
      op: "putOriginalIfAbsent",
      kind: "error",
      error: "archive_destination_write_failed",
    })
    const report = await runAudit(A(), world)
    expect(report).toMatchObject({
      outcome: "failed",
      error: "archive_store_unavailable",
      copied: 0,
    })
    expect(world.missing()).toBe(1)
    expect(world.state().last_complete_at).toBeNull()
  })
})

suite("hangs and timeouts (§4.3, §4.4)", () => {
  it("a store call that honours the signal ends the run as timeout at the hard deadline, keeping checkpointed progress", async () => {
    const { world } = ctx
    world.seedReceipts(6)
    world.bucket.inject({
      op: "verifyOriginal",
      key: String(receipt(5).blob_key),
      kind: "hang",
    })
    const started = world.clock.now()
    const report = await runAudit(A(), world, {
      checkpointEvery: 2,
      concurrency: 1,
    })
    // The cursor advanced, yet the outcome stays `timeout`, not `partial`.
    expect(report).toMatchObject({
      outcome: "timeout",
      complete: false,
      error: "archive_audit_timeout",
      cursorFrom: 0,
      cursorTo: 4,
    })
    expect(world.clock.now() - started).toBeLessThanOrEqual(
      HARD_DEADLINE_MS + 1_000
    )
    expect(world.state()).toMatchObject({
      cursor_id: 4,
      last_run_outcome: "timeout",
      last_error: "archive_audit_timeout",
      consecutive_failures: 1,
      last_complete_at: null,
    })
    expect(world.runs().at(-1)).toMatchObject({
      outcome: "timeout",
      cursor_to: 4,
    })
    expect(world.db.leases.size).toBe(0)
  })

  it("a store that ignores the abort signal still yields timeout at the deadline, and its late result changes nothing", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    // Only receipt 3 is slow, so when it eventually returns the cycle could complete.
    world.bucket.inject({
      op: "verifyOriginal",
      key: String(receipt(3).blob_key),
      kind: "hang",
      ignoreSignal: true,
      ms: 900_000,
    })
    const started = world.clock.now()
    const report = await runAudit(A(), world, {
      checkpointEvery: 3,
      concurrency: 3,
    })
    expect(report).toMatchObject({
      outcome: "timeout",
      error: "archive_audit_timeout",
    })
    expect(world.clock.now() - started).toBeLessThanOrEqual(
      HARD_DEADLINE_MS + 1_000
    )

    const snapshot = JSON.stringify([world.state(), world.runs()])
    const writes = world.db.writeLog.length
    // The hung call resolves long after the run ended.
    await world.clock.advance(500_000)
    expect(world.db.writeLog.length).toBe(writes)
    expect(JSON.stringify([world.state(), world.runs()])).toBe(snapshot)
    expect(world.state().last_complete_at).toBeNull()
  })

  it("repeated timeouts accumulate consecutive_failures and a later partial/complete run clears them", async () => {
    const { world } = ctx
    world.seedReceipts(4)
    const hang = world.bucket.inject({
      op: "verifyOriginal",
      key: String(receipt(3).blob_key),
      kind: "hang",
    })
    for (const expected of [1, 2]) {
      await runAudit(A(), world, { checkpointEvery: 2, concurrency: 1 })
      expect(world.state().consecutive_failures).toBe(expected)
      // Let the previous run's lease lapse in simulated time.
      await world.clock.advance(60_000)
    }
    hang()
    const report = await runAudit(A(), world, {
      checkpointEvery: 2,
      concurrency: 1,
    })
    expect(report.outcome).toBe("completed_cycle")
    expect(world.state()).toMatchObject({
      consecutive_failures: 0,
      last_error: null,
    })
  })

  it("a hang while backfilling a missing original also ends in timeout", async () => {
    const { world } = ctx
    world.addAsset()
    world.bucket.inject({
      op: "putOriginalIfAbsent",
      kind: "hang",
      ignoreSignal: true,
    })
    const report = await runAudit(A(), world)
    expect(report).toMatchObject({
      outcome: "timeout",
      error: "archive_audit_timeout",
    })
    expect(world.state().last_complete_at).toBeNull()
  })

  it("the soft budget wins over the hard deadline for a slow but progressing library", async () => {
    const { world } = ctx
    world.seedReceipts(40)
    // 40 x 20 s = 800 s of work: past the 480 s soft budget, with each
    // in-flight receipt still finishing inside the 540 s hard deadline.
    world.bucket.inject({ op: "verifyOriginal", kind: "latency", ms: 20_000 })
    const report = await runAudit(A(), world, {
      checkpointEvery: 5,
      concurrency: 1,
      softBudgetMs: A().ARCHIVE_AUDIT_SOFT_BUDGET_MS,
    })
    expect(report.outcome).toBe("partial")
    expect(report.error).toBeNull()
  })
})

suite("database failures: checkpoint, completion, reads (§4.2, §4.4)", () => {
  it("a failing checkpoint write ends failed/archive_checkpoint_failed and never leaves the cursor past verified receipts", async () => {
    const { world } = ctx
    world.seedReceipts(6)
    world.db.inject({
      match: checkpoint,
      after: 1,
      times: 1,
      error: { code: "57014", message: "boom" },
    })
    const report = await runAudit(A(), world, {
      checkpointEvery: 2,
      concurrency: 1,
    })
    expect(report).toMatchObject({
      outcome: "failed",
      error: "archive_checkpoint_failed",
    })
    // The failed write is not retried, but progress verified before the stop
    // is saved by the final checkpoint: never less than the earlier durable 2,
    // never more than what was read back.
    expect(world.state().cursor_id).toBeGreaterThanOrEqual(2)
    expect(world.state().cursor_id).toBeLessThanOrEqual(
      verifiedReceiptIds(world).length
    )
    expect(world.state().last_complete_at).toBeNull()
    const durable = world.state().cursor_id
    const next = await runAudit(A(), world, {
      checkpointEvery: 2,
      concurrency: 1,
    })
    expect(next).toMatchObject({
      outcome: "completed_cycle",
      cursorFrom: durable,
    })
  })

  it("a failing completion write never leaves a false completion, and the next run completes", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    world.db.inject({
      match: completionWrite,
      times: 1,
      error: { code: "57014", message: "boom" },
    })
    const report = await runAudit(A(), world)
    expect(report.outcome).toBe("failed")
    expect(ERROR_CODES).toContain(report.error)
    expect(world.state().last_complete_at).toBeNull()
    expect(world.state().cycle_id).not.toBeNull()
    expect((await runAudit(A(), world)).outcome).toBe("completed_cycle")
  })

  it("an unknown missing count (RPC error) cannot complete a cycle", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    world.db.inject({
      match: (op) =>
        op.kind === "rpc" && op.name === "media_archive_missing_count",
      times: 1,
      error: { code: "57014", message: "boom" },
    })
    const report = await runAudit(A(), world)
    expect(report.outcome).toBe("failed")
    expect(report.complete).toBe(false)
    expect(world.state().last_complete_at).toBeNull()
  })

  it("a receipt read error is a failed run, not a completed empty cycle", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    world.db.inject({
      match: (op) =>
        op.kind === "select" && op.table === "media_archive_receipts",
      times: 1,
      error: { code: "57014", message: "boom" },
    })
    const report = await runAudit(A(), world)
    expect(report.outcome).toBe("failed")
    expect(world.state().last_complete_at).toBeNull()
    expect(world.db.leases.size).toBe(0)
  })

  it("an unreadable state row after the lease is owned is returned as failed (not thrown) and releases the lease", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    world.db.inject({
      match: (op) =>
        op.kind === "select" && op.table === "media_archive_audit_state",
      times: 1,
      error: { code: "57014", message: "boom" },
    })
    const report = await runAudit(A(), world)
    expect(report.outcome).toBe("failed")
    expect(world.db.leases.size).toBe(0)
    expect(world.state().last_complete_at).toBeNull()
  })

  it("a late completion cannot be forged by a stale run: after a timeout nothing writes completion", async () => {
    const { world } = ctx
    world.seedReceipts(2)
    world.bucket.inject({
      op: "verifyManifest",
      key: String(receipt(2).manifest_key),
      kind: "hang",
      ignoreSignal: true,
      ms: 900_000,
    })
    await runAudit(A(), world, { checkpointEvery: 2, concurrency: 2 })
    await world.clock.advance(400_000)
    expect(
      world.db.writeLog.filter((entry) => completionWrite(entry.op))
    ).toEqual([])
    expect(world.state().last_complete_at).toBeNull()
  })
})

suite("start/stop plumbing", () => {
  it("closes only stores the audit created itself (injected stores belong to the caller)", async () => {
    const { world } = ctx
    world.seedReceipts(1)
    await runAudit(A(), world)
    expect(world.bucket.closed).toBe(0)
  })

  it("startAudit leaves no pending timers or leases after completion", async () => {
    const { world } = ctx
    world.seedReceipts(2)
    await world.clock.drive(startAudit(A(), world))
    expect(world.db.leases.size).toBe(0)
  })
})
