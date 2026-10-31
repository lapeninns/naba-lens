import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  PRODUCTION_ORIGIN,
  evaluateStatus,
  memoryStateStore,
  normalizeStatus,
  resolveDestination,
  resolveOrigin,
  runCheck,
  createHeartbeat,
  createHttpSink,
} from "./archive-checker.mjs"
import { runCli } from "./check-archive.mjs"
import runWorker, { runScheduled } from "./cloudflare-worker.mjs"
import { startStubSink } from "./stub-alert-sink.mjs"

const SECRET = "fixture_monitor_credential_".repeat(3)
const NOW = Date.parse("2026-10-30T16:00:00Z")
const HOUR = 3_600_000
const CURRENT = {
  ok: true,
  status: "current",
  missing: 0,
  failed: false,
  inProgress: false,
  lastCompleteAt: "2026-10-30T15:00:00Z",
  lastRunAt: "2026-10-30T15:30:00Z",
  lastError: null,
  lastRunOutcome: "partial",
  consecutiveFailures: 0,
  cycleStartedAt: null,
  cycleProgress: null,
  lastCycleDurationSeconds: 1200,
  maxAgeSeconds: 93_600,
  scheduleIntervalSeconds: 3600,
}
const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "private, no-store",
}

async function listen(t, handler) {
  const server = createServer(handler)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => {
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  })
  return server.address().port
}

/** Status server whose next response can be swapped between runs. */
async function statusServer(t) {
  const control = {
    status: 200,
    headers: JSON_HEADERS,
    body: CURRENT,
    hang: false,
    requests: [],
  }
  const port = await listen(t, (request, response) => {
    control.requests.push({
      path: request.url,
      method: request.method,
      headers: request.headers,
    })
    if (control.hang) return
    response.writeHead(control.status, control.headers)
    response.end(
      typeof control.body === "string"
        ? control.body
        : JSON.stringify(control.body)
    )
  })
  control.origin = `http://127.0.0.1:${port}`
  return control
}

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "nabalens-checker-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const sink = await startStubSink({ port: 0, dir })
  t.after(() => sink.close())
  const status = await statusServer(t)
  const state = memoryStateStore()
  const fallbackRecords = []
  const run = (overrides = {}) =>
    runCheck({
      mode: "local",
      origin: status.origin,
      loadSecret: async () => SECRET,
      env: {},
      now: NOW,
      state,
      sink: createHttpSink(sink.url),
      fallback: {
        record: async (alert, reason) => {
          fallbackRecords.push({ alert, reason })
        },
      },
      timeoutMs: 2000,
      ...overrides,
    })
  const delivered = async () =>
    (await readFile(sink.file, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line).alert)
  return { dir, sink, status, state, run, delivered, fallbackRecords }
}

const staleBody = (hoursAgo) => ({
  ...CURRENT,
  status: "stale",
  ok: false,
  lastCompleteAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
})

const CONDITION_CASES = [
  ["stale", staleBody(31), "critical", /31 hours/],
  [
    "stale",
    { ...CURRENT, ok: false, status: "stale", lastCompleteAt: null },
    "critical",
    /never completed/,
  ],
  ["stale", { ok: false, status: "disabled" }, "critical", /disabled/],
  [
    "missing_originals",
    { ...CURRENT, ok: false, missing: 2 },
    "critical",
    /2 ready originals have no verified/,
  ],
  [
    "run_failed",
    {
      ...CURRENT,
      ok: false,
      failed: true,
      lastError: "archive_audit_failed",
      consecutiveFailures: 1,
    },
    "warning",
    /archive_audit_failed/,
  ],
  [
    "run_failed",
    {
      ...CURRENT,
      ok: false,
      failed: true,
      lastError: "archive_audit_timeout",
      consecutiveFailures: 3,
    },
    "critical",
    /3 consecutive/,
  ],
  [
    "not_running",
    { ...CURRENT, lastRunAt: new Date(NOW - 4 * HOUR).toISOString() },
    "critical",
    /240 minutes/,
  ],
]

for (const [condition, body, severity, summary] of CONDITION_CASES) {
  test(`raises ${condition} (${severity}) for ${JSON.stringify(body).slice(0, 60)}`, async (t) => {
    const h = await setup(t)
    h.status.body = body
    h.status.status = body.ok ? 200 : 503
    const result = await h.run()
    assert.deepEqual(result.conditions, [condition])
    assert.equal(result.exitCode, 1)
    const [alert] = await h.delivered()
    assert.equal(alert.schema, "nabalens.archive-alert/v1")
    assert.equal(alert.condition, condition)
    assert.equal(alert.severity, severity)
    assert.match(alert.summary, summary)
    assert.match(
      alert.ownerAction,
      new RegExp(`docs/archive-monitoring\\.md#${condition}$`)
    )
    assert.equal(alert.target, "local")
    assert.equal(alert.observedAt, new Date(NOW).toISOString())
    assert.match(alert.alertId, /^[0-9a-f-]{36}$/)
    assert.ok(!JSON.stringify(alert).includes(SECRET))
  })
}

test("a healthy archive sends one read-only request and no alert", async (t) => {
  const h = await setup(t)
  const result = await h.run()
  assert.equal(result.exitCode, 0)
  assert.equal(result.ok, true)
  assert.deepEqual(await h.delivered(), [])
  assert.equal(h.status.requests.length, 1)
  const [request] = h.status.requests
  assert.equal(request.path, "/api/internal/media-archive/status")
  assert.equal(request.method, "GET")
  assert.equal(request.headers.authorization, `Bearer ${SECRET}`)
  assert.equal(request.headers.cookie, undefined)
})

test("an in-progress cycle with a fresh complete cycle is healthy", async (t) => {
  const h = await setup(t)
  h.status.body = {
    ...CURRENT,
    inProgress: true,
    cycleProgress: { checked: 10, target: 100 },
    cycleStartedAt: "2026-10-30T15:45:00Z",
  }
  assert.equal((await h.run()).exitCode, 0)
})

test("a status body cannot widen the 26-hour threshold or hide a stopped job", async (t) => {
  const h = await setup(t)
  h.status.body = {
    ...CURRENT,
    maxAgeSeconds: 10_000_000,
    lastCompleteAt: new Date(NOW - 27 * HOUR).toISOString(),
  }
  assert.deepEqual((await h.run()).conditions, ["stale"])
  const s = normalizeStatus({
    ...CURRENT,
    scheduleIntervalSeconds: 10_000_000,
    lastRunAt: new Date(NOW - 5 * 86_400_000).toISOString(),
  })
  assert.ok(evaluateStatus(s, NOW).has("not_running"))
})

test("an older route without the additive fields still evaluates the core conditions", async (t) => {
  const h = await setup(t)
  const legacy = {
    ok: true,
    status: "current",
    missing: 0,
    lastCompleteAt: CURRENT.lastCompleteAt,
    lastRunAt: CURRENT.lastRunAt,
    failed: false,
    inProgress: false,
  }
  h.status.body = legacy
  assert.equal((await h.run()).exitCode, 0)
  h.status.body = { ...legacy, ok: false, missing: 1 }
  h.status.status = 503
  assert.deepEqual((await h.run()).conditions, ["missing_originals"])
})

test("alert status carries only whitelisted fields and known error codes", async (t) => {
  const h = await setup(t)
  h.status.status = 503
  h.status.body = {
    ...staleBody(30),
    bucket: "private-bucket",
    assetId: "asset-1",
    lastError: "archive_audit_failed",
  }
  await h.run()
  const [alert] = await h.delivered()
  assert.equal(alert.status.lastError, "archive_audit_failed")
  assert.ok(!("bucket" in alert.status) && !("assetId" in alert.status))
  assert.equal(
    normalizeStatus({ ...CURRENT, lastError: "provider said: Bearer abc" }),
    null
  )
  assert.equal(normalizeStatus({ ...CURRENT, lastRunOutcome: "Weird!" }), null)
})

const PROBE_FAILURES = [
  ["timeout", { hang: true }, "unreachable", /timeout/],
  [
    "redirect 302",
    {
      status: 302,
      headers: { ...JSON_HEADERS, location: "https://attacker.test/" },
      body: {},
    },
    "unreachable",
    /redirect/,
  ],
  [
    "5xx without a body",
    { status: 500, body: "boom" },
    "unreachable",
    /http_500/,
  ],
  [
    "503 without a valid body",
    { status: 503, body: { error: "unconfigured" } },
    "unreachable",
    /invalid_body/,
  ],
  ["non-JSON", { body: "<html>" }, "unreachable", /invalid_body/],
  [
    "oversized body",
    { body: JSON.stringify({ ...CURRENT, pad: "x".repeat(20_000) }) },
    "unreachable",
    /oversized_body/,
  ],
  [
    "wrong cache headers",
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public",
      },
    },
    "unreachable",
    /bad_headers/,
  ],
  [
    "wrong content type",
    {
      headers: {
        "content-type": "text/html",
        "cache-control": "private, no-store",
      },
    },
    "unreachable",
    /bad_headers/,
  ],
  [
    "malformed field",
    { body: { ...CURRENT, missing: "0" } },
    "unreachable",
    /invalid_body/,
  ],
  [
    "401",
    { status: 401, body: { error: "unauthorized" } },
    "auth_rejected",
    /http_401/,
  ],
  [
    "403",
    { status: 403, body: { error: SECRET } },
    "auth_rejected",
    /http_403/,
  ],
]

for (const [name, response, condition, summary] of PROBE_FAILURES) {
  test(`${name} is ${condition} without following redirects or leaking the response`, async (t) => {
    const h = await setup(t)
    Object.assign(h.status, response)
    const result = await h.run({ timeoutMs: response.hang ? 100 : 2000 })
    assert.deepEqual(result.conditions, [condition])
    assert.equal(result.exitCode, 1)
    const [alert] = await h.delivered()
    assert.equal(alert.condition, condition)
    assert.match(alert.summary, summary)
    assert.equal(alert.status, null)
    const text = JSON.stringify(alert)
    assert.ok(!text.includes(SECRET) && !text.includes("attacker"))
    assert.equal(h.status.requests.length, 1)
  })
}

test("a network error is unreachable", async (t) => {
  const h = await setup(t)
  const result = await h.run({
    fetchImpl: async () => {
      throw new Error(`connect ECONNREFUSED Bearer ${SECRET}`)
    },
  })
  assert.deepEqual(result.conditions, ["unreachable"])
  assert.ok(!JSON.stringify(await h.delivered()).includes(SECRET))
})

test("monitor_error for bad credentials, broad environment, bad origin and unpinned production", async (t) => {
  const h = await setup(t)
  const cases = [
    { loadSecret: async () => undefined },
    { loadSecret: async () => "short" },
    {
      loadSecret: async () => {
        throw new Error(SECRET)
      },
    },
    { env: { CLEANUP_SECRET: "x".repeat(40) } },
    { env: { CRON_SECRET: "x".repeat(40) } },
    { env: { SUPABASE_SERVICE_ROLE_KEY: "x".repeat(40) } },
    { origin: "https://attacker.test" },
    { origin: "http://localhost:3000" },
    { mode: "production", origin: "https://nabalens.vercel.app" },
    {
      mode: "production",
      origin: `https://user:${SECRET}@naba-lens.vercel.app`,
    },
    { mode: "production", origin: "http://naba-lens.vercel.app" },
    { mode: "production", origin: `${PRODUCTION_ORIGIN}/?secret=${SECRET}` },
    { mode: "nonsense" },
  ]
  for (const overrides of cases) {
    const result = await h.run({ state: memoryStateStore(), ...overrides })
    assert.deepEqual(
      result.conditions,
      ["monitor_error"],
      JSON.stringify(overrides)
    )
    assert.equal(result.exitCode, 1)
  }
  assert.equal(h.status.requests.length, 0)
  const alerts = await h.delivered()
  assert.equal(alerts.length, cases.length)
  assert.ok(!JSON.stringify(alerts).includes(SECRET))
  assert.ok(alerts.every((a) => a.condition === "monitor_error"))
})

test("production origin is pinned and local mode accepts loopback origins only", () => {
  assert.equal(resolveOrigin({}), PRODUCTION_ORIGIN)
  assert.equal(
    resolveOrigin({ origin: `${PRODUCTION_ORIGIN}/` }),
    PRODUCTION_ORIGIN
  )
  assert.throws(() => resolveOrigin({ origin: "http://127.0.0.1:3000" }))
  assert.equal(
    resolveOrigin({ mode: "local", origin: "http://127.0.0.1:3642" }),
    "http://127.0.0.1:3642"
  )
  assert.equal(
    resolveOrigin({ mode: "local", origin: "http://[::1]:3642" }),
    "http://[::1]:3642"
  )
  for (const origin of [
    PRODUCTION_ORIGIN,
    "http://example.com",
    "http://localhost:3000",
    "http://127.0.0.1.attacker.test",
    "http://127.0.0.1:3000/path",
    "http://user:pw@127.0.0.1:3000",
    undefined,
  ]) {
    assert.throws(
      () => resolveOrigin({ mode: "local", origin }),
      undefined,
      String(origin)
    )
  }
  assert.throws(() =>
    resolveDestination("http://example.com/hook", {
      mode: "production",
      label: "alert sink",
    })
  )
  assert.throws(() =>
    resolveDestination("https://user:pw@example.com/", {
      mode: "production",
      label: "alert sink",
    })
  )
  assert.throws(() =>
    resolveDestination("https://example.com/hook", {
      mode: "local",
      label: "alert sink",
    })
  )
  assert.ok(
    resolveDestination("https://example.com/hook", {
      mode: "production",
      label: "alert sink",
    })
  )
  assert.ok(
    resolveDestination("http://127.0.0.1:3650/alerts", {
      mode: "local",
      label: "alert sink",
    })
  )
})

test("dedup: one alert per condition until it clears, then recovered", async (t) => {
  const h = await setup(t)
  h.status.status = 503
  h.status.body = { ...CURRENT, ok: false, missing: 1 }
  for (let i = 0; i < 3; i++) {
    const result = await h.run()
    assert.equal(result.exitCode, 1)
  }
  assert.equal((await h.delivered()).length, 1)

  h.status.status = 200
  h.status.body = CURRENT
  const recovered = await h.run()
  assert.equal(recovered.exitCode, 0)
  const alerts = await h.delivered()
  assert.equal(alerts.length, 2)
  assert.equal(alerts[1].condition, "recovered")
  assert.equal(alerts[1].severity, "info")
  assert.equal(alerts[1].recoveredCondition, "missing_originals")
  assert.match(alerts[1].ownerAction, /#recovered$/)

  assert.equal((await h.run()).exitCode, 0)
  assert.equal((await h.delivered()).length, 2)
  // The same condition after recovery alerts again.
  h.status.status = 503
  h.status.body = { ...CURRENT, ok: false, missing: 1 }
  await h.run()
  assert.equal((await h.delivered()).length, 3)
})

test("independent conditions dedupe separately and recover separately", async (t) => {
  const h = await setup(t)
  h.status.status = 503
  h.status.body = { ...staleBody(30), missing: 3 }
  const first = await h.run()
  assert.deepEqual(first.conditions.sort(), ["missing_originals", "stale"])
  assert.equal((await h.delivered()).length, 2)
  h.status.body = { ...CURRENT, ok: false, missing: 3 }
  await h.run()
  const alerts = await h.delivered()
  assert.equal(alerts.length, 3)
  assert.equal(alerts[2].recoveredCondition, "stale")
})

test("run_failed escalates once from warning to critical", async (t) => {
  const h = await setup(t)
  h.status.status = 503
  const failing = (n) => ({
    ...CURRENT,
    ok: false,
    failed: true,
    lastError: "archive_audit_failed",
    consecutiveFailures: n,
  })
  h.status.body = failing(1)
  await h.run()
  h.status.body = failing(2)
  await h.run()
  assert.equal((await h.delivered()).length, 1)
  h.status.body = failing(3)
  await h.run()
  h.status.body = failing(4)
  await h.run()
  const alerts = await h.delivered()
  assert.deepEqual(
    alerts.map((a) => a.severity),
    ["warning", "critical"]
  )
})

test("a probe failure neither clears nor duplicates data conditions", async (t) => {
  const h = await setup(t)
  h.status.status = 503
  h.status.body = staleBody(30)
  await h.run()
  h.status.status = 500
  h.status.body = "down"
  await h.run()
  await h.run()
  let alerts = await h.delivered()
  assert.deepEqual(
    alerts.map((a) => a.condition),
    ["stale", "unreachable"]
  )
  // Back up and still stale: unreachable recovers, stale stays quiet.
  h.status.status = 503
  h.status.body = staleBody(30)
  await h.run()
  alerts = await h.delivered()
  assert.deepEqual(
    alerts.map((a) => a.condition),
    ["stale", "unreachable", "recovered"]
  )
  assert.equal(alerts[2].recoveredCondition, "unreachable")
  // Switching probe failures replaces silently rather than reporting a recovery.
  h.status.status = 500
  await h.run()
  h.status.status = 401
  await h.run()
  alerts = await h.delivered()
  assert.deepEqual(
    alerts.slice(3).map((a) => a.condition),
    ["unreachable", "auth_rejected"]
  )
})

test("auth rejection recovers when the credential works again", async (t) => {
  const h = await setup(t)
  h.status.status = 401
  h.status.body = { error: "unauthorized" }
  assert.deepEqual((await h.run()).conditions, ["auth_rejected"])
  h.status.status = 200
  h.status.body = CURRENT
  assert.equal((await h.run()).exitCode, 0)
  const alerts = await h.delivered()
  assert.deepEqual(
    alerts.map((a) => a.recoveredCondition ?? a.condition),
    ["auth_rejected", "auth_rejected"]
  )
})

test("sink down: nonzero exit, fallback record, no dedup advance, retried next run", async (t) => {
  const h = await setup(t)
  h.status.status = 503
  h.status.body = staleBody(30)
  const failing = await h.run({
    sink: createHttpSink("http://127.0.0.1:9/alerts", { timeoutMs: 500 }),
  })
  assert.equal(failing.exitCode, 2)
  assert.deepEqual(failing.errors, ["sink_delivery_failed"])
  assert.equal(failing.alerts[0].delivered, false)
  assert.equal(h.fallbackRecords.length, 1)
  assert.equal(h.fallbackRecords[0].alert.condition, "stale")
  assert.equal(h.fallbackRecords[0].reason, "sink_network_error")
  const retried = await h.run()
  assert.equal(retried.exitCode, 1)
  const alerts = await h.delivered()
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].condition, "stale")
})

for (const [name, handler, reason, timeoutMs] of [
  [
    "HTTP 500",
    (_req, res) => {
      res.writeHead(500)
      res.end("no")
    },
    "sink_status_500",
    2000,
  ],
  [
    "redirect",
    (_req, res) => {
      res.writeHead(302, { location: "https://attacker.test/" })
      res.end()
    },
    "sink_redirect",
    2000,
  ],
  ["timeout", () => {}, "sink_timeout", 100],
]) {
  test(`sink ${name} is a surfaced delivery failure`, async (t) => {
    const h = await setup(t)
    h.status.status = 503
    h.status.body = { ...CURRENT, ok: false, missing: 1 }
    const port = await listen(t, handler)
    const result = await h.run({
      sink: createHttpSink(`http://127.0.0.1:${port}/alerts`, { timeoutMs }),
    })
    assert.equal(result.exitCode, 2)
    assert.equal(h.fallbackRecords[0].reason, reason)
    assert.equal(result.alerts[0].delivered, false)
  })
}

test("a failed recovered alert keeps the condition active until it is delivered", async (t) => {
  const h = await setup(t)
  h.status.status = 503
  h.status.body = { ...CURRENT, ok: false, missing: 1 }
  await h.run()
  h.status.status = 200
  h.status.body = CURRENT
  const failed = await h.run({
    sink: createHttpSink("http://127.0.0.1:9/alerts", { timeoutMs: 500 }),
  })
  assert.equal(failed.exitCode, 2)
  assert.equal((await h.run()).exitCode, 0)
  assert.equal((await h.delivered()).at(-1).condition, "recovered")
})

test("state save failure is surfaced", async (t) => {
  const h = await setup(t)
  const result = await h.run({
    state: {
      load: async () => null,
      save: async () => {
        throw new Error("disk")
      },
    },
  })
  assert.equal(result.exitCode, 2)
  assert.deepEqual(result.errors, ["state_save_failed"])
})

test("heartbeat is sent after a delivered run, including an unhealthy one, but not after a delivery failure", async (t) => {
  const h = await setup(t)
  let pings = 0
  const port = await listen(t, (_req, res) => {
    pings++
    res.end("ok")
  })
  const heartbeat = createHeartbeat(`http://127.0.0.1:${port}/ping`)
  assert.equal((await h.run({ heartbeat })).heartbeat.sent, true)
  h.status.status = 503
  h.status.body = { ...CURRENT, ok: false, missing: 1 }
  assert.equal((await h.run({ heartbeat })).exitCode, 1)
  assert.equal(pings, 2)
  h.status.body = {
    ...CURRENT,
    ok: false,
    missing: 2,
    failed: true,
    consecutiveFailures: 1,
  }
  const failed = await h.run({
    heartbeat,
    sink: createHttpSink("http://127.0.0.1:9/alerts", { timeoutMs: 500 }),
  })
  assert.equal(failed.heartbeat.reason, "delivery_failed")
  assert.equal(pings, 2)
  const dead = await h.run({
    state: memoryStateStore(),
    heartbeat: createHeartbeat("http://127.0.0.1:9/ping", { timeoutMs: 300 }),
  })
  assert.deepEqual(dead.errors, ["heartbeat_failed"])
  assert.equal(dead.exitCode, 2)
})

test("slack format posts a text message without the alert JSON", async (t) => {
  let received
  const port = await listen(t, (req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      received = JSON.parse(body)
      res.end("ok")
    })
  })
  await createHttpSink(`http://127.0.0.1:${port}/hook`, {
    format: "slack",
  }).deliver({
    severity: "critical",
    summary: "Archive verification has not completed for 31 hours",
    ownerAction: "Check the logs; see docs/archive-monitoring.md#stale",
  })
  assert.deepEqual(Object.keys(received), ["text"])
  assert.match(received.text, /^\[CRITICAL\] Archive verification/)
})

test("the stub sink rejects malformed alerts and keeps nothing for them", async (t) => {
  const h = await setup(t)
  const post = (body) => fetch(h.sink.url, { method: "POST", body })
  assert.equal((await post("not json")).status, 400)
  assert.equal((await post(JSON.stringify({ schema: "other" }))).status, 422)
  assert.equal((await post("x".repeat(40_000))).status, 413)
  assert.equal(
    (await fetch(`http://127.0.0.1:${h.sink.port}/health`)).status,
    200
  )
  assert.equal(
    (await fetch(`http://127.0.0.1:${h.sink.port}/nope`)).status,
    404
  )
  assert.deepEqual(await h.delivered(), [])
})

test("the Worker entry reads only its bindings, stores state in KV and fails visibly on delivery errors", async (t) => {
  const h = await setup(t)
  h.status.status = 503
  h.status.body = { ...CURRENT, ok: false, missing: 1 }
  const kv = new Map()
  const CHECKER_STATE = {
    get: async (key) => (kv.has(key) ? JSON.parse(kv.get(key)) : null),
    put: async (key, value) => void kv.set(key, value),
  }
  // The Worker pins production, so route the pinned origin to the local stub.
  const fetchImpl = (url, init) => {
    const target = String(url)
    if (target.startsWith(PRODUCTION_ORIGIN)) {
      return fetch(`${h.status.origin}${new URL(target).pathname}`, init)
    }
    return fetch(url, init)
  }
  const env = {
    MEDIA_ARCHIVE_MONITOR_SECRET: SECRET,
    ALERT_SINK_URL: "https://alerts.example.test/hook",
    CHECKER_STATE,
  }
  const sinkRouting = (url, init) =>
    String(url).startsWith("https://alerts.example.test")
      ? fetch(h.sink.url, init)
      : fetchImpl(url, init)
  const result = await runScheduled(env, { fetchImpl: sinkRouting, now: NOW })
  assert.deepEqual(result.conditions, ["missing_originals"])
  await runScheduled(env, { fetchImpl: sinkRouting, now: NOW })
  assert.equal((await h.delivered()).length, 1)
  assert.ok(kv.has("state:production"))
  assert.equal(typeof runWorker.scheduled, "function")
  assert.ok(![...kv.values()].some((v) => v.includes(SECRET)))
  await assert.rejects(
    runScheduled(
      {
        ...env,
        CLEANUP_SECRET: "x".repeat(40),
        CHECKER_STATE: {
          get: async () => null,
          put: async (k, v) => void kv.set(k, v),
        },
        ALERT_SINK_URL: "https://down.example.test/hook",
      },
      {
        fetchImpl: (url, init) =>
          String(url).startsWith("https://down.example.test")
            ? Promise.reject(new Error("down"))
            : fetchImpl(url, init),
        now: NOW,
      }
    ),
    /sink_delivery_failed/
  )
  assert.ok([...kv.keys()].some((k) => k.startsWith("undelivered:")))
})

test("CLI end to end: local mode, state file dedup, and exit codes", async (t) => {
  const h = await setup(t)
  const env = { MEDIA_ARCHIVE_MONITOR_SECRET: SECRET }
  const lines = []
  const argv = [
    "--local",
    "--origin",
    h.status.origin,
    "--sink",
    h.sink.url,
    "--alerts-dir",
    h.dir,
    "--state",
    join(h.dir, "state.json"),
  ]
  const cli = () =>
    runCli(argv, {
      env,
      now: NOW,
      log: (l) => lines.push(l),
      logError: (l) => lines.push(l),
    })
  assert.equal(await cli(), 0)
  h.status.status = 503
  h.status.body = staleBody(40)
  assert.equal(await cli(), 1)
  assert.equal(await cli(), 1)
  assert.equal((await h.delivered()).length, 1)
  assert.ok(lines.some((l) => l === "ALERT stale critical delivered"))
  h.status.status = 200
  h.status.body = CURRENT
  assert.equal(await cli(), 0)
  assert.equal((await h.delivered()).at(-1).condition, "recovered")
  assert.ok(!lines.join("\n").includes(SECRET))
})

test("CLI reads the credential from a file, never from arguments, and rejects two sources", async (t) => {
  const h = await setup(t)
  const secretFile = join(h.dir, "secret")
  await writeFile(secretFile, `${SECRET}\n`, { mode: 0o600 })
  const argv = [
    "--local",
    "--origin",
    h.status.origin,
    "--sink",
    h.sink.url,
    "--alerts-dir",
    h.dir,
  ]
  const quiet = { now: NOW, log() {}, logError() {} }
  assert.equal(
    await runCli(argv, {
      ...quiet,
      env: { MEDIA_ARCHIVE_MONITOR_SECRET_FILE: secretFile },
    }),
    0
  )
  assert.equal(
    h.status.requests.at(-1).headers.authorization,
    `Bearer ${SECRET}`
  )
  assert.equal(
    await runCli(argv, {
      ...quiet,
      env: {
        MEDIA_ARCHIVE_MONITOR_SECRET_FILE: secretFile,
        MEDIA_ARCHIVE_MONITOR_SECRET: SECRET,
      },
    }),
    1
  )
  assert.equal((await h.delivered()).at(-1).condition, "monitor_error")
  assert.equal(await runCli(argv, { ...quiet, env: {} }), 1)
})

test("CLI with an unusable sink exits 2 and writes the fallback record", async (t) => {
  const h = await setup(t)
  const env = { MEDIA_ARCHIVE_MONITOR_SECRET: SECRET }
  const errors = []
  const quiet = { env, now: NOW, log() {}, logError: (l) => errors.push(l) }
  for (const sinkArgs of [
    [],
    ["--sink", "https://alerts.example.test/hook"],
    ["--sink", "http://example.com/hook"],
  ]) {
    const code = await runCli(
      [
        "--local",
        "--origin",
        h.status.origin,
        "--alerts-dir",
        h.dir,
        ...sinkArgs,
      ],
      quiet
    )
    assert.equal(code, 2)
  }
  const lines = (await readFile(join(h.dir, "undelivered.jsonl"), "utf8"))
    .trim()
    .split("\n")
  assert.equal(lines.length, 3)
  assert.equal(JSON.parse(lines[0]).alert.condition, "monitor_error")
  assert.equal(h.status.requests.length, 0)

  // A reachable status route but a dead sink: the alert lands in the fallback file.
  h.status.status = 503
  h.status.body = staleBody(40)
  const code = await runCli(
    [
      "--local",
      "--origin",
      h.status.origin,
      "--sink",
      "http://127.0.0.1:9/alerts",
      "--alerts-dir",
      h.dir,
    ],
    { ...quiet, now: NOW }
  )
  assert.equal(code, 2)
  const last = JSON.parse(
    (await readFile(join(h.dir, "undelivered.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .at(-1)
  )
  assert.equal(last.alert.condition, "stale")
  assert.equal(last.reason, "sink_network_error")
  assert.ok(errors.some((l) => /sink_delivery_failed/.test(l)))
})

test("CLI refuses an unpinned production origin and never reflects arguments", async (t) => {
  const h = await setup(t)
  const out = []
  const code = await runCli(
    [
      "--origin",
      `https://attacker.test/?token=${SECRET}`,
      "--sink",
      "https://alerts.example.test/hook",
      "--alerts-dir",
      h.dir,
    ],
    {
      env: { MEDIA_ARCHIVE_MONITOR_SECRET: SECRET },
      log: (l) => out.push(l),
      logError: (l) => out.push(l),
    }
  )
  assert.equal(code, 2)
  assert.ok(!out.join("\n").includes(SECRET))
  assert.ok(
    !(await readFile(join(h.dir, "undelivered.jsonl"), "utf8")).includes(SECRET)
  )
})

test("idle runs keep lastRunAt fresh and raise nothing, whatever the outcome code", async (t) => {
  const h = await setup(t)
  h.status.body = {
    ...CURRENT,
    scheduleIntervalSeconds: 600,
    lastRunOutcome: "idle",
    lastRunAt: new Date(NOW - 10 * 60_000).toISOString(),
    lastCompleteAt: new Date(NOW - 13 * HOUR).toISOString(),
  }
  const result = await h.run()
  assert.equal(result.exitCode, 0)
  assert.deepEqual(await h.delivered(), [])
  // An outcome this checker does not know is accepted and never alerts alone.
  h.status.body = { ...h.status.body, lastRunOutcome: "paused_by_operator" }
  assert.equal((await h.run()).exitCode, 0)
  assert.ok(normalizeStatus({ ...CURRENT, lastRunOutcome: "idle" }))
})

test("not_running fires at 3 x the 600 s interval, not before; idle does not hide it", async (t) => {
  const h = await setup(t)
  const body = (minutes) => ({
    ...CURRENT,
    scheduleIntervalSeconds: 600,
    lastRunOutcome: "idle",
    lastRunAt: new Date(NOW - minutes * 60_000).toISOString(),
  })
  h.status.body = body(29)
  assert.equal((await h.run()).exitCode, 0)
  h.status.body = body(31)
  const result = await h.run()
  assert.deepEqual(result.conditions, ["not_running"])
  assert.match((await h.delivered())[0].summary, /31 minutes/)
})

test("cycle_slow is a warning above 72,000 s and routes to the digest sink, not the paging sink", async (t) => {
  const h = await setup(t)
  const digestDir = await mkdtemp(join(tmpdir(), "nabalens-digest-"))
  t.after(() => rm(digestDir, { recursive: true, force: true }))
  const digest = await startStubSink({ port: 0, dir: digestDir })
  t.after(() => digest.close())
  const digestSink = createHttpSink(digest.url)
  const digested = async () =>
    (await readFile(digest.file, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line).alert)

  h.status.body = { ...CURRENT, lastCycleDurationSeconds: 72_000 }
  assert.equal((await h.run({ digestSink })).exitCode, 0)

  h.status.body = { ...CURRENT, lastCycleDurationSeconds: 72_001 }
  const slow = await h.run({ digestSink })
  assert.deepEqual(slow.conditions, ["cycle_slow"])
  await h.run({ digestSink })
  assert.deepEqual(await h.delivered(), [])
  const [alert] = await digested()
  assert.equal(alert.condition, "cycle_slow")
  assert.equal(alert.severity, "warning")
  assert.match(alert.summary, /20\.0 hours/)
  assert.match(alert.ownerAction, /#cycle_slow$/)
  assert.equal((await digested()).length, 1)

  h.status.body = { ...CURRENT, lastCycleDurationSeconds: 60_000 }
  await h.run({ digestSink })
  const after = await digested()
  assert.equal(after.at(-1).recoveredCondition, "cycle_slow")
  assert.deepEqual(await h.delivered(), [])

  // A paging condition still goes to the paging sink with a digest sink set.
  h.status.status = 503
  h.status.body = {
    ...CURRENT,
    ok: false,
    missing: 1,
    lastCycleDurationSeconds: 80_000,
  }
  await h.run({ digestSink })
  assert.deepEqual(
    (await h.delivered()).map((a) => a.condition),
    ["missing_originals"]
  )
})

test("cycle_slow without a digest sink falls back to the main sink", async (t) => {
  const h = await setup(t)
  h.status.body = { ...CURRENT, lastCycleDurationSeconds: 80_000 }
  await h.run()
  assert.equal((await h.delivered())[0].condition, "cycle_slow")
})

test("CLI --digest-sink sends cycle_slow there", async (t) => {
  const h = await setup(t)
  const digestDir = await mkdtemp(join(tmpdir(), "nabalens-digest-"))
  t.after(() => rm(digestDir, { recursive: true, force: true }))
  const digest = await startStubSink({ port: 0, dir: digestDir })
  t.after(() => digest.close())
  h.status.body = { ...CURRENT, lastCycleDurationSeconds: 80_000 }
  const code = await runCli(
    [
      "--local",
      "--origin",
      h.status.origin,
      "--sink",
      h.sink.url,
      "--digest-sink",
      digest.url,
      "--alerts-dir",
      h.dir,
    ],
    {
      env: { MEDIA_ARCHIVE_MONITOR_SECRET: SECRET },
      now: NOW,
      log() {},
      logError() {},
    }
  )
  assert.equal(code, 1)
  assert.deepEqual(await h.delivered(), [])
  assert.match(await readFile(digest.file, "utf8"), /"condition":"cycle_slow"/)
})

test("CLI --help prints the exit code contract and makes no request", async () => {
  const lines = []
  const code = await runCli(["--help"], {
    env: {},
    fetchImpl: () => assert.fail("--help must not fetch"),
    log: (line) => lines.push(line),
    logError() {},
  })
  assert.equal(code, 0)
  const text = lines.join("\n")
  assert.match(text, /1 {2}at least one condition is active/)
  assert.match(text, /must\s+not page on exit 1 alone/)
})
