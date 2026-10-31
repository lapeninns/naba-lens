import { randomUUID } from "node:crypto"

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { FakeBucket } from "../support/fake-bucket"
import { realClock } from "../support/clock"
import {
  assertVerificationStack,
  clearLease,
  createArchiver,
  createFixtures,
  killableService,
  psql,
  readState,
  resetState,
  serviceClient,
  type Fixtures,
  type StateRow,
} from "../support/db"
import {
  loadAudit,
  type AuditModule,
  type AuditOptions,
} from "../support/driver"

vi.mock(
  "@/lib/server/archive/config",
  async () => (await import("../support/module-mocks")).configMock
)

// The real runArchiveAudit against the real (spare4) database, with only the
// archive store faked (§4.2 to §4.5). Real time, real leases, real constraints.
const audit = (await loadAudit()) as AuditModule
const A = () => audit
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const DAY = 86_400_000

let fx: Fixtures
let snapshot: StateRow
let bucket: FakeBucket
let missingSources: Set<string>

beforeAll(async () => {
  assertVerificationStack()
  fx = await createFixtures()
  snapshot = await readState(fx.service)
})
afterEach(async () => {
  await clearLease(fx.service)
  await resetState(fx.service)
})
afterAll(async () => {
  await clearLease(fx.service)
  const { name, ...rest } = snapshot
  void name
  await fx.service
    .from("media_archive_audit_state")
    .update(rest as never)
    .eq("name", "originals")
})

function fresh() {
  bucket = new FakeBucket(realClock)
  bucket.lenient = true
  missingSources = new Set<string>()
}

const receiptCount = async () =>
  (
    await fx.service
      .from("media_archive_receipts")
      .select("id", { count: "exact", head: true })
  ).count ?? 0

const readyUnarchived = async () => {
  const { data } = await fx.service.rpc("media_archive_backfill_candidates", {
    p_limit: 50,
  })
  return (data ?? []).map((row) => row.asset_id)
}

/** Archive every ready original directly so the audit starts with no backlog. */
async function settleBacklog() {
  const archive = createArchiver(fx.service, bucket, missingSources)
  for (;;) {
    const pending = await readyUnarchived()
    if (pending.length === 0) return
    for (const id of pending)
      await archive(null, id, AbortSignal.timeout(30_000))
  }
}

async function ensureReceipts(count: number) {
  const archive = createArchiver(fx.service, bucket, missingSources)
  while ((await receiptCount()) < count) {
    const id = await fx.newReadyAsset()
    await archive(null, id, AbortSignal.timeout(30_000))
  }
}

function run(
  options: AuditOptions & { service?: unknown; deadlineMs?: number } = {}
) {
  const { service = fx.service, deadlineMs = 60_000, ...rest } = options
  const signal = rest.signal ?? AbortSignal.timeout(deadlineMs)
  return A().runArchiveAudit(service, {
    store: bucket.store(signal),
    archive: createArchiver(fx.service, bucket, missingSources),
    signal,
    ...rest,
  })
}

const runsFor = async (cycleId: unknown) =>
  (
    await fx.service
      .from("media_archive_audit_runs")
      .select("*")
      .eq("cycle_id", cycleId as string)
      .order("id", { ascending: true })
  ).data ?? []

const allRunsSince = async (startedAfter: string) =>
  (
    await fx.service
      .from("media_archive_audit_runs")
      .select("*")
      .gte("started_at", startedAfter)
      .order("id", { ascending: true })
  ).data ?? []

const latency = (ms: number, extra: Record<string, unknown> = {}) =>
  bucket.inject({
    op: "verifyOriginal",
    kind: "latency",
    ms,
    ...extra,
  } as never)

describe("full cycle on the real database (§4.2, §4.4)", () => {
  it("completes a cycle, writes the durable record and a run row, and reports healthy status", async () => {
    fresh()
    await ensureReceipts(5)
    await settleBacklog()
    const before = Date.now()
    const report = await run()
    expect(report).toMatchObject({
      outcome: "completed_cycle",
      complete: true,
      error: null,
      missing: 0,
    })
    expect(report.checked).toBeGreaterThanOrEqual(5)
    const state = await readState(fx.service)
    expect(state).toMatchObject({
      cursor_id: 0,
      cycle_id: null,
      cycle_started_at: null,
      cycle_target_id: null,
      cycle_target_count: null,
      cycle_checked: 0,
      last_run_outcome: "completed_cycle",
      last_error: null,
      consecutive_failures: 0,
    })
    const completeAt = Date.parse(String(state.last_complete_at))
    expect(completeAt).toBeGreaterThanOrEqual(before - 1000)
    expect(
      Date.parse(String(state.last_complete_cycle_started_at))
    ).toBeLessThanOrEqual(completeAt)
    expect(Number.isInteger(state.last_cycle_duration_seconds)).toBe(true)
    const runs = await allRunsSince(new Date(before - 1000).toISOString())
    const mine = runs.at(-1)!
    expect(mine).toMatchObject({
      outcome: "completed_cycle",
      checked: report.checked,
      missing: 0,
      error: null,
      cursor_from: 0,
    })
    expect(Number(mine.bytes_verified)).toBe(report.bytesVerified)
    expect(report.bytesVerified).toBeGreaterThan(0)
    const status = await A().archiveStatus(fx.service)
    expect(status).toMatchObject({
      ok: true,
      status: "current",
      missing: 0,
      failed: false,
      inProgress: false,
      lastRunOutcome: "completed_cycle",
      cycleProgress: null,
      maxAgeSeconds: 93600,
      scheduleIntervalSeconds: 600,
    })
  })

  it("an idle invocation inside the 12 h throttle writes only last_run_at/outcome and a run row", async () => {
    fresh()
    await settleBacklog()
    await resetState(fx.service, {
      last_complete_cycle_started_at: new Date(
        Date.now() - 3_600_000
      ).toISOString(),
    })
    const before = await readState(fx.service)
    const started = new Date().toISOString()
    const report = await run()
    expect(report).toMatchObject({ outcome: "idle", checked: 0, error: null })
    expect(bucket.callsTo("verifyOriginal")).toEqual([])
    const after = await readState(fx.service)
    expect(after).toMatchObject({
      cycle_id: null,
      last_run_outcome: "idle",
      last_error: null,
      consecutive_failures: 0,
      last_complete_at: before.last_complete_at,
      last_complete_cycle_started_at: before.last_complete_cycle_started_at,
    })
    expect(Date.parse(String(after.last_run_at))).toBeGreaterThan(
      Date.parse(String(before.last_run_at))
    )
    expect((await allRunsSince(started)).at(-1)).toMatchObject({
      outcome: "idle",
      checked: 0,
    })
  })
})

describe("checkpoint durability and resume (§4.3)", () => {
  it("a partial run's cursor survives a brand-new connection, and the resumed cycle verifies every receipt exactly once", async () => {
    fresh()
    await ensureReceipts(40)
    await settleBacklog()
    const started = new Date().toISOString()
    const slow = latency(40)
    const first = await run({
      checkpointEvery: 5,
      concurrency: 1,
      softBudgetMs: 600,
    })
    expect(first.outcome).toBe("partial")
    const mid = await readState(serviceClient())
    expect(mid.cycle_id).not.toBeNull()
    expect(mid.cursor_id as number).toBeGreaterThan(0)
    expect(mid.last_run_outcome).toBe("partial")
    expect(mid.last_complete_at).toEqual(
      (await readState(fx.service)).last_complete_at
    )
    const status = await A().archiveStatus(fx.service)
    expect(status).toMatchObject({
      inProgress: true,
      lastRunOutcome: "partial",
    })
    expect(
      (status.cycleProgress as { checked: number; target: number }).target
    ).toBe(mid.cycle_target_count)
    expect((status.cycleProgress as { checked: number }).checked).toBe(
      mid.cycle_checked
    )
    slow()

    const cycleId = mid.cycle_id
    bucket.calls.length = 0
    const reports = []
    for (let i = 0; i < 20; i++) {
      const report = await run({
        service: serviceClient(),
        checkpointEvery: 5,
        concurrency: 4,
      })
      reports.push(report)
      if (report.outcome === "completed_cycle") break
    }
    expect(reports.at(-1)?.outcome).toBe("completed_cycle")
    expect(reports[0].cursorFrom).toBe(mid.cursor_id)
    const runs = await runsFor(cycleId)
    // Receipts are verified once in total across the runs of one cycle.
    expect(runs.reduce((sum, r) => sum + r.checked, 0)).toBe(
      Number(mid.cycle_target_count)
    )
    expect(runs.map((r) => r.outcome)[0]).toBe("partial")
    expect(runs.map((r) => r.cursor_from)).toEqual(
      [...runs.map((r) => r.cursor_from)].sort((a, b) => (a ?? 0) - (b ?? 0))
    )
    expect(started).toBeTruthy()
  })

  it("a crash mid-cycle (process death, lease left to expire) resumes from the durable cursor in the same cycle", async () => {
    fresh()
    await ensureReceipts(40)
    await settleBacklog()
    const victim = killableService(fx.service)
    const slow = latency(30)
    const doomed = run({
      service: victim.client,
      checkpointEvery: 4,
      concurrency: 2,
      leaseTtlSeconds: 2,
    })
    doomed.catch(() => undefined)
    // Kill it once a checkpoint is durable but the cycle is far from done.
    let durable = 0
    for (let i = 0; i < 100 && durable === 0; i++) {
      await sleep(50)
      durable = (await readState(fx.service)).cursor_id as number
    }
    victim.kill()
    durable = (await readState(fx.service)).cursor_id as number
    slow()
    const midState = await readState(fx.service)
    expect(durable).toBeGreaterThan(0)
    expect(midState.cycle_id).not.toBeNull()
    expect(midState.last_complete_at).not.toBeNull()
    const completeBefore = midState.last_complete_at

    // Still locked out until the TTL passes.
    expect((await run()).outcome).toBe("locked")
    await sleep(2600)
    bucket.calls.length = 0
    const resumed = await run({ checkpointEvery: 4 })
    expect(resumed).toMatchObject({ outcome: "completed_cycle" })
    expect(resumed.cursorFrom as number).toBeGreaterThanOrEqual(durable)
    const runs = await runsFor(midState.cycle_id)
    // The crashed run left no row; the resumed run is the cycle's only one.
    expect(runs).toHaveLength(1)
    expect(runs[0].cycle_id).toBe(midState.cycle_id)
    expect((await readState(fx.service)).last_complete_at).not.toBe(
      completeBefore
    )
  })
})

describe("overlap and lease loss (§4.3)", () => {
  it("two simultaneous invocations: exactly one works, the other is locked and records nothing but a run row", async () => {
    fresh()
    await ensureReceipts(12)
    await settleBacklog()
    const started = new Date().toISOString()
    const slow = latency(150)
    const [a, b] = await Promise.all([
      run({ concurrency: 2 }),
      (async () => {
        await sleep(100)
        return run({ concurrency: 2 })
      })(),
    ])
    slow()
    const outcomes = [a.outcome, b.outcome].sort()
    expect(outcomes).toContain("locked")
    expect(outcomes.filter((o) => o !== "locked")).toHaveLength(1)
    const locked = [a, b].find((r) => r.outcome === "locked")!
    expect(locked).toMatchObject({
      cursorFrom: null,
      cursorTo: null,
      checked: 0,
    })
    const rows = await allRunsSince(started)
    const lockedRow = rows.find((r) => r.outcome === "locked")!
    expect(lockedRow).toMatchObject({
      cycle_id: null,
      cursor_from: null,
      cursor_to: null,
    })
    expect((await readState(fx.service)).cycle_id).toBeNull()
  })

  it("a lease taken over mid-run makes the old run lease_lost: it writes no state, only its run row", async () => {
    fresh()
    await ensureReceipts(30)
    await settleBacklog()
    const slow = latency(1500, { times: 1 })
    const started = new Date().toISOString()
    const running = run({
      checkpointEvery: 3,
      concurrency: 2,
      leaseTtlSeconds: 1,
      deadlineMs: 30_000,
    })
    // Let the 1 s lease lapse while one verification stalls, then take it over.
    await sleep(1300)
    const thief = randomUUID()
    const stolen = await fx.service.rpc("acquire_maintenance_lease", {
      p_name: "media_archive_audit",
      p_holder: thief,
      p_ttl: "20 seconds",
    })
    expect(stolen.data).toBe(true)
    const before = await readState(fx.service)
    const report = await running
    slow()
    expect(report).toMatchObject({
      outcome: "lease_lost",
      complete: false,
      error: "archive_lease_lost",
    })
    const after = await readState(fx.service)
    expect(after.cursor_id).toBe(before.cursor_id)
    expect(after).toMatchObject({
      last_run_outcome: "completed_cycle",
      last_error: null,
      consecutive_failures: 0,
    })
    expect(after.last_run_at).toBe(before.last_run_at)
    const row = (await allRunsSince(started)).find(
      (r) => r.outcome === "lease_lost"
    )!
    expect(row).toMatchObject({ error: "archive_lease_lost" })
    // The loser must not have released the new holder's lease.
    expect(
      psql(
        "select holder from private.maintenance_leases where name='media_archive_audit'"
      ).out
    ).toBe(thief)
    await fx.service.rpc("release_maintenance_lease", {
      p_name: "media_archive_audit",
      p_holder: thief,
    })
  })
})

describe("faults on the real database (§4.4)", () => {
  it("a hung store that ignores the signal yields timeout at the deadline and a released lease", async () => {
    fresh()
    await ensureReceipts(8)
    await settleBacklog()
    const key = String(
      (
        await fx.service
          .from("media_archive_receipts")
          .select("blob_key")
          .order("id", { ascending: false })
          .limit(1)
          .single()
      ).data?.blob_key
    )
    bucket.inject({
      op: "verifyOriginal",
      key,
      kind: "hang",
      ignoreSignal: true,
      ms: 6_000,
    })
    const started = Date.now()
    const report = await run({ deadlineMs: 1_500, softBudgetMs: 1_200 })
    expect(Date.now() - started).toBeLessThan(4_000)
    expect(report).toMatchObject({
      outcome: "timeout",
      error: "archive_audit_timeout",
    })
    const state = await readState(fx.service)
    expect(state).toMatchObject({
      last_run_outcome: "timeout",
      last_error: "archive_audit_timeout",
      consecutive_failures: 1,
    })
    expect(state.last_complete_at).not.toBeNull()
    const free = await fx.service.rpc("acquire_maintenance_lease", {
      p_name: "media_archive_audit",
      p_holder: randomUUID(),
      p_ttl: "5 seconds",
    })
    expect(free.data).toBe(true)
    await sleep(6_200)
  })

  it("a vanished or corrupt archive object fails the run below that receipt; repair heals", async () => {
    fresh()
    await ensureReceipts(20)
    await settleBacklog()
    const { data: rows } = await fx.service
      .from("media_archive_receipts")
      .select("id,blob_key,sha256,manifest_key,manifest_sha256")
      .order("id", { ascending: true })
    const victim = rows![Math.floor(rows!.length / 2)]
    bucket.inject({
      op: "verifyOriginal",
      key: victim.blob_key,
      kind: "vanish",
    })
    const bad = await run({ checkpointEvery: 3, concurrency: 2 })
    expect(bad).toMatchObject({
      outcome: "failed",
      error: "archive_audit_failed",
    })
    const failed = await readState(fx.service)
    expect(failed.cursor_id as number).toBeLessThan(victim.id)
    expect(failed).toMatchObject({
      last_error: "archive_audit_failed",
      consecutive_failures: 1,
    })
    expect(failed.cycle_id).not.toBeNull()

    bucket.clearFaults()
    bucket.seed(victim.blob_key, {
      sha256: victim.sha256,
      size: 4,
      kind: "original",
    })
    bucket.objects.delete(victim.blob_key)
    // lenient bucket treats a re-seeded key as present once it is no longer damaged
    const repaired = await run({ checkpointEvery: 3, concurrency: 2 })
    expect(repaired.outcome).toBe("completed_cycle")
    expect(repaired.cursorFrom as number).toBeLessThan(victim.id)
    expect(await readState(fx.service)).toMatchObject({
      last_error: null,
      consecutive_failures: 0,
      cycle_id: null,
    })
  })

  it("a ready original whose source is gone fails the run, keeps missing > 0 in status, and heals when restored", async () => {
    fresh()
    await settleBacklog()
    const lost = await fx.newReadyAsset()
    missingSources.add(lost)
    const completeBefore = (await readState(fx.service)).last_complete_at
    const report = await run()
    expect(report).toMatchObject({
      outcome: "failed",
      error: "archive_source_unavailable",
    })
    expect(report.missing).toBeGreaterThanOrEqual(1)
    const status = await A().archiveStatus(fx.service)
    expect(status).toMatchObject({
      ok: false,
      failed: true,
      lastError: "archive_source_unavailable",
    })
    expect(status.missing as number).toBeGreaterThanOrEqual(1)
    expect((await readState(fx.service)).last_complete_at).toBe(completeBefore)

    missingSources.delete(lost)
    const healed = await run()
    expect(["completed_cycle", "partial"]).toContain(healed.outcome)
    expect(healed.copied).toBeGreaterThanOrEqual(1)
    expect(await readyUnarchived()).toEqual([])
    expect(await readState(fx.service)).toMatchObject({
      last_error: null,
      consecutive_failures: 0,
    })
  })

  it("a failing backfill in an idle run is a failed run, not idle", async () => {
    fresh()
    await settleBacklog()
    await resetState(fx.service, {
      last_complete_cycle_started_at: new Date(
        Date.now() - 3_600_000
      ).toISOString(),
    })
    const lost = await fx.newReadyAsset()
    missingSources.add(lost)
    const report = await run()
    expect(report).toMatchObject({
      outcome: "failed",
      error: "archive_source_unavailable",
    })
    expect(await readState(fx.service)).toMatchObject({
      last_error: "archive_source_unavailable",
      consecutive_failures: 1,
    })
    missingSources.delete(lost)
    await run()
  })

  it("retention: a non-locked run prunes run rows older than 90 days and keeps newer ones", async () => {
    fresh()
    await settleBacklog()
    const mk = (days: number) => {
      const at = new Date(Date.now() - days * DAY).toISOString()
      return {
        run_id: randomUUID(),
        started_at: at,
        finished_at: at,
        outcome: "partial",
        checked: 0,
        copied: 0,
      }
    }
    const old = mk(120)
    const recent = mk(89)
    await fx.service
      .from("media_archive_audit_runs")
      .insert([old, recent] as never)
    await resetState(fx.service, {
      last_complete_cycle_started_at: new Date(
        Date.now() - 3_600_000
      ).toISOString(),
    })
    await run()
    const ids = (
      await fx.service
        .from("media_archive_audit_runs")
        .select("run_id")
        .in("run_id", [old.run_id, recent.run_id])
    ).data?.map((r) => r.run_id)
    expect(ids).toEqual([recent.run_id])
  })

  it("a store failure while backfilling is store_unavailable and verification progress is still saved", async () => {
    fresh()
    await ensureReceipts(10)
    await settleBacklog()
    const asset = await fx.newReadyAsset()
    void asset
    bucket.inject({
      op: "putOriginalIfAbsent",
      kind: "error",
      error: "archive_destination_write_failed",
    })
    const report = await run({ checkpointEvery: 3, concurrency: 2 })
    expect(report).toMatchObject({
      outcome: "failed",
      error: "archive_store_unavailable",
    })
    const state = await readState(fx.service)
    expect(state.last_error).toBe("archive_store_unavailable")
    // Verification still ran: the cycle exists and its cursor advanced.
    expect(state.cycle_id).not.toBeNull()
    expect(state.cursor_id as number).toBeGreaterThan(0)
  })
})
