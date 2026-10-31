import { describe, expect, it } from "vitest"

import {
  HOUR,
  NOW,
  ORIGIN,
  SECRET,
  STATUS_URL,
  conditionsOf,
  createHarness,
  healthyBody,
  jsonResponse,
  loadChecker,
  type CheckerModule,
} from "../support/monitor"

// Contract §4.6 alert conditions, dedup, payload and sink behaviour, driven
// through the checker's injected fetch/sink/state. Skipped until Monitoring's
// scripts/monitoring/archive-checker.mjs is present on this branch.
const checker = await loadChecker()
const suite = describe.skipIf(!checker)
const C = () => checker as CheckerModule
const make = () => createHarness(C())

const STATUS_FIELDS = [
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
]

suite("healthy and request hygiene", () => {
  it("a healthy status raises nothing and exits 0", async () => {
    const h = make()
    const result = await h.run()
    expect(result).toMatchObject({
      ok: true,
      exitCode: 0,
      conditions: [],
      alerts: [],
    })
    expect(h.delivered).toEqual([])
  })

  it("sends exactly one GET to the fixed status URL with the bearer, no redirects, no cookies", async () => {
    const h = make()
    await h.run()
    expect(h.requests).toHaveLength(1)
    const [{ url, init }] = h.requests
    expect(url).toBe(STATUS_URL)
    expect(init).toMatchObject({
      method: "GET",
      redirect: "manual",
      credentials: "omit",
    })
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${SECRET}`
    )
  })

  it("an unhealthy 503 with a valid body is evaluated as status, not as unreachable", async () => {
    const h = make()
    h.body({ ok: false, missing: 2 }, 503)
    const result = await h.run()
    expect(result.conditions).toEqual(["missing_originals"])
  })

  it("an idle run (fresh lastRunAt, nothing in progress) never trips not_running or run_failed", async () => {
    const h = make()
    h.body({
      lastRunOutcome: "idle",
      lastRunAt: new Date(NOW - 5_000).toISOString(),
    })
    expect((await h.run()).conditions).toEqual([])
  })

  it("an unknown future outcome code does not by itself raise anything", async () => {
    const h = make()
    h.body({ lastRunOutcome: "something_new" })
    expect((await h.run()).conditions).toEqual([])
  })

  it("a long in-progress cycle with a fresh previous completion is healthy", async () => {
    const h = make()
    h.body({
      inProgress: true,
      cycleStartedAt: new Date(NOW - 2 * HOUR).toISOString(),
      cycleProgress: { checked: 500, target: 4000 },
      lastRunOutcome: "partial",
    })
    expect((await h.run()).conditions).toEqual([])
  })
})

suite("stale (§4.6)", () => {
  const age = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()

  it("fires critical when no cycle ever completed", async () => {
    const h = make()
    h.body({ ok: false, status: "stale", lastCompleteAt: null })
    const result = await h.run()
    expect(result.conditions).toEqual(["stale"])
    expect(h.delivered[0]).toMatchObject({
      condition: "stale",
      severity: "critical",
    })
  })

  it("is exactly at the boundary: 26 h old is current, 26 h + 1 s is stale", async () => {
    const h = make()
    h.body({ lastCompleteAt: age(93_600) })
    expect((await h.run()).conditions).toEqual([])
    const h2 = make()
    h2.body({ ok: false, status: "stale", lastCompleteAt: age(93_601) })
    expect((await h2.run()).conditions).toEqual(["stale"])
    expect(h2.delivered[0].summary).toMatch(/26 hours/)
  })

  it("names the age in hours in the summary", async () => {
    const h = make()
    h.body({ ok: false, status: "stale", lastCompleteAt: age(31 * 3600 + 60) })
    await h.run()
    expect(h.delivered[0].summary).toMatch(/31 hours/)
  })

  it("a status body can tighten the threshold but never widen it beyond 26 h", async () => {
    const tight = make()
    tight.body({ lastCompleteAt: age(2 * 3600), maxAgeSeconds: 3600 })
    expect((await tight.run()).conditions).toEqual(["stale"])
    const wide = make()
    wide.body({
      ok: false,
      status: "stale",
      lastCompleteAt: age(30 * 3600),
      maxAgeSeconds: 10 * 93_600,
    })
    expect((await wide.run()).conditions).toEqual(["stale"])
  })

  it("a disabled archive maps to stale critical", async () => {
    const h = make()
    h.respond(() =>
      jsonResponse(
        {
          ok: false,
          status: "disabled",
          maxAgeSeconds: 93600,
          scheduleIntervalSeconds: 600,
        },
        { status: 503 }
      )
    )
    const result = await h.run()
    expect(result.conditions).toEqual(["stale"])
    expect(h.delivered[0].severity).toBe("critical")
  })

  it("a completion time far in the future is treated as stale, not trusted", async () => {
    const h = make()
    h.body({ lastCompleteAt: new Date(NOW + 5 * HOUR).toISOString() })
    expect((await h.run()).conditions).toEqual(["stale"])
  })

  it("a body that says ok:false with no other cause still alerts (never silently healthy)", async () => {
    const h = make()
    h.body({ ok: false })
    expect((await h.run()).conditions.length).toBeGreaterThan(0)
  })
})

suite("missing_originals, run_failed, not_running, cycle_slow (§4.6)", () => {
  it("missing > 0 is critical", async () => {
    const h = make()
    h.body({ ok: false, missing: 3 })
    await h.run()
    expect(h.delivered[0]).toMatchObject({
      condition: "missing_originals",
      severity: "critical",
    })
  })

  it("run_failed is a warning for 1-2 consecutive failures and critical from 3", async () => {
    for (const [failures, severity] of [
      [1, "warning"],
      [2, "warning"],
      [3, "critical"],
      [7, "critical"],
    ] as const) {
      const h = make()
      h.body({
        ok: false,
        failed: true,
        lastError: "archive_audit_failed",
        consecutiveFailures: failures,
        lastRunOutcome: "failed",
      })
      await h.run()
      expect(h.delivered).toHaveLength(1)
      expect(h.delivered[0]).toMatchObject({
        condition: "run_failed",
        severity,
      })
    }
  })

  it("consecutiveFailures >= 1 alone raises run_failed even when failed is false", async () => {
    const h = make()
    h.body({ consecutiveFailures: 1 })
    expect((await h.run()).conditions).toEqual(["run_failed"])
  })

  it("not_running: older than 3 x interval alerts, exactly 3 x interval does not", async () => {
    const at = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()
    const ok = make()
    ok.body({ lastRunAt: at(1800) })
    expect((await ok.run()).conditions).toEqual([])
    const late = make()
    late.body({ lastRunAt: at(1801) })
    expect((await late.run()).conditions).toEqual(["not_running"])
    expect(late.delivered[0].severity).toBe("critical")
  })

  it("not_running is not evaluated when the body has no scheduleIntervalSeconds, and fires when the job never ran", async () => {
    const old = make()
    const body = healthyBody({
      lastRunAt: new Date(NOW - 10 * HOUR).toISOString(),
    })
    delete (body as Record<string, unknown>).scheduleIntervalSeconds
    old.respond(() => jsonResponse(body))
    expect((await old.run()).conditions).toEqual([])
    const never = make()
    never.body({ lastRunAt: null })
    expect((await never.run()).conditions).toEqual(["not_running"])
  })

  it("cycle_slow: > 72,000 s is a warning, exactly 72,000 s is not", async () => {
    const edge = make()
    edge.body({ lastCycleDurationSeconds: 72_000 })
    expect((await edge.run()).conditions).toEqual([])
    const slow = make()
    slow.body({ lastCycleDurationSeconds: 72_001 })
    const result = await slow.run()
    expect(result.conditions).toEqual(["cycle_slow"])
    expect(slow.delivered[0]).toMatchObject({
      condition: "cycle_slow",
      severity: "warning",
    })
  })

  it("cycle_slow is non-paging: it goes to the digest sink when one is configured, never the paging sink", async () => {
    const h = make()
    h.body({ lastCycleDurationSeconds: 80_000 })
    await h.run({ digestSink: true })
    expect(conditionsOf(h.digest)).toEqual(["cycle_slow"])
    expect(h.delivered).toEqual([])
    h.body({ lastCycleDurationSeconds: 3_600 })
    await h.run({ digestSink: true })
    expect(h.digest.map((a) => a.recoveredCondition ?? a.condition)).toEqual([
      "cycle_slow",
      "cycle_slow",
    ])
    expect(h.delivered).toEqual([])
  })

  it("several conditions at once give one alert each, and a critical stale does not hide the others", async () => {
    const h = make()
    h.body({
      ok: false,
      status: "stale",
      lastCompleteAt: new Date(NOW - 40 * HOUR).toISOString(),
      missing: 2,
      failed: true,
      consecutiveFailures: 4,
      lastRunAt: new Date(NOW - 6 * HOUR).toISOString(),
    })
    const result = await h.run()
    expect(result.conditions.sort()).toEqual(
      ["missing_originals", "not_running", "run_failed", "stale"].sort()
    )
    expect(h.delivered).toHaveLength(4)
    expect(new Set(h.delivered.map((a) => a.alertId)).size).toBe(4)
  })
})

suite("dedup, escalation and recovery (§4.6)", () => {
  it("an unchanged condition alerts once until it clears", async () => {
    const h = make()
    h.body({ ok: false, missing: 1 })
    for (let i = 0; i < 4; i++) {
      const result = await h.run({ now: NOW + i * 600_000 })
      expect(result.exitCode).toBe(1)
    }
    expect(conditionsOf(h.delivered)).toEqual(["missing_originals"])
  })

  it("recovery sends exactly one `recovered` (info) naming the cleared condition, then stays quiet", async () => {
    const h = make()
    h.body({ ok: false, missing: 1 })
    await h.run()
    h.body()
    const recovered = await h.run({ now: NOW + 600_000 })
    expect(recovered.exitCode).toBe(0)
    await h.run({ now: NOW + 1_200_000 })
    expect(h.delivered).toHaveLength(2)
    expect(h.delivered[1]).toMatchObject({
      condition: "recovered",
      severity: "info",
      recoveredCondition: "missing_originals",
    })
    expect(h.delivered[1].summary).toContain("missing_originals")
  })

  it("a cleared condition that returns alerts again", async () => {
    const h = make()
    for (const missing of [1, 0, 1]) {
      h.body({ ok: missing === 0, missing })
      await h.run({ now: NOW + h.delivered.length * 600_000 })
    }
    expect(conditionsOf(h.delivered)).toEqual([
      "missing_originals",
      "recovered",
      "missing_originals",
    ])
  })

  it("run_failed re-alerts once on escalation to critical at 3 failures, not before and not after", async () => {
    const h = make()
    const failing = (consecutiveFailures: number) =>
      h.body({
        ok: false,
        failed: true,
        lastError: "archive_audit_failed",
        consecutiveFailures,
      })
    for (const failures of [1, 2, 3, 4, 5]) {
      failing(failures)
      await h.run({ now: NOW + failures * 600_000 })
    }
    expect(h.delivered.map((a) => [a.condition, a.severity])).toEqual([
      ["run_failed", "warning"],
      ["run_failed", "critical"],
    ])
  })

  it("probe failures never clear data conditions, and only a valid body recovers them", async () => {
    const h = make()
    h.body({ ok: false, missing: 1 })
    await h.run()
    h.respond(() => jsonResponse({ error: "unconfigured" }, { status: 503 }))
    await h.run({ now: NOW + 600_000 })
    expect(conditionsOf(h.delivered)).toEqual([
      "missing_originals",
      "unreachable",
    ])
    h.body({ ok: false, missing: 1 })
    await h.run({ now: NOW + 1_200_000 })
    expect(h.delivered.map((a) => a.recoveredCondition ?? a.condition)).toEqual(
      ["missing_originals", "unreachable", "unreachable"]
    )
    expect(h.delivered[2].condition).toBe("recovered")
    // The data condition was never re-announced.
    h.body()
    await h.run({ now: NOW + 1_800_000 })
    expect(h.delivered.at(-1)).toMatchObject({
      condition: "recovered",
      recoveredCondition: "missing_originals",
    })
  })
})

suite(
  "probe failures: unreachable, auth_rejected, monitor_error (§4.6)",
  () => {
    const unreachableCases: [string, () => Response | Promise<Response>][] = [
      ["network error", () => Promise.reject(new TypeError("fetch failed"))],
      [
        "timeout",
        () => Promise.reject(new DOMException("timed out", "TimeoutError")),
      ],
      ["non-JSON body", () => jsonResponse("<html>oops</html>")],
      [
        "redirect",
        () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://evil.example/steal" },
          }),
      ],
      [
        "oversized body",
        () =>
          jsonResponse(
            JSON.stringify({ ok: true, pad: "x".repeat(17 * 1024) })
          ),
      ],
      [
        "503 without a valid body",
        () => jsonResponse({ error: "unconfigured" }, { status: 503 }),
      ],
      ["500", () => jsonResponse({ error: "boom" }, { status: 500 })],
      [
        "missing cache-control",
        () =>
          new Response(JSON.stringify(healthyBody()), {
            headers: { "content-type": "application/json" },
          }),
      ],
      [
        "wrong content type",
        () =>
          new Response(JSON.stringify(healthyBody()), {
            headers: {
              "content-type": "text/html",
              "cache-control": "private, no-store",
            },
          }),
      ],
      [
        "valid JSON that is not a status",
        () => jsonResponse({ hello: "world" }),
      ],
      [
        "a status with a malformed field",
        () => jsonResponse(healthyBody({ missing: "none" })),
      ],
    ]

    for (const [name, respond] of unreachableCases)
      it(`unreachable: ${name}`, async () => {
        const h = make()
        h.respond(respond)
        const result = await h.run()
        expect(result).toMatchObject({
          exitCode: 1,
          conditions: ["unreachable"],
        })
        expect(h.delivered[0]).toMatchObject({
          condition: "unreachable",
          severity: "critical",
          status: null,
        })
      })

    for (const code of [401, 403])
      it(`auth_rejected on ${code}: status null and the credential is never echoed`, async () => {
        const h = make()
        h.respond(() =>
          jsonResponse({ error: "unauthorized" }, { status: code })
        )
        const result = await h.run()
        expect(result.conditions).toEqual(["auth_rejected"])
        expect(h.delivered[0]).toMatchObject({
          severity: "critical",
          status: null,
        })
        expect(JSON.stringify([h.delivered, result])).not.toContain(SECRET)
      })

    it("monitor_error when the credential loader fails, and nothing is requested", async () => {
      const h = make()
      const result = await h.run({
        loadSecret: async () => {
          throw new Error("keychain locked")
        },
      })
      expect(result.conditions).toEqual(["monitor_error"])
      expect(h.requests).toEqual([])
      expect(h.delivered[0].status).toBeNull()
      expect(JSON.stringify(h.delivered)).not.toContain("keychain")
    })

    it("monitor_error for a malformed credential, and the bad value is never reported", async () => {
      const h = make()
      const result = await h.run({ loadSecret: async () => "short secret!" })
      expect(result.conditions).toEqual(["monitor_error"])
      expect(JSON.stringify(h.delivered)).not.toContain("short secret")
    })

    for (const name of [
      "CLEANUP_SECRET",
      "CRON_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
    ])
      it(`monitor_error when the checker environment holds ${name}`, async () => {
        const h = make()
        const result = await h.run({ env: { [name]: "z".repeat(40) } })
        expect(result.conditions).toEqual(["monitor_error"])
        expect(h.requests).toEqual([])
        expect(JSON.stringify(h.delivered)).not.toContain("zzzz")
      })

    it("production mode pins the origin and never reads the credential for another host", async () => {
      const h = make()
      const result = await h.run({
        mode: "production",
        origin: "https://evil.example",
      })
      expect(result.conditions).toEqual(["monitor_error"])
      expect(h.loadSecretCalls).toBe(0)
      expect(h.requests).toEqual([])
      const local = await make().run({ mode: "production", origin: ORIGIN })
      expect(local.conditions).toEqual(["monitor_error"])
    })

    it("local mode refuses non-loopback origins", async () => {
      for (const origin of [
        "https://naba-lens.vercel.app",
        "http://example.com",
        "http://10.0.0.5:3642",
      ]) {
        const h = make()
        const result = await h.run({ origin })
        expect(result.conditions).toEqual(["monitor_error"])
        expect(h.requests).toEqual([])
      }
    })

    it("a probe condition that clears (the route answers again) recovers", async () => {
      const h = make()
      h.respond(() => jsonResponse({ error: "x" }, { status: 401 }))
      await h.run()
      h.body()
      await h.run({ now: NOW + 600_000 })
      expect(h.delivered.map((a) => a.condition)).toEqual([
        "auth_rejected",
        "recovered",
      ])
      expect(h.delivered[1].recoveredCondition).toBe("auth_rejected")
    })
  }
)

suite("alert payload (§4.6)", () => {
  it("has the contract shape: schema, uuid, ownerAction with docs anchor, ISO time, target, status allowlist", async () => {
    const h = make()
    h.body({
      ok: false,
      status: "stale",
      lastCompleteAt: new Date(NOW - 31 * HOUR).toISOString(),
    })
    await h.run()
    const alert = h.delivered[0]
    expect(alert).toMatchObject({
      schema: "nabalens.archive-alert/v1",
      condition: "stale",
      severity: "critical",
      target: "local",
      observedAt: new Date(NOW).toISOString(),
    })
    expect(alert.alertId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(alert.ownerAction).toContain("docs/archive-monitoring.md#stale")
    expect(alert.summary).toMatch(/\d+ hours/)
    expect(
      Object.keys(alert.status ?? {}).every((key) =>
        STATUS_FIELDS.includes(key)
      )
    ).toBe(true)
    expect(alert).not.toHaveProperty("recoveredCondition")
  })

  it("never forwards unexpected fields from the status body (object keys, bucket names, ids)", async () => {
    const h = make()
    h.body({
      ok: false,
      missing: 1,
      blobKey: "abc/blobs/sha256/aa/secret",
      bucket: "private-bucket",
      assetId: "11111111-1111-4111-8111-111111111111",
      lastError: null,
    })
    await h.run()
    const text = JSON.stringify(h.delivered)
    expect(text).not.toMatch(/blobs\/sha256|private-bucket|11111111-1111/)
  })

  it("only echoes lastError when it is a plain error code, never free text", async () => {
    const h = make()
    h.body({
      ok: false,
      failed: true,
      consecutiveFailures: 1,
      lastError: "connect ECONNREFUSED 10.0.0.1:5432 password=hunter2",
    })
    const result = await h.run()
    // Free text makes the body invalid, so it is reported as unreachable, never forwarded.
    expect(result.conditions).toEqual(["unreachable"])
    expect(JSON.stringify(h.delivered)).not.toMatch(/hunter2|ECONNREFUSED/)
  })

  it("normalizeStatus keeps only the contract fields", () => {
    const normalised = C().normalizeStatus({
      ...healthyBody(),
      extra: "x",
      bucket: "b",
    })
    expect(
      Object.keys(normalised ?? {}).every((key) => STATUS_FIELDS.includes(key))
    ).toBe(true)
  })
})

suite("sink failures are reported, never swallowed (§4.6)", () => {
  it("a failing sink gives exit 2, a fallback record for the undelivered alert, and a retry on the next run", async () => {
    const h = make()
    h.body({ ok: false, missing: 1 })
    h.faults.sink = () => new Error("sink down")
    const failed = await h.run()
    expect(failed.exitCode).toBe(2)
    expect(failed.errors).toContain("sink_delivery_failed")
    expect(failed.alerts[0]).toMatchObject({ delivered: false })
    expect(h.delivered).toEqual([])
    expect(h.undelivered).toHaveLength(1)
    expect(h.undelivered[0].alert).toMatchObject({
      condition: "missing_originals",
    })

    h.faults.sink = null
    const retried = await h.run({ now: NOW + 600_000 })
    expect(retried.exitCode).toBe(1)
    expect(conditionsOf(h.delivered)).toEqual(["missing_originals"])
    // Retry the same event so the destination can also deduplicate attempts.
    expect(h.delivered[0].alertId).toBe(h.undelivered[0].alert.alertId)
    await h.run({ now: NOW + 1_200_000 })
    expect(h.delivered).toHaveLength(1)
  })

  it("a sink that fails only for one of several alerts delivers the rest and still exits 2", async () => {
    const h = make()
    h.body({ ok: false, missing: 1, failed: true, consecutiveFailures: 1 })
    let calls = 0
    h.faults.sink = () => (++calls === 1 ? new Error("flaky") : null)
    const result = await h.run()
    expect(result.exitCode).toBe(2)
    expect(result.alerts.map((a) => a.delivered).sort()).toEqual([false, true])
    expect(h.delivered).toHaveLength(1)
    expect(h.undelivered).toHaveLength(1)
  })

  it("the sink being down while the archive is healthy is not an error", async () => {
    const h = make()
    h.faults.sink = () => new Error("sink down")
    expect((await h.run()).exitCode).toBe(0)
  })

  it("a recovered alert that cannot be delivered is retried until it is", async () => {
    const h = make()
    h.body({ ok: false, missing: 1 })
    await h.run()
    h.body()
    h.faults.sink = () => new Error("down")
    expect((await h.run({ now: NOW + 600_000 })).exitCode).toBe(2)
    h.faults.sink = null
    await h.run({ now: NOW + 1_200_000 })
    expect(h.delivered.at(-1)).toMatchObject({
      condition: "recovered",
      recoveredCondition: "missing_originals",
    })
  })
})

suite("heartbeat", () => {
  it("is sent after a clean run and a failure to send exits 2", async () => {
    const h = make()
    expect(
      (await h.run({ heartbeat: async () => ({ sent: true }) })).exitCode
    ).toBe(0)
    const failed = await h.run({
      heartbeat: async () => ({ sent: false, reason: "heartbeat_status_500" }),
    })
    expect(failed.exitCode).toBe(2)
    expect(failed.errors).toContain("heartbeat_failed")
  })

  it("is not sent when an alert could not be delivered", async () => {
    const h = make()
    h.body({ ok: false, missing: 1 })
    h.faults.sink = () => new Error("down")
    let beats = 0
    await h.run({ heartbeat: async () => (beats++, { sent: true }) })
    expect(beats).toBe(0)
  })
})
