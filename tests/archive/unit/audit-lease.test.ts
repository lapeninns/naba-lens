import { describe, expect, it, vi } from "vitest"

import {
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

// Contract §4.3 (lease, resume, overlap) and the crash/lease-loss rows of §4.4.
const audit = await loadAudit()
const suite = describe.skipIf(!audit)
const A = () => audit as AuditModule
const ctx = setupWorld()

const isRpc = (name: string) => (op: Operation) =>
  op.kind === "rpc" && op.name === name
const isStateUpdate = (op: Operation) =>
  op.kind === "update" && op.table === "media_archive_audit_state"
const isCheckpoint = (op: Operation) =>
  isStateUpdate(op) &&
  op.kind === "update" &&
  typeof op.patch?.cursor_id === "number" &&
  op.patch.cursor_id > 0 &&
  op.patch.last_complete_at === undefined

const acquires = () =>
  ctx.world.db.rpcLog.filter(
    (call) => call.name === "acquire_maintenance_lease"
  )

suite("lease: acquire, renew, release (§4.3)", () => {
  it("uses the media_archive_audit lease with a fresh holder per invocation and releases it", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    await runAudit(A(), world)
    await runAudit(A(), world)
    const holders = new Set(acquires().map((call) => call.args.p_holder))
    expect(holders.size).toBe(2)
    for (const call of acquires())
      expect(call.args.p_name).toBe("media_archive_audit")
    expect(world.db.leases.size).toBe(0)
    const releases = world.db.rpcLog.filter(
      (call) => call.name === "release_maintenance_lease"
    )
    expect(releases.map((call) => call.args.p_holder).sort()).toEqual(
      [...holders].sort()
    )
  })

  it("the lease TTL exceeds the invocation deadline", () => {
    expect(A().ARCHIVE_AUDIT_LEASE_TTL_SECONDS * 1000).toBeGreaterThan(
      A().ARCHIVE_AUDIT_DEADLINE_MS
    )
    expect(A().ARCHIVE_AUDIT_DEADLINE_MS).toBeGreaterThan(
      A().ARCHIVE_AUDIT_SOFT_BUDGET_MS
    )
    // Route maxDuration is 600 s; the hard deadline keeps at least 60 s under it.
    expect(A().ARCHIVE_AUDIT_DEADLINE_MS).toBeLessThanOrEqual(540_000)
  })

  it("acquires with the exported TTL by default", async () => {
    const { world } = ctx
    world.seedReceipts(1)
    await runAudit(A(), world)
    const ttl = parseFloat(String(acquires()[0].args.p_ttl))
    expect(ttl).toBe(A().ARCHIVE_AUDIT_LEASE_TTL_SECONDS)
  })

  it("renews (same holder) at least once per batch and before each checkpoint", async () => {
    const { world } = ctx
    world.seedReceipts(12)
    await runAudit(A(), world, { batchSize: 3, concurrency: 1 })
    const calls = acquires()
    expect(new Set(calls.map((call) => call.args.p_holder)).size).toBe(1)
    // 1 acquire + >= 1 renewal for each of the 4 batches.
    expect(calls.length).toBeGreaterThanOrEqual(5)
    // A renewal precedes every checkpoint write.
    const log = world.db.writeLog
    log.forEach((entry, index) => {
      if (!isCheckpoint(entry.op)) return
      const before = log.slice(0, index).reverse()
      const lastAcquire = before.findIndex((candidate) =>
        isRpc("acquire_maintenance_lease")(candidate.op)
      )
      const lastCheckpoint = before.findIndex((candidate) =>
        isCheckpoint(candidate.op)
      )
      expect(lastAcquire).toBeGreaterThanOrEqual(0)
      if (lastCheckpoint >= 0) expect(lastAcquire).toBeLessThan(lastCheckpoint)
    })
  })

  it("keeps a long run alive past the initial TTL by renewing", async () => {
    const { world } = ctx
    world.seedReceipts(6)
    world.bucket.inject({ op: "verifyOriginal", kind: "latency", ms: 12_000 })
    const report = await runAudit(A(), world, {
      batchSize: 2,
      concurrency: 1,
      leaseTtlSeconds: 30,
      deadlineMs: 600_000,
      softBudgetMs: 600_000,
    })
    // 6 receipts x 12 s = 72 s > the 30 s TTL, so completion proves renewal.
    expect(report.outcome).toBe("completed_cycle")
  })
})

suite("overlapping runs (§4.3)", () => {
  it("a second invocation while the lease is held returns locked and touches no state", async () => {
    const { world } = ctx
    world.seedReceipts(6)
    world.bucket.inject({ op: "verifyOriginal", kind: "latency", ms: 5_000 })
    const first = startAudit(A(), world, { batchSize: 2, concurrency: 1 })
    await world.clock.advance(1_000)
    const before = world.state()
    const writes = world.db.writeLog.length
    const second = await runAudit(A(), world)
    expect(second).toMatchObject({
      outcome: "locked",
      complete: false,
      checked: 0,
      copied: 0,
      cursorFrom: null,
      cursorTo: null,
    })
    expect(world.state()).toEqual(before)
    const secondWrites = world.db.writeLog.slice(writes)
    expect(
      secondWrites.filter(
        (entry) => entry.op.kind !== "rpc" && entry.op.kind !== "insert"
      )
    ).toEqual([])
    const lease = world.db.leases.get("media_archive_audit")
    expect(lease).toBeDefined()
    await world.clock.drive(first)
    expect((await first).outcome).toBe("completed_cycle")
    expect(world.runs().map((r) => r.outcome)).toEqual([
      "locked",
      "completed_cycle",
    ])
  })

  it("locked is not a failure: failure counters and errors are unchanged", async () => {
    const { world } = ctx
    world.setState({
      last_error: "archive_audit_failed",
      consecutive_failures: 2,
    })
    world.db.holdLease("someone-else")
    const report = await runAudit(A(), world)
    expect(report.outcome).toBe("locked")
    expect(world.state()).toMatchObject({
      last_error: "archive_audit_failed",
      consecutive_failures: 2,
      last_run_outcome: null,
    })
    expect(world.db.leases.get("media_archive_audit")?.holder).toBe(
      "someone-else"
    )
  })

  it("a lease RPC error before the lease is owned throws archive_lease_failed and writes nothing", async () => {
    const { world } = ctx
    world.seedReceipts(2)
    world.db.inject({
      match: isRpc("acquire_maintenance_lease"),
      error: { code: "57014", message: "statement timeout" },
    })
    await expect(runAudit(A(), world)).rejects.toThrow("archive_lease_failed")
    expect(world.db.writeLog).toEqual([])
    expect(world.runs()).toEqual([])
  })

  it("an archive that is disabled and has no injected store throws archive_disabled before touching the lease", async () => {
    const { world } = ctx
    const { mocked } = await import("../support/module-mocks")
    mocked.archiveDisabled = true
    await expect(
      A().runArchiveAudit(world.service, { now: world.clock.now })
    ).rejects.toThrow("archive_disabled")
    expect(world.db.rpcLog).toEqual([])
    expect(world.db.writeLog).toEqual([])
  })
})

suite("lease loss (§4.3, §4.4)", () => {
  it("renewal returning false mid-run stops all writes, records only a run row and leaves state to the new holder", async () => {
    const { world } = ctx
    world.seedReceipts(12)
    let stolenAtWrite = -1
    let cursorAtLoss = -1
    world.db.inject({
      match: isRpc("acquire_maintenance_lease"),
      after: 4,
      times: 1,
      before: () => {
        stolenAtWrite = world.db.writeLog.length
        cursorAtLoss = world.state().cursor_id as number
        world.db.stealLease("00000000-0000-4000-8000-00000000dead")
      },
    })
    const report = await runAudit(A(), world, { batchSize: 3, concurrency: 1 })
    expect(report).toMatchObject({
      outcome: "lease_lost",
      complete: false,
      error: "archive_lease_lost",
    })
    expect(stolenAtWrite).toBeGreaterThan(0)
    // After the loss: no state, receipt or lease writes. Only the run row.
    const after = world.db.writeLog.slice(stolenAtWrite)
    expect(
      after.filter(
        (entry) =>
          entry.op.kind === "update" ||
          (entry.op.kind === "insert" &&
            entry.op.table !== "media_archive_audit_runs") ||
          (entry.op.kind === "rpc" &&
            entry.op.name !== "acquire_maintenance_lease" &&
            entry.op.name !== "release_maintenance_lease")
      )
    ).toEqual([])
    expect(world.state().cursor_id).toBe(cursorAtLoss)
    expect(world.state()).toMatchObject({
      last_run_outcome: null,
      last_error: null,
      consecutive_failures: 0,
      last_complete_at: null,
    })
    // The loser must not release the new holder's lease.
    expect(world.db.leases.get("media_archive_audit")?.holder).toBe(
      "00000000-0000-4000-8000-00000000dead"
    )
    expect(world.runs()).toHaveLength(1)
    expect(world.runs()[0]).toMatchObject({
      outcome: "lease_lost",
      error: "archive_lease_lost",
    })
  })

  it("an injected lease client returning false is honoured the same way", async () => {
    const { world } = ctx
    world.seedReceipts(6)
    let calls = 0
    const report = await runAudit(A(), world, {
      batchSize: 2,
      lease: {
        acquire: async () => ++calls <= 2,
        release: async () => undefined,
      },
    })
    expect(report.outcome).toBe("lease_lost")
    expect(world.state().last_run_outcome).not.toBe("lease_lost")
    expect(world.state().consecutive_failures).toBe(0)
  })

  it("a lease that expires during a slow batch is lost to another worker, whose cycle state is never overwritten", async () => {
    const { world } = ctx
    world.seedReceipts(6)
    const options = {
      batchSize: 3,
      concurrency: 3,
      leaseTtlSeconds: 30,
      deadlineMs: 600_000,
      softBudgetMs: 600_000,
    }
    // Worker A: one verification stalls for 40 s, past its 30 s TTL.
    const stall = world.bucket.inject({
      op: "verifyOriginal",
      kind: "latency",
      ms: 40_000,
      times: 1,
    })
    const a = startAudit(A(), world, options)
    a.catch(() => undefined)
    await world.clock.advance(35_000)
    stall()
    const cycleId = world.state().cycle_id
    expect(cycleId).not.toBeNull()
    const stateWritesBefore = world.db.writeLog.filter((e) =>
      isStateUpdate(e.op)
    ).length

    // Worker B takes the expired lease and is itself slow, so it still holds it when A wakes.
    world.bucket.inject({ op: "verifyOriginal", kind: "latency", ms: 100_000 })
    const b = startAudit(A(), world, options)
    b.catch(() => undefined)
    await world.clock.advance(6_000)

    expect(await a).toMatchObject({ outcome: "lease_lost", complete: false })
    // A wrote no state after losing the lease; B owns the cycle.
    expect(world.db.writeLog.filter((e) => isStateUpdate(e.op)).length).toBe(
      stateWritesBefore
    )
    expect(world.state().cycle_id).toBe(cycleId)
    expect(world.state().last_run_outcome).toBeNull()

    const reportB = await world.clock.drive(b, 5_000, 3_600_000)
    expect(reportB.outcome).toBe("completed_cycle")
    expect(
      world
        .runs()
        .map((r) => r.outcome)
        .sort()
    ).toEqual(["completed_cycle", "lease_lost"])
    expect(verifiedReceiptIds(world)).toHaveLength(6)
  })
})

suite("crash mid-batch: resume from checkpoint (§4.3)", () => {
  const variants = [
    { name: "just before a checkpoint write is applied", phase: "before" },
    { name: "just after a checkpoint write is applied", phase: "after" },
  ] as const

  for (const variant of variants) {
    it(`resumes in the same cycle, skips no receipt and never claims completion (killed ${variant.name})`, async () => {
      const { world } = ctx
      world.seedReceipts(12)
      const victim = world.db.killable()
      let durableCursor = 0
      const kill = () => victim.kill()
      world.db.inject({
        match: isCheckpoint,
        after: 1,
        times: 1,
        ...(variant.phase === "before"
          ? {
              before: () => {
                durableCursor = world.state().cursor_id as number
                kill()
              },
            }
          : {
              afterApply: () => {
                durableCursor = world.state().cursor_id as number
                kill()
              },
            }),
      })
      const doomed = startAudit(A(), world, {
        service: victim.client,
        batchSize: 3,
        concurrency: 1,
        leaseTtlSeconds: 60,
      })
      doomed.catch(() => undefined)
      await world.clock.advance(1_000)
      expect(victim.dead).toBe(true)
      const cycleId = world.state().cycle_id
      expect(cycleId).not.toBeNull()
      expect(durableCursor).toBeGreaterThan(0)
      expect(world.state().cursor_id).toBe(durableCursor)
      expect(world.state().last_complete_at).toBeNull()
      // A crash leaves no run row and an unreleased lease.
      expect(world.runs()).toEqual([])
      expect(world.db.leases.size).toBe(1)

      // Until the lease expires, a new invocation is locked out.
      const blocked = await runAudit(A(), world, {
        batchSize: 3,
        leaseTtlSeconds: 60,
      })
      expect(blocked.outcome).toBe("locked")
      expect(world.state().cursor_id).toBe(durableCursor)

      await world.clock.advance(61_000)
      world.bucket.calls.length = 0
      const resumed = await runAudit(A(), world, {
        batchSize: 3,
        concurrency: 1,
      })
      expect(resumed).toMatchObject({
        outcome: "completed_cycle",
        cursorFrom: durableCursor,
      })
      // Resumed in place: never re-verifying below the durable checkpoint.
      const reverified = verifiedReceiptIds(world)
      expect(reverified[0]).toBe(durableCursor + 1)
      // Nothing skipped: the doomed run's verifications plus the resumed run's cover all ids.
      expect(durableCursor + reverified.length).toBe(12)
      expect(world.runs().map((r) => r.outcome)).toEqual([
        "locked",
        "completed_cycle",
      ])
      expect(world.runs()[1].cycle_id).toBe(cycleId)
    })
  }
})
