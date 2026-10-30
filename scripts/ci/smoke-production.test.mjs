import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import test from "node:test"

import { productionOrigin, runProductionSmoke } from "./smoke-production.mjs"

const ORIGIN = "https://nabalens.example.test"
const LOGIN =
  '<!doctype html><title>Sign in · NabaLens</title><form><input type="email"><button>Send sign-in link</button></form>'
const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
}

function applicationResponse(path) {
  if (path === "/login")
    return {
      status: 200,
      headers: { "content-type": "text/html" },
      body: LOGIN,
    }
  if (["/", "/admin", "/admin/menus", "/staff"].includes(path)) {
    return { status: 307, headers: { location: `${ORIGIN}/login` }, body: "" }
  }
  if (["/api/library", "/api/portfolio"].includes(path)) {
    return {
      status: 401,
      headers: { ...PRIVATE_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ ok: false, message: "Sign in to continue." }),
    }
  }
  if (path.startsWith("/api/media/")) {
    return {
      status: 401,
      headers: { ...PRIVATE_HEADERS, "content-type": "text/plain" },
      body: "Sign in to continue.",
    }
  }
  if (path === "/api/internal/cleanup") {
    return {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
      },
      body: JSON.stringify({ error: "unauthorized" }),
    }
  }
  return {
    status: 404,
    headers: { "content-type": "text/html" },
    body: "Not found",
  }
}

async function fixture(t, change = (_path, response) => response) {
  const requests = []
  const server = createServer((request, response) => {
    requests.push({
      path: request.url,
      method: request.method,
      headers: request.headers,
    })
    const result = change(request.url, applicationResponse(request.url))
    response.writeHead(result.status, result.headers)
    response.end(result.body)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const port = server.address().port
  const fetchImpl = (url, options) => {
    assert.equal(url.origin, ORIGIN)
    assert.equal(options.redirect, "manual")
    assert.equal(options.credentials, "omit")
    return fetch(`http://127.0.0.1:${port}${url.pathname}`, options)
  }
  return { requests, result: await runProductionSmoke(ORIGIN, { fetchImpl }) }
}

test("the expected application passes all read-only checks without credentials", async (t) => {
  const { requests, result } = await fixture(t)
  assert.equal(result.ok, true)
  assert.equal(result.results.length, 11)
  assert.equal(requests.length, 11)
  assert.ok(requests.every((request) => request.method === "GET"))
  assert.ok(
    requests.every(
      (request) => !request.headers.cookie && !request.headers.authorization
    )
  )
  assert.equal(
    requests.filter((request) => request.path === "/api/internal/cleanup")
      .length,
    1
  )
})

test("target validation rejects missing/insecure/credential-bearing/non-origin URLs", () => {
  for (const raw of [
    undefined,
    "",
    "http://example.test",
    "https://user:secret@example.test",
    "https://example.test/path",
    "https://example.test/?token=secret",
    "https://example.test/#token",
  ]) {
    assert.throws(() => productionOrigin(raw))
  }
  assert.equal(productionOrigin(`${ORIGIN}/`), ORIGIN)
})

test("Vercel SSO redirects are failures and are never followed", async (t) => {
  const { requests, result } = await fixture(t, (path, response) =>
    path === "/login"
      ? {
          status: 302,
          headers: { location: "https://vercel.com/sso-api?token=do-not-log" },
          body: "",
        }
      : response
  )
  assert.equal(result.ok, false)
  assert.equal(
    result.results.find((entry) => entry.path === "/login").ok,
    false
  )
  assert.equal(requests.length, 11)
  assert.ok(!JSON.stringify(result).includes("do-not-log"))
})

test("a successful-looking provider page or Next error page cannot substitute for login", async (t) => {
  for (const body of [
    '<title>Vercel Login</title><form><input type="email"></form>',
    `${LOGIN}<div id="__next_error__"></div>`,
  ]) {
    const { result } = await fixture(t, (path, response) =>
      path === "/login" ? { ...response, body } : response
    )
    assert.equal(result.ok, false)
  }
})

test("protected pages require a direct same-origin login redirect", async (t) => {
  const { result } = await fixture(t, (path, response) =>
    path === "/admin"
      ? {
          ...response,
          headers: {
            location: "https://identity.example.test/login?token=private",
          },
        }
      : response
  )
  assert.equal(result.ok, false)
  assert.equal(
    result.results.find((entry) => entry.path === "/admin").ok,
    false
  )
  assert.ok(!JSON.stringify(result).includes("token=private"))
})

test("private API cache regression fails even when access is denied", async (t) => {
  const { result } = await fixture(t, (path, response) =>
    path === "/api/library"
      ? {
          ...response,
          headers: {
            ...response.headers,
            "cache-control": "public, max-age=300",
          },
        }
      : response
  )
  assert.equal(result.ok, false)
  assert.equal(
    result.results.find((entry) => entry.path === "/api/library").ok,
    false
  )
})

test("a private API response containing a media page cannot pass as a denial", async (t) => {
  const { result } = await fixture(t, (path, response) =>
    path === "/api/portfolio"
      ? {
          ...response,
          body: JSON.stringify({
            ok: false,
            message: "Denied",
            page: { items: ["private-file"] },
          }),
        }
      : response
  )
  assert.equal(result.ok, false)
  assert.ok(!JSON.stringify(result).includes("private-file"))
})

test("media header and cleanup configuration failures are independently reported", async (t) => {
  const { result } = await fixture(t, (path, response) => {
    if (path.endsWith("/thumb"))
      return {
        ...response,
        headers: { ...response.headers, "x-content-type-options": "" },
      }
    if (path === "/api/internal/cleanup")
      return {
        ...response,
        status: 503,
        body: JSON.stringify({ error: "cleanup_not_configured" }),
      }
    return response
  })
  assert.equal(result.ok, false)
  assert.equal(result.results.filter((entry) => !entry.ok).length, 2)
})

test("soft-404 fallbacks fail and oversized/error responses do not leak body data", async (t) => {
  const { result } = await fixture(t, (path, response) => {
    if (path.startsWith("/nabalens-smoke-missing-"))
      return { ...response, status: 200 }
    if (path === "/api/library")
      return { ...response, body: "sensitive".repeat(140_000) }
    return response
  })
  assert.equal(result.ok, false)
  assert.equal(result.results.filter((entry) => !entry.ok).length, 2)
  assert.ok(!JSON.stringify(result).includes("sensitive"))
})

test("transport errors are redacted rather than exposing error-provided URLs", async () => {
  const result = await runProductionSmoke(ORIGIN, {
    fetchImpl: async () => {
      throw new Error("https://provider.test/?secret=private")
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.results.length, 11)
  assert.ok(!JSON.stringify(result).includes("secret=private"))
})
