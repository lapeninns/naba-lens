import { describe, expect, it, vi } from "vitest"

import { loadAudit, runAudit, type AuditModule } from "../support/driver"
import { mocked, setupWorld } from "../support/module-mocks"
import {
  HOUR,
  createHarness,
  jsonResponse,
  loadChecker,
  type CheckerModule,
} from "../support/monitor"

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

// Audit's real archiveStatus output, serialised as the route would, read by
// Monitoring's real checker: the two sides of contract §4.5 and §4.6 together.
const audit = await loadAudit()
const checker = await loadChecker()
const suite = describe.skipIf(!audit || !checker)
const A = () => audit as AuditModule
const ctx = setupWorld()

async function observe(
  patch: Record<string, unknown> = {},
  setup?: (world: typeof ctx.world) => void
) {
  const { world } = ctx
  world.setState(patch)
  setup?.(world)
  const harness = createHarness(checker as CheckerModule)
  harness.respond(async () => {
    const body = await A().archiveStatus(world.service, world.clock.now())
    return jsonResponse(body, { status: body.ok ? 200 : 503 })
  })
  const result = await harness.run({ now: world.clock.now() })
  return { harness, result, world }
}

const ago = (hours: number) => (world: typeof ctx.world) =>
  world.clock.iso(world.clock.now() - hours * HOUR)

suite("Audit status body -> Monitoring conditions", () => {
  it("a freshly completed cycle is healthy", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    await runAudit(A(), world)
    const { result } = await observe()
    expect(result).toMatchObject({ exitCode: 0, conditions: [] })
  })

  it("an idle run (throttled, nothing to do) never raises not_running or anything else", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    await runAudit(A(), world)
    await world.clock.advance(11 * HOUR)
    expect((await runAudit(A(), world)).outcome).toBe("idle")
    const { result } = await observe()
    expect(result).toMatchObject({ exitCode: 0, conditions: [] })
  })

  it("a cycle in progress, with progress counts, is healthy while the last complete is fresh", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    await runAudit(A(), world)
    await world.clock.advance(13 * HOUR)
    world.seedReceipts(100)
    world.bucket.inject({ op: "verifyOriginal", kind: "latency", ms: 100_000 })
    expect((await runAudit(A(), world)).outcome).toBe("partial")
    const { result, harness } = await observe()
    expect(result).toMatchObject({ exitCode: 0, conditions: [] })
    expect(harness.delivered).toEqual([])
  })

  it("no cycle ever completed -> stale", async () => {
    const { result } = await observe()
    expect(result.conditions).toContain("stale")
  })

  it("complete older than 26 h while partial runs continue -> stale (partials do not hide it)", async () => {
    const { result } = await observe(
      {
        last_run_at: ctx.world.clock.iso(),
        last_run_outcome: "partial",
      },
      (world) => world.setState({ last_complete_at: ago(27)(world) })
    )
    expect(result.conditions).toEqual(["stale"])
  })

  it("missing originals -> missing_originals", async () => {
    const { result } = await observe(
      {
        last_complete_at: ctx.world.clock.iso(ctx.world.clock.now() - HOUR),
        last_run_at: ctx.world.clock.iso(),
      },
      (world) => {
        world.addAsset()
      }
    )
    expect(result.conditions).toEqual(["missing_originals"])
  })

  it("a failed Audit run -> run_failed, critical from the third consecutive failure", async () => {
    const { world } = ctx
    world.seedReceipts(4)
    world.setState({ last_complete_at: ago(1)(world) })
    world.bucket.inject({
      op: "verifyOriginal",
      key: String(world.db.rows("media_archive_receipts")[1].blob_key),
      kind: "corrupt",
    })
    const severities: string[] = []
    const harness = createHarness(checker as CheckerModule)
    harness.respond(async () => {
      const body = await A().archiveStatus(world.service, world.clock.now())
      return jsonResponse(body, { status: body.ok ? 200 : 503 })
    })
    for (let i = 0; i < 4; i++) {
      await world.clock.advance(600_000)
      await runAudit(A(), world)
      await harness.run({ now: world.clock.now() })
      severities.push(
        ...harness.delivered
          .filter((a) => a.condition === "run_failed")
          .map((a) => a.severity)
      )
      harness.delivered.length = 0
    }
    // Warning on the first failure, one escalation at 3, nothing else.
    expect(severities).toEqual(["warning", "critical"])
  })

  it("a run that stops being invoked -> not_running at more than 3 x the schedule interval", async () => {
    const { world } = ctx
    const interval = A().ARCHIVE_AUDIT_INTERVAL_SECONDS
    world.setState({
      last_complete_at: ago(1)(world),
      last_run_at: world.clock.iso(world.clock.now() - 3 * interval * 1000),
    })
    expect((await observe()).result.conditions).toEqual([])
    world.setState({
      last_run_at: world.clock.iso(
        world.clock.now() - (3 * interval + 1) * 1000
      ),
    })
    expect((await observe()).result.conditions).toEqual(["not_running"])
  })

  it("a disabled archive -> stale (critical)", async () => {
    mocked.archiveDisabled = true
    const { result, harness } = await observe()
    expect(result.conditions).toEqual(["stale"])
    expect(harness.delivered[0].severity).toBe("critical")
  })

  it("a slow last cycle -> cycle_slow warning only above 72,000 s", async () => {
    const base = {
      last_complete_at: ctx.world.clock.iso(ctx.world.clock.now() - HOUR),
      last_run_at: ctx.world.clock.iso(),
    }
    expect(
      (await observe({ ...base, last_cycle_duration_seconds: 72_000 })).result
        .conditions
    ).toEqual([])
    const slow = await observe({ ...base, last_cycle_duration_seconds: 72_001 })
    expect(slow.result.conditions).toEqual(["cycle_slow"])
    expect(slow.harness.delivered[0].severity).toBe("warning")
  })

  it("a status read failure (route 503 {error}) -> unreachable, status null", async () => {
    const { world } = ctx
    const harness = createHarness(checker as CheckerModule)
    harness.respond(() =>
      jsonResponse({ error: "archive_status_unavailable" }, { status: 503 })
    )
    const result = await harness.run({ now: world.clock.now() })
    expect(result.conditions).toEqual(["unreachable"])
    expect(harness.delivered[0].status).toBeNull()
  })

  it("never leaks receipts, keys or ids into alert payloads even when everything is wrong", async () => {
    const { world } = ctx
    world.seedReceipts(3)
    world.addAsset({ sourceExists: false })
    world.bucket.inject({ op: "verifyOriginal", kind: "corrupt" })
    await runAudit(A(), world)
    const { harness } = await observe({ last_complete_at: ago(40)(world) })
    const text = JSON.stringify(harness.delivered)
    for (const row of world.db.rows("media_archive_receipts")) {
      expect(text).not.toContain(String(row.asset_id))
      expect(text).not.toContain(String(row.blob_key))
      expect(text).not.toContain(String(row.sha256))
    }
    expect(text).not.toMatch(/bucket|fixture|SECRET/i)
  })
})
