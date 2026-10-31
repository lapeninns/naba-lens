import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { loadAudit, type AuditModule } from "../support/driver"
import { mocked, setupWorld } from "../support/module-mocks"

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
vi.mock("@/lib/supabase/admin", async () => ({
  createAdminClient: () => await_world().service,
}))

function await_world() {
  if (!mocked.world) throw new Error("no world")
  return mocked.world
}

// Contract §4.5 (status endpoint) and the route mapping from the Audit note.
const audit = await loadAudit()
const suite = describe.skipIf(!audit)
const A = () => audit as AuditModule
const ctx = setupWorld()

const HOUR = 3_600_000
const CLEANUP = "c".repeat(40)
const MONITOR = "m".repeat(40)

const STATUS_KEYS = [
  "ok",
  "status",
  "missing",
  "lastCompleteAt",
  "lastRunAt",
  "failed",
  "inProgress",
  "lastError",
  "lastRunOutcome",
  "consecutiveFailures",
  "cycleStartedAt",
  "cycleProgress",
  "lastCycleDurationSeconds",
  "maxAgeSeconds",
  "scheduleIntervalSeconds",
].sort()

const status = (now?: number) => A().archiveStatus(ctx.world.service, now)

suite("archiveStatus (§4.5)", () => {
  it("returns exactly the contract fields with the contract types", async () => {
    const { world } = ctx
    world.setState({
      last_complete_at: world.clock.iso(world.clock.now() - HOUR),
      last_run_at: world.clock.iso(),
      last_run_outcome: "completed_cycle",
      last_cycle_duration_seconds: 3600,
    })
    const body = await status(world.clock.now())
    expect(Object.keys(body).sort()).toEqual(STATUS_KEYS)
    expect(body).toMatchObject({
      ok: true,
      status: "current",
      missing: 0,
      failed: false,
      inProgress: false,
      lastError: null,
      lastRunOutcome: "completed_cycle",
      consecutiveFailures: 0,
      cycleStartedAt: null,
      cycleProgress: null,
      lastCycleDurationSeconds: 3600,
      maxAgeSeconds: 93600,
      scheduleIntervalSeconds: A().ARCHIVE_AUDIT_INTERVAL_SECONDS,
    })
    expect(body.lastCompleteAt).toBe(world.clock.iso(world.clock.now() - HOUR))
  })

  it("disabled archive reports not ok, status disabled, and still the freshness constants", async () => {
    mocked.archiveDisabled = true
    expect(await status()).toEqual({
      ok: false,
      status: "disabled",
      maxAgeSeconds: 93600,
      scheduleIntervalSeconds: A().ARCHIVE_AUDIT_INTERVAL_SECONDS,
    })
  })

  const cases: {
    name: string
    state: Record<string, unknown>
    missing?: number
    ok: boolean
    label: "current" | "stale"
  }[] = [
    {
      name: "no cycle has ever completed",
      state: {},
      ok: false,
      label: "stale",
    },
    {
      name: "complete 1 ms older than 26 h",
      state: { last_complete_at: -(26 * HOUR + 1) },
      ok: false,
      label: "stale",
    },
    {
      name: "complete exactly 26 h ago",
      state: { last_complete_at: -(26 * HOUR) },
      ok: true,
      label: "current",
    },
    {
      name: "complete timestamp in the future",
      state: { last_complete_at: HOUR },
      ok: false,
      label: "stale",
    },
    {
      name: "fresh but originals are missing",
      state: { last_complete_at: -HOUR },
      missing: 1,
      ok: false,
      label: "current",
    },
    {
      name: "fresh but the last run failed",
      state: { last_complete_at: -HOUR, last_error: "archive_audit_failed" },
      ok: false,
      label: "current",
    },
    {
      name: "fresh with partial progress in flight",
      state: {
        last_complete_at: -HOUR,
        cycle_id: "11111111-1111-4111-8111-111111111111",
        cycle_checked: 10,
        cycle_target_count: 40,
      },
      ok: true,
      label: "current",
    },
  ]
  for (const entry of cases)
    it(`ok/status: ${entry.name}`, async () => {
      const { world } = ctx
      const patch = Object.fromEntries(
        Object.entries(entry.state).map(([key, value]) => [
          key,
          key === "last_complete_at"
            ? world.clock.iso(world.clock.now() + (value as number))
            : value,
        ])
      )
      world.setState(patch)
      for (let i = 0; i < (entry.missing ?? 0); i++) world.addAsset()
      const body = await status(world.clock.now())
      expect(body.ok).toBe(entry.ok)
      expect(body.status).toBe(entry.label)
    })

  it("stale freshness is independent of recent runs: partial progress does not hide a stale last_complete_at", async () => {
    const { world } = ctx
    world.setState({
      last_complete_at: world.clock.iso(world.clock.now() - 30 * HOUR),
      last_run_at: world.clock.iso(),
      last_run_outcome: "partial",
    })
    expect(await status(world.clock.now())).toMatchObject({
      ok: false,
      status: "stale",
      failed: false,
      lastRunOutcome: "partial",
    })
  })

  it("inProgress derives from an open cycle_id, not from the cursor; progress is counts", async () => {
    const { world } = ctx
    world.setState({
      cursor_id: 0,
      cycle_id: "11111111-1111-4111-8111-111111111111",
      cycle_started_at: world.clock.iso(),
      cycle_checked: 0,
      cycle_target_id: 900,
      cycle_target_count: 40,
    })
    expect(await status(world.clock.now())).toMatchObject({
      inProgress: true,
      cycleStartedAt: world.clock.iso(),
      cycleProgress: { checked: 0, target: 40 },
    })
    world.setState({
      cursor_id: 17,
      cycle_id: null,
      cycle_started_at: null,
      cycle_target_count: null,
    })
    expect(await status(world.clock.now())).toMatchObject({
      inProgress: false,
      cycleProgress: null,
    })
  })

  it("passes through error code, outcome and failure count", async () => {
    const { world } = ctx
    world.setState({
      last_error: "archive_audit_timeout",
      last_run_outcome: "timeout",
      consecutive_failures: 4,
    })
    expect(await status(world.clock.now())).toMatchObject({
      failed: true,
      lastError: "archive_audit_timeout",
      lastRunOutcome: "timeout",
      consecutiveFailures: 4,
    })
  })

  it("exposes no object keys, hashes, bucket names, asset ids or owner data, and stays under 16 KiB", async () => {
    const { world } = ctx
    world.seedReceipts(5)
    world.setState({
      cycle_id: "11111111-1111-4111-8111-111111111111",
      cycle_started_at: world.clock.iso(),
      cycle_target_id: 5,
      cycle_target_count: 5,
      last_error: "archive_audit_failed",
    })
    const text = JSON.stringify(await status(world.clock.now()))
    expect(Buffer.byteLength(text)).toBeLessThan(16 * 1024)
    for (const receiptRow of world.db.rows("media_archive_receipts")) {
      expect(text).not.toContain(String(receiptRow.asset_id))
      expect(text).not.toContain(String(receiptRow.sha256))
      expect(text).not.toContain(String(receiptRow.blob_key))
    }
    expect(text).not.toMatch(
      /blob|manifest|bucket|sha256|venue|uploader|fixture/i
    )
  })

  it("throws archive_status_unavailable on a state or count read error", async () => {
    const { world } = ctx
    const fault = world.db.inject({
      match: (op) =>
        op.kind === "select" && op.table === "media_archive_audit_state",
      error: { code: "57014", message: "SECRET" },
    })
    await expect(status()).rejects.toThrow("archive_status_unavailable")
    fault()
    world.db.inject({
      match: (op) =>
        op.kind === "rpc" && op.name === "media_archive_missing_count",
      error: { code: "57014", message: "SECRET" },
    })
    await expect(status()).rejects.toThrow("archive_status_unavailable")
  })

  it("is read-only", async () => {
    const { world } = ctx
    world.seedReceipts(2)
    await status(world.clock.now())
    expect(
      world.db.writeLog.filter(
        (entry) =>
          entry.op.kind !== "rpc" ||
          entry.op.name !== "media_archive_missing_count"
      )
    ).toEqual([])
  })
})

suite("status and run routes (§4.5, Audit route mapping)", () => {
  beforeEach(() => {
    vi.stubEnv("CLEANUP_SECRET", CLEANUP)
    vi.stubEnv("MEDIA_ARCHIVE_MONITOR_SECRET", MONITOR)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const call = async (
    route: "status" | "run",
    token: string | null = MONITOR
  ) => {
    const handler =
      route === "status"
        ? await import("@/app/api/internal/media-archive/status/route")
        : await import("@/app/api/internal/media-archive/route")
    const headers = new Headers()
    if (token) headers.set("authorization", `Bearer ${token}`)
    return ctx.world.clock.drive(
      Promise.resolve(
        handler.GET(
          new Request("http://127.0.0.1/api/internal/media-archive", {
            headers,
          })
        )
      )
    )
  }

  it("status: private/no-store always; 401 without or with the wrong bearer; 503 when unconfigured", async () => {
    for (const token of [null, "wrong".repeat(10)]) {
      const response = await call("status", token)
      expect(response.status).toBe(401)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
    }
    vi.unstubAllEnvs()
    const response = await call("status")
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("status: 200 only when ok, 503 with the full body otherwise; either secret is accepted", async () => {
    const { world } = ctx
    world.setState({
      last_complete_at: world.clock.iso(world.clock.now() - HOUR),
    })
    for (const token of [MONITOR, CLEANUP]) {
      const ok = await call("status", token)
      expect(ok.status).toBe(200)
      expect(await ok.json()).toMatchObject({ ok: true, status: "current" })
    }
    world.setState({ last_error: "archive_audit_failed" })
    const unhealthy = await call("status")
    expect(unhealthy.status).toBe(503)
    expect(Object.keys(await unhealthy.json()).sort()).toEqual(STATUS_KEYS)
  })

  it("status: a failing read gives 503 {error} with no provider detail", async () => {
    const { world } = ctx
    world.db.inject({
      match: (op) => op.kind === "select",
      error: { code: "57014", message: "SECRET_DB_DETAIL" },
    })
    const response = await call("status")
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).not.toContain("SECRET_DB_DETAIL")
    expect(JSON.parse(text)).toEqual({ error: "archive_status_unavailable" })
  })

  it("run: the monitor credential never authorises a mutating run", async () => {
    const { world } = ctx
    world.seedReceipts(2)
    const response = await call("run", MONITOR)
    expect(response.status).toBe(401)
    expect(world.db.rpcLog).toEqual([])
    expect(world.runs()).toEqual([])
  })

  it("run: completed_cycle, partial and locked answer 200; lease_lost and timeout 503; failed 500 without detail", async () => {
    const { world } = ctx
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) =>
      world.clock.deadline(ms)
    )

    world.seedReceipts(3)
    const completed = await call("run", CLEANUP)
    expect(completed.status).toBe(200)
    expect(await completed.json()).toMatchObject({ outcome: "completed_cycle" })

    const idle = await call("run", CLEANUP)
    expect(idle.status).toBe(200)
    expect(await idle.json()).toMatchObject({ outcome: "idle" })

    world.db.holdLease("other")
    const locked = await call("run", CLEANUP)
    expect(locked.status).toBe(200)
    expect(await locked.json()).toMatchObject({ outcome: "locked" })
    world.db.leases.clear()

    await world.clock.advance(13 * HOUR)
    world.seedReceipts(80)
    // 80 receipts at 100 s on 8 workers outlast the 480 s soft budget.
    const slow = world.bucket.inject({
      op: "verifyOriginal",
      kind: "latency",
      ms: 100_000,
    })
    const partial = await call("run", CLEANUP)
    expect(partial.status).toBe(200)
    expect(await partial.json()).toMatchObject({ outcome: "partial" })
    slow()

    const hang = world.bucket.inject({ op: "verifyOriginal", kind: "hang" })
    const timeout = await call("run", CLEANUP)
    expect(timeout.status).toBe(503)
    expect(await timeout.json()).toMatchObject({ outcome: "timeout" })
    hang()

    const stolen = world.db.inject({
      match: (op) =>
        op.kind === "rpc" && op.name === "acquire_maintenance_lease",
      after: 1,
      times: 1,
      before: () => world.db.stealLease(),
    })
    const lost = await call("run", CLEANUP)
    expect(lost.status).toBe(503)
    expect(await lost.json()).toMatchObject({ outcome: "lease_lost" })
    stolen()
    world.db.leases.clear()

    world.bucket.inject({
      op: "verifyOriginal",
      kind: "error",
      error: "SECRET_PROVIDER_DETAIL",
    })
    const failed = await call("run", CLEANUP)
    expect(failed.status).toBe(500)
    const text = await failed.text()
    expect(text).not.toContain("SECRET_PROVIDER_DETAIL")
    expect(JSON.parse(text)).toEqual({
      error: "archive_audit_failed",
      outcome: "failed",
    })
  })
})
