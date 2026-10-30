import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

import {
  ARCHIVE_MONITOR_KEYCHAIN_SERVICE,
  ARCHIVE_MONITOR_ORIGIN,
  archiveMonitorOrigin,
  readMonitorSecret,
  runArchiveMonitor,
  runMonitoredSmoke,
} from "./monitor-archive.mjs"

const SECRET = "fixture_monitor_credential_".repeat(3)
const NOW = Date.parse("2026-10-30T16:00:00Z")
const CURRENT = {
  ok: true,
  status: "current",
  missing: 0,
  failed: false,
  inProgress: false,
  lastCompleteAt: "2026-10-30T15:00:00Z",
  lastRunAt: "2026-10-30T15:30:00Z",
}

async function fixture(t, { status = 200, body = CURRENT, headers = {} } = {}) {
  const requests = []
  const server = createServer((request, response) => {
    requests.push({
      path: request.url,
      method: request.method,
      headers: request.headers,
    })
    response.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      ...headers,
    })
    response.end(typeof body === "string" ? body : JSON.stringify(body))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const port = server.address().port
  const options = {
    now: NOW,
    loadSecret: async () => SECRET,
    fetchImpl: (url, init) => {
      assert.equal(url.origin, ARCHIVE_MONITOR_ORIGIN)
      assert.equal(init.redirect, "manual")
      assert.equal(init.credentials, "omit")
      return fetch(`http://127.0.0.1:${port}${url.pathname}`, init)
    },
  }
  const result = await runArchiveMonitor(ARCHIVE_MONITOR_ORIGIN, options)
  return { result, requests, options }
}

test("a current archive passes with exactly one read-only status request", async (t) => {
  const { result, requests } = await fixture(t)
  assert.deepEqual(result, { ok: true })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, "/api/internal/media-archive/status")
  assert.equal(requests[0].method, "GET")
  assert.equal(requests[0].headers.authorization, `Bearer ${SECRET}`)
  assert.equal(requests[0].headers.cookie, undefined)
  assert.equal(requests[0].headers["cache-control"], "no-cache")
})

test("origin is pinned before any credential lookup or request", async () => {
  for (const origin of [
    "https://attacker.test",
    "http://nabalens.vercel.app",
    "https://nabalens.vercel.app.attacker.test",
    `https://user:${SECRET}@nabalens.vercel.app`,
    `https://nabalens.vercel.app/?secret=${SECRET}`,
    "https://nabalens.vercel.app/path",
  ]) {
    let calls = 0
    const result = await runArchiveMonitor(origin, {
      loadSecret: () => {
        calls++
        return SECRET
      },
      fetchImpl: () => {
        calls++
        throw Error("should not run")
      },
    })
    assert.equal(result.ok, false)
    assert.equal(calls, 0)
    assert.ok(!JSON.stringify(result).includes(SECRET))
  }
  assert.equal(
    archiveMonitorOrigin(`${ARCHIVE_MONITOR_ORIGIN}/`),
    ARCHIVE_MONITOR_ORIGIN
  )
})

test("Keychain invocation has no secret in arguments, environment or diagnostics", async () => {
  const secret = await readMonitorSecret({
    execFileImpl: async (command, args, options) => {
      assert.equal(command, "/usr/bin/security")
      assert.deepEqual(args, [
        "find-generic-password",
        "-s",
        ARCHIVE_MONITOR_KEYCHAIN_SERVICE,
        "-a",
        ARCHIVE_MONITOR_ORIGIN,
        "-w",
      ])
      assert.ok(!JSON.stringify({ args, options }).includes(SECRET))
      assert.equal(options.env, undefined)
      assert.equal(options.timeout, 10_000)
      assert.equal(options.maxBuffer, 1024)
      return { stdout: `${SECRET}\n` }
    },
  })
  assert.equal(secret, SECRET)
  await assert.rejects(
    readMonitorSecret({
      execFileImpl: async () => {
        throw new Error(`keychain stderr ${SECRET}`)
      },
    }),
    (error) => !error.message.includes(SECRET) && /Keychain/.test(error.message)
  )
})

test("missing or invalid monitor credentials fail before a network call", async () => {
  for (const value of [
    "",
    "short",
    "x".repeat(257),
    `${SECRET}\r\nheader: value`,
  ]) {
    let requested = false
    const result = await runArchiveMonitor(ARCHIVE_MONITOR_ORIGIN, {
      loadSecret: async () => value,
      fetchImpl: async () => {
        requested = true
        throw Error("must not run")
      },
    })
    assert.equal(result.ok, false)
    assert.equal(requested, false)
    assert.ok(!JSON.stringify(result).includes(SECRET))
  }
  const result = await runArchiveMonitor(ARCHIVE_MONITOR_ORIGIN, {
    loadSecret: async () => {
      throw Error(SECRET)
    },
  })
  assert.equal(result.ok, false)
  assert.ok(!JSON.stringify(result).includes(SECRET))
})

for (const status of [301, 302, 401, 403, 500, 503]) {
  test(`HTTP ${status} is unhealthy without following or logging provider redirects`, async (t) => {
    const { result, requests } = await fixture(t, {
      status,
      headers: { location: `https://attacker.test/?token=${SECRET}` },
      body: { error: SECRET },
    })
    assert.equal(result.ok, false)
    assert.equal(requests.length, 1)
    assert.ok(!JSON.stringify(result).includes(SECRET))
    assert.ok(!JSON.stringify(result).includes("attacker"))
  })
}

for (const change of [
  { ok: false },
  { status: "stale" },
  { status: "disabled" },
  { missing: 1 },
  { missing: "0" },
  { failed: true },
  { failed: undefined },
  { inProgress: undefined },
  { lastCompleteAt: "2026-10-29T13:59:59Z" },
  { lastCompleteAt: "2026-10-30T16:00:01Z" },
  { lastRunAt: "2026-10-30T14:00:00Z" },
  { lastRunAt: "2026-10-30T16:00:01Z" },
  { lastCompleteAt: null },
  { lastRunAt: "garbage" },
]) {
  test(`rejects inconsistent archive health ${JSON.stringify(change)}`, async (t) => {
    const { result } = await fixture(t, { body: { ...CURRENT, ...change } })
    assert.equal(result.ok, false)
  })
}

test("a fresh complete audit remains healthy while the next cycle is in progress", async (t) => {
  const { result } = await fixture(t, {
    body: { ...CURRENT, inProgress: true },
  })
  assert.equal(result.ok, true)
})

test("an audit completing during the status request is compared against validation time", async () => {
  let clock = NOW
  const result = await runArchiveMonitor(ARCHIVE_MONITOR_ORIGIN, {
    loadSecret: async () => SECRET,
    now: () => clock,
    fetchImpl: async () => {
      // The server's new audit is newer than the request start, but is not
      // future-dated when its response arrives.
      clock += 1_000
      return Response.json(
        {
          ...CURRENT,
          lastCompleteAt: new Date(NOW + 500).toISOString(),
          lastRunAt: new Date(NOW + 500).toISOString(),
        },
        { headers: { "cache-control": "private, no-store" } }
      )
    },
  })
  assert.equal(result.ok, true)
})

for (const headers of [
  { "cache-control": "public, max-age=600" },
  { "cache-control": "no-store" },
  { "content-type": "text/html" },
]) {
  test(`rejects unexpected archive transport headers ${JSON.stringify(headers)}`, async (t) => {
    assert.equal((await fixture(t, { headers })).result.ok, false)
  })
}

test("oversized and malformed status bodies fail without leaking their contents", async (t) => {
  for (const body of [
    SECRET,
    JSON.stringify({ secret: SECRET, padding: "x".repeat(20_000) }),
  ]) {
    const { result } = await fixture(t, { body })
    assert.equal(result.ok, false)
    assert.ok(!JSON.stringify(result).includes(SECRET))
  }
})

test("transport errors containing credentials are always redacted", async () => {
  const result = await runArchiveMonitor(ARCHIVE_MONITOR_ORIGIN, {
    loadSecret: async () => SECRET,
    fetchImpl: async () => {
      throw new Error(`Bearer ${SECRET} https://private.test`)
    },
  })
  assert.equal(result.ok, false)
  assert.ok(!JSON.stringify(result).includes(SECRET))
  assert.ok(!JSON.stringify(result).includes("private.test"))
})

test("the actual CLI rejects unsafe targets without reflecting arguments or reading Keychain", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./monitor-archive.mjs", import.meta.url)),
      "--with-smoke",
      `${ARCHIVE_MONITOR_ORIGIN}/?token=${SECRET}`,
    ],
    { encoding: "utf8", timeout: 5_000 }
  )
  assert.equal(result.status, 1)
  assert.ok(!`${result.stdout}${result.stderr}`.includes(SECRET))
  assert.match(result.stderr, /could not run with its configured origin/)
})

test("combined wrapper preserves every signed-out check before checking archive health", async (t) => {
  const { options } = await fixture(t)
  const calls = []
  const combined = await runMonitoredSmoke(ARCHIVE_MONITOR_ORIGIN, {
    ...options,
    smokeImpl: async (origin) => {
      calls.push("smoke")
      assert.equal(origin, ARCHIVE_MONITOR_ORIGIN)
      return { ok: false, results: [{ path: "/login", ok: false }] }
    },
    loadSecret: async () => {
      calls.push("archive")
      return SECRET
    },
  })
  assert.deepEqual(calls, ["smoke", "archive"])
  assert.equal(combined.archive.ok, true)
  assert.equal(combined.ok, false)
  assert.deepEqual(combined.smoke.results, [{ path: "/login", ok: false }])
})

test("a healthy signed-out smoke cannot hide unavailable archive verification", async () => {
  const combined = await runMonitoredSmoke(ARCHIVE_MONITOR_ORIGIN, {
    smokeImpl: async () => ({
      ok: true,
      results: [{ path: "/login", ok: true }],
    }),
    loadSecret: async () => {
      throw Error(SECRET)
    },
  })
  assert.equal(combined.smoke.ok, true)
  assert.equal(combined.archive.ok, false)
  assert.equal(combined.ok, false)
  assert.ok(!JSON.stringify(combined).includes(SECRET))
})
