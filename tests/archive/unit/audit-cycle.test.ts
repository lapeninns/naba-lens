import { describe, expect, it, vi } from "vitest"

import {
  ERROR_CODES,
  loadAudit,
  runAudit,
  runCycle,
  verifiedReceiptIds,
  type AuditModule,
} from "../support/driver"
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

// Contract §4.2 (stored state), §4.4 (outcomes). Skipped until Audit's code
// (injectable runArchiveAudit + constants) is present on this branch.
const audit = await loadAudit()
const suite = describe.skipIf(!audit)
const A = () => audit as AuditModule
const ctx = setupWorld()

suite("audit cycle: completion, partial runs, resume (§4.2, §4.4)", () => {
  it("[4.4 completed_cycle] verifies every receipt once and records the cycle", async () => {
    const { world } = ctx
    world.seedReceipts(12)
    const started = world.clock.now()
    world.bucket.inject({ op: "verifyOriginal", kind: "latency", ms: 500 })
    const report = await runAudit(A(), world, { batchSize: 5, concurrency: 1 })
    const finished = world.clock.now()

    expect(report).toMatchObject({
      outcome: "completed_cycle",
      complete: true,
      checked: 12,
      missing: 0,
      error: null,
    })
    expect(verifiedReceiptIds(world)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1)
    )
    const state = world.state()
    expect(state).toMatchObject({
      cursor_id: 0,
      cycle_id: null,
      cycle_started_at: null,
      cycle_target_id: null,
      cycle_checked: 0,
      last_run_outcome: "completed_cycle",
      last_error: null,
      consecutive_failures: 0,
    })
    const completeAt = Date.parse(String(state.last_complete_at))
    expect(completeAt).toBeGreaterThanOrEqual(started + 6_000)
    expect(completeAt).toBeLessThanOrEqual(finished)
    expect(Date.parse(String(state.last_complete_cycle_started_at))).toBe(
      started
    )
    expect(state.last_cycle_duration_seconds).toBe(
      Math.round((completeAt - started) / 1000)
    )
    expect(Date.parse(String(state.last_run_at))).toBeGreaterThanOrEqual(
      completeAt
    )
  })

  it("[4.2] an empty library completes immediately", async () => {
    const { world } = ctx
    const report = await runAudit(A(), world)
    expect(report).toMatchObject({
      outcome: "completed_cycle",
      checked: 0,
      missing: 0,
    })
    expect(world.state().last_complete_at).not.toBeNull()
  })

  it("[4.4 partial] a soft budget stops new work, keeps progress and is not a failure", async () => {
    const { world } = ctx
    world.seedReceipts(12)
    world.bucket.inject({ op: "verifyOriginal", kind: "latency", ms: 600 })
    const report = await runAudit(A(), world, {
      batchSize: 2,
      concurrency: 1,
      softBudgetMs: 1_000,
    })
    expect(report).toMatchObject({
      outcome: "partial",
      complete: false,
      error: null,
      cursorFrom: 0,
    })
    expect(report.checked).toBeGreaterThan(0)
    expect(report.checked).toBeLessThan(12)
    const state = world.state()
    expect(state).toMatchObject({
      cursor_id: report.cursorTo,
      cycle_checked: report.checked,
      cycle_target_id: 12,
      cycle_target_count: 12,
      last_run_outcome: "partial",
      last_error: null,
      consecutive_failures: 0,
      last_complete_at: null,
    })
    expect(state.cycle_id).toEqual(expect.any(String))
    expect(state.cycle_started_at).not.toBeNull()
  })

  it("[4.3 resume] a multi-invocation cycle keeps one cycle_id, moves the cursor forward and verifies each receipt exactly once", async () => {
    const { world } = ctx
    world.seedReceipts(12)
    world.bucket.inject({ op: "verifyOriginal", kind: "latency", ms: 600 })
    const options = { batchSize: 2, concurrency: 1, softBudgetMs: 1_000 }
    const cycleIds = new Set<unknown>()
    const cursors: number[] = []
    let reports = 0
    for (;;) {
      const report = await runAudit(A(), world, options)
      reports++
      if (report.outcome === "completed_cycle") break
      expect(report.outcome).toBe("partial")
      cycleIds.add(world.state().cycle_id)
      cursors.push(world.state().cursor_id as number)
      expect(world.state().last_complete_at).toBeNull()
      expect(reports).toBeLessThan(20)
    }
    expect(reports).toBeGreaterThanOrEqual(3)
    expect(cycleIds.size).toBe(1)
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b))
    // No re-verification without a crash, and nothing skipped.
    const originals = world.bucket.callsTo("verifyOriginal").map((c) => c.key)
    expect(new Set(originals).size).toBe(12)
    expect(originals).toHaveLength(12)
    expect(verifiedReceiptIds(world)).toHaveLength(12)
    expect(world.runs().map((r) => r.outcome)).toEqual([
      ...Array(reports - 1).fill("partial"),
      "completed_cycle",
    ])
  })

  it("[4.1/4.2] receipts created after the cycle started are not required for it, and are picked up by the next cycle", async () => {
    const { world } = ctx
    world.seedReceipts(6)
    world.bucket.inject({ op: "verifyOriginal", kind: "latency", ms: 600 })
    const options = { batchSize: 2, concurrency: 1, softBudgetMs: 1_000 }
    const first = await runAudit(A(), world, options)
    expect(first.outcome).toBe("partial")
    const target = world.state().cycle_target_id
    expect(target).toBe(6)
    world.seedReceipts(3)

    const reports = await runCycle(A(), world, options)
    expect(reports.at(-1)?.outcome).toBe("completed_cycle")
    expect(verifiedReceiptIds(world)).toEqual([1, 2, 3, 4, 5, 6])
    expect(world.state().cycle_id).toBeNull()

    world.bucket.calls.length = 0
    // The cycle throttle holds the next cycle back for 12 h from the last start.
    await world.clock.advance(12 * 3_600_000)
    const next = await runCycle(A(), world, options)
    expect(next.at(-1)?.outcome).toBe("completed_cycle")
    expect(verifiedReceiptIds(world)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it("[4.2] the first run of a cycle records its target before verifying anything", async () => {
    const { world } = ctx
    world.seedReceipts(4)
    world.bucket.inject({
      op: "verifyOriginal",
      kind: "hang",
      ignoreSignal: true,
    })
    const pending = A().runArchiveAudit(world.service, {
      store: world.bucket.store(),
      now: world.clock.now,
      signal: world.clock.deadline(90_000),
    })
    pending.catch(() => undefined)
    await world.clock.advance(1_000)
    expect(world.state()).toMatchObject({
      cycle_target_id: 4,
      cycle_target_count: 4,
      cursor_id: 0,
      cycle_checked: 0,
    })
    expect(world.state().cycle_id).toEqual(expect.any(String))
    await world.clock.drive(pending)
  })

  it("[4.2] receipt id gaps do not corrupt the target count or completion", async () => {
    const { world } = ctx
    world.seedReceipts(5)
    // Conflicting upserts consume identity values: ids 3 and 4 never exist.
    world.db.rows("media_archive_receipts").splice(2, 2)
    const report = await runAudit(A(), world, { batchSize: 2 })
    expect(report).toMatchObject({ outcome: "completed_cycle", checked: 3 })
    expect(verifiedReceiptIds(world)).toEqual([1, 2, 5])
  })

  it("[4.2/4.4 no false completion] unarchived ready originals beyond the backfill limit keep the cycle open", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    for (let i = 0; i < 7; i++) world.addAsset()
    const first = await runAudit(A(), world, { backfillLimit: 5 })
    expect(first).toMatchObject({ copied: 5, missing: 2, complete: false })
    expect(first.outcome).not.toBe("completed_cycle")
    expect(world.state().last_complete_at).toBeNull()
    expect(world.state().cycle_id).not.toBeNull()

    const second = await runAudit(A(), world, { backfillLimit: 5 })
    expect(second).toMatchObject({
      outcome: "completed_cycle",
      copied: 2,
      missing: 0,
    })
    expect(world.state().last_complete_at).not.toBeNull()
    expect(world.missing()).toBe(0)
  })

  it("[4.2/4.4 missing original] a ready asset whose source is gone fails the run with a source error and never completes", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    const gone = world.addAsset({ sourceExists: false })
    const report = await runAudit(A(), world)
    expect(report).toMatchObject({
      outcome: "failed",
      complete: false,
      error: "archive_source_unavailable",
    })
    expect(world.state()).toMatchObject({
      last_complete_at: null,
      last_error: "archive_source_unavailable",
      last_run_outcome: "failed",
      consecutive_failures: 1,
    })
    expect(world.missing()).toBe(1)

    // The original reappears (restored from backup): the next run heals.
    world.sources.add(gone)
    const healed = await runAudit(A(), world)
    expect(healed).toMatchObject({ outcome: "completed_cycle", missing: 0 })
    expect(world.state()).toMatchObject({
      last_error: null,
      consecutive_failures: 0,
    })
  })

  it("[4.2] partial runs never refresh last_complete_at", async () => {
    const { world } = ctx
    const old = world.clock.iso(world.clock.now() - 25 * 3_600_000)
    world.setState({ last_complete_at: old })
    world.seedReceipts(8)
    world.bucket.inject({ op: "verifyOriginal", kind: "latency", ms: 600 })
    for (let i = 0; i < 2; i++) {
      const report = await runAudit(A(), world, {
        batchSize: 2,
        concurrency: 1,
        softBudgetMs: 1_000,
      })
      expect(report.outcome).toBe("partial")
      expect(world.state().last_complete_at).toBe(old)
    }
  })

  it("[4.2] consecutive_failures counts failed/timeout runs and resets on the next non-failing run", async () => {
    const { world } = ctx
    world.seedReceipts(4)
    const heal = world.bucket.inject({
      op: "verifyOriginal",
      kind: "error",
      key: world.db.rows("media_archive_receipts")[2].blob_key as string,
    })
    for (const expected of [1, 2, 3]) {
      const report = await runAudit(A(), world, {
        batchSize: 2,
        concurrency: 1,
      })
      expect(report.outcome).toBe("failed")
      expect(world.state().consecutive_failures).toBe(expected)
    }
    heal()
    const ok = await runAudit(A(), world, { batchSize: 2, concurrency: 1 })
    expect(ok.outcome).toBe("completed_cycle")
    expect(world.state()).toMatchObject({
      consecutive_failures: 0,
      last_error: null,
    })
  })

  it("[4.2] a run's timestamps come from the injected clock", async () => {
    const { world } = ctx
    world.seedReceipts(2)
    await world.clock.advance(7 * 3_600_000)
    const at = world.clock.iso()
    await runAudit(A(), world)
    expect(world.state().last_run_at).toBe(at)
    expect(world.state().last_complete_at).toBe(at)
    expect(world.runs()[0].started_at).toBe(at)
  })
})

suite("audit runs table: one row per invocation (§4.2)", () => {
  it("records every outcome with counts, cursors and an allowed error code", async () => {
    const { world } = ctx
    world.seedReceipts(6)
    const bad = world.db.rows("media_archive_receipts")[3].blob_key as string
    const fault = world.bucket.inject({
      op: "verifyOriginal",
      key: bad,
      kind: "error",
    })
    await runAudit(A(), world, { batchSize: 2, concurrency: 1 })
    fault()
    world.db.holdLease("other-holder")
    await runAudit(A(), world)
    world.db.leases.clear()
    await runAudit(A(), world, { batchSize: 2, concurrency: 1 })

    const runs = world.runs()
    expect(runs.map((r) => r.outcome)).toEqual([
      "failed",
      "locked",
      "completed_cycle",
    ])
    const [failed, locked, completed] = runs
    expect(failed).toMatchObject({
      checked: 3,
      error: expect.stringMatching(/^archive_/),
      cursor_from: 0,
      cursor_to: 3,
    })
    expect(ERROR_CODES).toContain(failed.error)
    expect(locked).toMatchObject({
      cycle_id: null,
      cursor_from: null,
      cursor_to: null,
    })
    expect(completed).toMatchObject({ checked: 3, error: null, cursor_from: 3 })
    for (const run of runs) {
      expect(run.run_id).toMatch(/^[0-9a-f-]{36}$/)
      expect(Date.parse(String(run.started_at))).toBeLessThanOrEqual(
        Date.parse(String(run.finished_at))
      )
    }
    expect(new Set(runs.map((r) => r.run_id)).size).toBe(3)
    expect(failed.cycle_id).toBe(completed.cycle_id)
  })

  it("never updates its own rows; retention deletes only rows older than 90 days", async () => {
    const { world } = ctx
    const day = 86_400_000
    const row = (ageDays: number) => ({
      run_id: crypto.randomUUID(),
      cycle_id: null,
      started_at: world.clock.iso(world.clock.now() - ageDays * day),
      finished_at: world.clock.iso(world.clock.now() - ageDays * day),
      outcome: "partial",
      checked: 1,
      copied: 0,
      missing: 0,
      error: null,
      cursor_from: 0,
      cursor_to: 1,
    })
    await world.service
      .from("media_archive_audit_runs" as never)
      .insert([row(91), row(89), row(1)] as never)
    world.seedReceipts(1)
    await runAudit(A(), world)
    const ages = world
      .runs()
      .map((r) =>
        Math.round(
          (world.clock.now() - Date.parse(String(r.finished_at))) / day
        )
      )
    expect(ages).not.toContain(91)
    expect(ages).toEqual(expect.arrayContaining([89, 1, 0]))
    expect(
      world.db.writeLog.filter(
        (entry) =>
          entry.op.kind === "update" &&
          entry.op.table === "media_archive_audit_runs"
      )
    ).toEqual([])
  })
})
