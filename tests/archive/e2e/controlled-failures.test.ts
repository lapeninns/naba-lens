import { randomUUID } from "node:crypto"
import { copyFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { readState, resetState } from "../support/db"
import { loadAudit, type AuditModule } from "../support/driver"
import {
  E2E,
  E2E_MONITOR_SECRET,
  resetAlertFiles,
  runChecker,
  serveRoute,
  startSink,
  writeEvidence,
  type CheckerRun,
  type Sink,
} from "../support/e2e"
import { mocked } from "../support/module-mocks"
import { createRig } from "../support/rig"

// The real status route handler is imported and served OUTSIDE Next.js on a
// loopback listener, against the spare4 database, because a real Next app
// cannot run the archive against a local stack: readArchiveConfig rejects any
// source that is not <20 chars>.supabase.co. Only readArchiveConfig is mocked;
// authorization, archiveStatus and the database are real. The audit runs
// in-process with an injected fake store, so no R2 code path is reachable.
vi.mock(
  "@/lib/server/archive/config",
  async () => (await import("../support/module-mocks")).configMock
)

const audit = (await loadAudit()) as AuditModule
const HOUR = 3_600_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const rig = createRig(() => audit)
rig.register()

let sink: Sink
let app: Awaited<ReturnType<typeof serveRoute>> | null = null
let handler: (request: Request) => Response | Promise<Response>
const evidence: Record<string, unknown[]> = {}
let scenario = ""
let seen = 0

async function startApp() {
  app = await serveRoute((request) => handler(request))
}
async function stopApp() {
  await app?.close()
  app = null
}

beforeAll(async () => {
  process.env.MEDIA_ARCHIVE_MONITOR_SECRET = E2E_MONITOR_SECRET
  delete process.env.CLEANUP_SECRET
  const route = await import("@/app/api/internal/media-archive/status/route")
  handler = (request) => route.GET(request)
  sink = await startSink()
  await startApp()
})
afterAll(async () => {
  await stopApp()
  await sink.stop()
  mocked.archiveDisabled = false
  if (existsSync(sink.alertsFile))
    copyFileSync(
      sink.alertsFile,
      join(E2E.evidenceDir, "sink-alerts-last-scenario.jsonl")
    )
})

/** Start a scenario: healthy baseline, empty sink and dedup state. */
async function begin(name: string) {
  scenario = name
  evidence[name] = []
  rig.fresh()
  mocked.archiveDisabled = false
  await resetState(rig.fx.service)
  resetAlertFiles()
  seen = 0
}

async function statusBody() {
  // A route that is deliberately down is part of some scenarios; so is a
  // keep-alive socket that died with the previous listener.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${E2E.appPort}/api/internal/media-archive/status`,
        {
          headers: {
            authorization: `Bearer ${E2E_MONITOR_SECRET}`,
            connection: "close",
          },
        }
      )
      return {
        httpStatus: response.status as number | null,
        body: await response.json(),
      }
    } catch {
      await sleep(100)
    }
  }
  return { httpStatus: null as number | null, body: null }
}

/** One scheduled check: status snapshot, real checker run, alerts it added to the sink. */
async function check(
  step: string,
  options: Parameters<typeof runChecker>[0] = {}
) {
  const callsBefore = rig.bucket.calls.length
  const snapshot = await statusBody()
  // The status path never touches the archive store.
  expect(rig.bucket.calls.length).toBe(callsBefore)
  const result: CheckerRun = await runChecker(options)
  const all = sink.alerts()
  const added = all.slice(seen).map((entry) => entry.alert)
  seen = all.length
  evidence[scenario].push({
    step,
    status: snapshot,
    checker: {
      exitCode: result.code,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    },
    alertsDelivered: added,
    undelivered: sink.undelivered(),
  })
  return { code: result.code, added, result, snapshot }
}

const conditions = (alerts: Record<string, unknown>[]) =>
  alerts.map((a) =>
    a.condition === "recovered"
      ? `recovered:${a.recoveredCondition}`
      : a.condition
  )

function finish() {
  writeEvidence(scenario.replace(/[^a-z0-9]+/gi, "-").toLowerCase(), {
    scenario,
    note: "Real status route handler served outside Next.js with readArchiveConfig mocked, against the spare4 database; audit run in-process with a fake store; real checker CLI and real stub sink.",
    steps: evidence[scenario],
  })
}

describe("controlled failures: audit -> status route -> checker -> stub sink", () => {
  it("healthy: a completed cycle produces no alert", async () => {
    await begin("healthy")
    await rig.ensureReceipts(5)
    await rig.settleBacklog()
    expect((await rig.run()).outcome).toBe("completed_cycle")
    const step = await check("after a completed cycle")
    expect(step.code).toBe(0)
    expect(step.added).toEqual([])
    expect(step.snapshot.httpStatus).toBe(200)
    expect(step.snapshot.body).toMatchObject({
      ok: true,
      status: "current",
      lastRunOutcome: "completed_cycle",
    })
    finish()
  })

  it("idle: a throttled run keeps lastRunAt fresh and never raises not_running", async () => {
    await begin("idle")
    await rig.settleBacklog()
    await resetState(rig.fx.service, {
      last_complete_cycle_started_at: new Date(Date.now() - HOUR).toISOString(),
      last_run_at: new Date(Date.now() - 40 * 60_000).toISOString(),
    })
    const before = await check("run is 40 minutes old: not_running")
    expect(conditions(before.added)).toEqual(["not_running"])
    expect((await rig.run()).outcome).toBe("idle")
    const after = await check("after an idle invocation")
    expect(conditions(after.added)).toEqual(["recovered:not_running"])
    expect(after.code).toBe(0)
    finish()
  })

  it("stale: last complete older than 26 h alerts critical, a completed cycle recovers it", async () => {
    await begin("stale")
    await rig.ensureReceipts(5)
    await rig.settleBacklog()
    await resetState(rig.fx.service, {
      last_complete_at: new Date(Date.now() - 27 * HOUR).toISOString(),
    })
    const stale = await check("27 h since the last complete cycle")
    expect(stale.code).toBe(1)
    expect(stale.added).toHaveLength(1)
    expect(stale.added[0]).toMatchObject({
      condition: "stale",
      severity: "critical",
      target: "local",
      schema: "nabalens.archive-alert/v1",
    })
    expect(String(stale.added[0].summary)).toMatch(/2[67] hours/)
    const again = await check("still stale: deduplicated")
    expect(again.added).toEqual([])
    expect(again.code).toBe(1)
    expect((await rig.run()).outcome).toBe("completed_cycle")
    const recovered = await check("after a completed cycle")
    expect(conditions(recovered.added)).toEqual(["recovered:stale"])
    expect(recovered.code).toBe(0)
    finish()
  })

  it("run failed: warning, one escalation to critical at 3 failures, recovered after repair", async () => {
    await begin("run-failed")
    await rig.ensureReceipts(10)
    await rig.settleBacklog()
    const { data } = await rig.fx.service
      .from("media_archive_receipts")
      .select("id,blob_key,sha256")
      .order("id", { ascending: true })
    const victim = data![Math.floor(data!.length / 2)]
    rig.bucket.inject({
      op: "verifyOriginal",
      key: victim.blob_key,
      kind: "vanish",
    })

    expect((await rig.run()).outcome).toBe("failed")
    const first = await check("1 consecutive failure")
    expect(first.added.map((a) => [a.condition, a.severity])).toEqual([
      ["run_failed", "warning"],
    ])
    expect((await rig.run()).outcome).toBe("failed")
    expect((await check("2 consecutive failures")).added).toEqual([])
    expect((await rig.run()).outcome).toBe("failed")
    const third = await check("3 consecutive failures")
    expect(third.added.map((a) => [a.condition, a.severity])).toEqual([
      ["run_failed", "critical"],
    ])
    expect((await rig.run()).outcome).toBe("failed")
    expect((await check("4 consecutive failures: no new alert")).added).toEqual(
      []
    )

    rig.bucket.clearFaults()
    rig.bucket.seed(victim.blob_key, {
      sha256: victim.sha256,
      size: 4,
      kind: "original",
    })
    rig.bucket.objects.delete(victim.blob_key)
    expect((await rig.run()).outcome).toBe("completed_cycle")
    const recovered = await check("after repair")
    expect(conditions(recovered.added)).toEqual(["recovered:run_failed"])
    expect(recovered.code).toBe(0)
    finish()
  })

  it("timeout: a hung store ends the run as timeout and alerts through run_failed with the timeout code", async () => {
    await begin("timeout")
    await rig.ensureReceipts(8)
    await rig.settleBacklog()
    const { data } = await rig.fx.service
      .from("media_archive_receipts")
      .select("blob_key")
      .order("id", { ascending: false })
      .limit(1)
      .single()
    rig.bucket.inject({
      op: "verifyOriginal",
      key: data!.blob_key,
      kind: "hang",
      ignoreSignal: true,
      ms: 7_000,
    })
    const report = await rig.run({ deadlineMs: 1_500, softBudgetMs: 1_200 })
    expect(report).toMatchObject({
      outcome: "timeout",
      error: "archive_audit_timeout",
    })
    const alerted = await check("after a timed-out run")
    expect(alerted.added).toHaveLength(1)
    expect(alerted.added[0]).toMatchObject({
      condition: "run_failed",
      severity: "warning",
    })
    expect(alerted.added[0].status).toMatchObject({
      lastError: "archive_audit_timeout",
      lastRunOutcome: "timeout",
      consecutiveFailures: 1,
    })
    await sleep(7_200)
    rig.bucket.clearFaults()
    expect((await rig.run()).outcome).toBe("completed_cycle")
    const recovered = await check("after the next successful cycle")
    expect(conditions(recovered.added)).toEqual(["recovered:run_failed"])
    finish()
  })

  it("missing original: missing_originals (critical) plus run_failed, both recovered when the original is restored", async () => {
    await begin("missing-original")
    await rig.settleBacklog()
    const lost = await rig.fx.newReadyAsset()
    rig.missingSources.add(lost)
    const report = await rig.run()
    expect(report).toMatchObject({
      outcome: "failed",
      error: "archive_source_unavailable",
    })
    const alerted = await check("source original unreadable")
    expect(conditions(alerted.added).sort()).toEqual([
      "missing_originals",
      "run_failed",
    ])
    expect(
      alerted.added.find((a) => a.condition === "missing_originals")
    ).toMatchObject({
      severity: "critical",
    })
    expect(
      alerted.added.find((a) => a.condition === "missing_originals")?.status
    ).toMatchObject({
      lastError: "archive_source_unavailable",
    })
    expect(alerted.code).toBe(1)
    rig.missingSources.delete(lost)
    const healed = await rig.run()
    expect(["completed_cycle", "partial"]).toContain(healed.outcome)
    const recovered = await check("original restored and archived")
    expect(conditions(recovered.added).sort()).toEqual([
      "recovered:missing_originals",
      "recovered:run_failed",
    ])
    finish()
  })

  it("not running: a job silent for more than 3 x the 10-minute schedule alerts, then recovers", async () => {
    await begin("not-running")
    await resetState(rig.fx.service, {
      last_run_at: new Date(Date.now() - 31 * 60_000).toISOString(),
    })
    const silent = await check("last run 31 minutes ago")
    expect(silent.added.map((a) => [a.condition, a.severity])).toEqual([
      ["not_running", "critical"],
    ])
    await resetState(rig.fx.service, { last_run_at: new Date().toISOString() })
    const recovered = await check("a run just happened")
    expect(conditions(recovered.added)).toEqual(["recovered:not_running"])
    finish()
  })

  it("cycle_slow: a long cycle raises a non-paging warning and clears", async () => {
    await begin("cycle-slow")
    await resetState(rig.fx.service, { last_cycle_duration_seconds: 80_000 })
    const slow = await check("last cycle took 22 hours")
    expect(slow.added.map((a) => [a.condition, a.severity])).toEqual([
      ["cycle_slow", "warning"],
    ])
    await resetState(rig.fx.service, { last_cycle_duration_seconds: 3_600 })
    expect(conditions((await check("cycle back to 1 hour")).added)).toEqual([
      "recovered:cycle_slow",
    ])
    finish()
  })

  it("disabled archive: the status route reports disabled and the checker raises stale", async () => {
    await begin("disabled")
    mocked.archiveDisabled = true
    const disabled = await check("archive disabled")
    expect(disabled.snapshot).toMatchObject({
      httpStatus: 503,
      body: { ok: false, status: "disabled" },
    })
    expect(disabled.added.map((a) => [a.condition, a.severity])).toEqual([
      ["stale", "critical"],
    ])
    mocked.archiveDisabled = false
    expect(conditions((await check("archive enabled again")).added)).toEqual([
      "recovered:stale",
    ])
    finish()
  })

  it("auth rejected: a wrong monitor secret raises auth_rejected with no status, the right one recovers it", async () => {
    await begin("auth-rejected")
    const rejected = await check("wrong secret", { secret: "w".repeat(40) })
    expect(rejected.code).toBe(1)
    expect(rejected.added).toHaveLength(1)
    expect(rejected.added[0]).toMatchObject({
      condition: "auth_rejected",
      severity: "critical",
      status: null,
    })
    const unauth = await fetch(
      `http://127.0.0.1:${E2E.appPort}/api/internal/media-archive/status`
    )
    expect(unauth.status).toBe(401)
    expect(unauth.headers.get("cache-control")).toBe("private, no-store")
    expect(JSON.stringify(await unauth.json())).not.toContain("lastCompleteAt")
    expect(conditions((await check("right secret")).added)).toEqual([
      "recovered:auth_rejected",
    ])
    finish()
  })

  it("unreachable: the status route going away raises unreachable, and returning recovers it", async () => {
    await begin("unreachable")
    await stopApp()
    const down = await check("route not listening")
    expect(down.added.map((a) => [a.condition, a.severity, a.status])).toEqual([
      ["unreachable", "critical", null],
    ])
    await startApp()
    expect(conditions((await check("route back")).added)).toEqual([
      "recovered:unreachable",
    ])
    finish()
  })

  it("sink down: the alert is not lost, the checker exits 2 and writes undelivered.jsonl, and it is delivered when the sink returns", async () => {
    await begin("sink-down")
    await resetState(rig.fx.service, {
      last_complete_at: new Date(Date.now() - 30 * HOUR).toISOString(),
    })
    await sink.stop()
    const failed = await check("sink stopped while the archive is stale")
    expect(failed.code).toBe(2)
    expect(failed.result.stdout).toContain("NOT DELIVERED")
    expect(failed.result.stderr).toContain("ERROR")
    const undelivered = sink.undelivered()
    expect(undelivered).toHaveLength(1)
    expect(undelivered[0].alert).toMatchObject({
      condition: "stale",
      severity: "critical",
    })
    expect(sink.alerts()).toHaveLength(0)
    sink = await startSink()
    seen = 0
    const retried = await check("sink restarted")
    expect(retried.code).toBe(1)
    expect(conditions(retried.added)).toEqual(["stale"])
    // Retried as a new alert id, then deduplicated.
    expect(retried.added[0].alertId).not.toBe(
      (undelivered[0].alert as { alertId: string }).alertId
    )
    expect((await check("deduplicated")).added).toEqual([])
    finish()
  })

  it("alerts and evidence never contain receipts, object keys, asset ids, or credentials", async () => {
    const files = [sink.alertsFile, sink.undeliveredFile].filter((f) =>
      existsSync(f)
    )
    const text =
      files.map((f) => readFileSync(f, "utf8")).join("\n") +
      JSON.stringify(evidence)
    const { data } = await rig.fx.service
      .from("media_archive_receipts")
      .select("asset_id,blob_key,sha256")
      .limit(50)
    for (const row of data ?? []) {
      expect(text).not.toContain(row.asset_id)
      expect(text).not.toContain(row.blob_key)
      expect(text).not.toContain(row.sha256)
    }
    expect(text).not.toContain(E2E_MONITOR_SECRET)
    expect(text).not.toContain("w".repeat(40))
    expect(text).not.toContain(
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? randomUUID()
    )
    expect(await readState(rig.fx.service)).toBeTruthy()
    writeEvidence("all-scenarios", { scenarios: evidence })
  })
})
