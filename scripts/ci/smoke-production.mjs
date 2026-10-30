#!/usr/bin/env node
// Read-only, signed-out availability/access smoke. Never sends application
// credentials, follows redirects, submits a login form, or authorises internal jobs.
// Usage: node scripts/ci/smoke-production.mjs https://your-production-origin
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const MAX_BODY_BYTES = 1024 * 1024
const TIMEOUT_MS = 15_000
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const SYNTHETIC_ASSET_ID = "00000000-0000-4000-8000-000000000000"

class SmokeFailure extends Error {}

function assert(condition, message) {
  if (!condition) throw new SmokeFailure(message)
}

export function productionOrigin(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new SmokeFailure(
      "Provide a production HTTPS origin as the only argument."
    )
  }
  assert(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash,
    "Target must be an HTTPS origin without credentials, a path, query or fragment."
  )
  return url.origin
}

async function boundedBody(response) {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      assert(
        length <= MAX_BODY_BYTES,
        "Response body exceeded the smoke limit."
      )
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString("utf8")
}

function noStore(
  response,
  { privateResponse = false, privateCache = privateResponse } = {}
) {
  const directives = new Set(
    (response.headers.get("cache-control") ?? "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim())
  )
  assert(directives.has("no-store"), "Missing no-store cache protection.")
  if (privateCache) {
    assert(directives.has("private"), "Missing private cache protection.")
  }
  if (privateResponse) {
    assert(
      response.headers.get("x-content-type-options")?.toLowerCase() ===
        "nosniff",
      "Missing nosniff header."
    )
    assert(
      response.headers.get("referrer-policy")?.toLowerCase() === "no-referrer",
      "Missing no-referrer header."
    )
  }
}

function jsonBody(response, body) {
  assert(
    /^application\/json(?:\s*;|$)/i.test(
      response.headers.get("content-type") ?? ""
    ),
    "Expected an application JSON response."
  )
  try {
    return JSON.parse(body)
  } catch {
    throw new SmokeFailure("Response was not valid JSON.")
  }
}

/** fetchImpl is injectable for fixture-server tests; target validation is always on. */
export async function runProductionSmoke(
  rawOrigin,
  { fetchImpl = fetch } = {}
) {
  const origin = productionOrigin(rawOrigin)
  const results = []
  async function check(path, inspect) {
    try {
      const response = await fetchImpl(new URL(path, origin), {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        headers: {
          accept: "text/html, application/json, text/plain",
          "user-agent": "Naba-Lens-read-only-production-smoke/1",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      // Read within the same timeout/size bound. Bodies and headers are never
      // logged: a broken access boundary could otherwise disclose private data.
      const body = await boundedBody(response)
      inspect(response, body)
      results.push({ path, ok: true })
    } catch (error) {
      // Only our fixed assertion messages are printable. Network errors may
      // contain redirect URLs or provider data, so keep them out of the output.
      const message =
        error instanceof SmokeFailure
          ? error.message
          : "Request failed or exceeded its timeout."
      results.push({ path, ok: false, message })
    }
  }

  await check("/login", (response, body) => {
    assert(
      response.status === 200,
      "Expected the application login page (HTTP 200)."
    )
    assert(
      /^text\/html(?:\s*;|$)/i.test(response.headers.get("content-type") ?? ""),
      "Login page was not HTML."
    )
    assert(
      /<title>\s*Sign in\s*[·&].*Naba-Lens\s*<\/title>/i.test(body) &&
        /<form\b/i.test(body) &&
        /<input\b[^>]*\btype=["']email["']/i.test(body) &&
        /Send sign-in link/.test(body) &&
        !/id=["']__next_error__["']|NEXT_HTTP_ERROR_FALLBACK|Application error:/i.test(
          body
        ),
      "Expected the Naba-Lens sign-in form; a provider login or error page is not success."
    )
  })

  for (const path of ["/", "/admin", "/admin/menus", "/staff"]) {
    await check(path, (response) => {
      assert(
        REDIRECTS.has(response.status),
        "Signed-out page did not redirect to login."
      )
      const location = response.headers.get("location")
      assert(location, "Login redirect has no Location header.")
      let target
      try {
        target = new URL(location, origin)
      } catch {
        throw new SmokeFailure("Login redirect has an invalid Location header.")
      }
      assert(
        target.origin === origin &&
          target.pathname === "/login" &&
          !target.search &&
          !target.hash &&
          !target.username &&
          !target.password,
        "Expected a direct same-origin /login redirect; external authentication is not app success."
      )
    })
  }

  for (const path of ["/api/library", "/api/portfolio"]) {
    await check(path, (response, body) => {
      assert(
        response.status === 401,
        "Private API did not deny the signed-out request (HTTP 401)."
      )
      noStore(response, { privateResponse: true })
      const value = jsonBody(response, body)
      assert(
        value?.ok === false &&
          typeof value.message === "string" &&
          !Object.hasOwn(value, "page") &&
          !Object.hasOwn(value, "items"),
        "Private API did not return the expected denial shape."
      )
    })
  }

  for (const kind of ["thumb", "download"]) {
    await check(
      `/api/media/${SYNTHETIC_ASSET_ID}/${kind}`,
      (response, body) => {
        assert(
          response.status === 401,
          "Private media did not deny the signed-out request (HTTP 401)."
        )
        noStore(response, { privateResponse: true })
        assert(
          /^text\/plain(?:\s*;|$)/i.test(
            response.headers.get("content-type") ?? ""
          ) && body === "Sign in to continue.",
          "Private media did not return the expected application denial."
        )
      }
    )
  }

  await check("/api/internal/cleanup", (response, body) => {
    assert(
      response.status === 401,
      "Cleanup must be configured and reject an unauthorised request (HTTP 401)."
    )
    noStore(response)
    assert(
      jsonBody(response, body)?.error === "unauthorized",
      "Unexpected cleanup denial."
    )
  })

  for (const path of [
    "/api/internal/media-archive",
    "/api/internal/media-archive/status",
  ]) {
    await check(path, (response, body) => {
      assert(
        response.status === 401,
        "Archive endpoint must be configured and reject an unauthorised request (HTTP 401)."
      )
      noStore(response, { privateCache: true })
      assert(
        jsonBody(response, body)?.error === "unauthorized",
        "Unexpected archive denial."
      )
    })
  }

  await check(`/nabalens-smoke-missing-${randomUUID()}`, (response) => {
    assert(response.status === 404, "Unknown route did not return HTTP 404.")
  })

  return { origin, ok: results.every((result) => result.ok), results }
}

async function main() {
  assert(
    process.argv.length === 3,
    "Usage: node scripts/ci/smoke-production.mjs https://production-origin"
  )
  const result = await runProductionSmoke(process.argv[2])
  for (const check of result.results) {
    console.log(
      `${check.ok ? "PASS" : "FAIL"} ${check.path}${check.message ? `: ${check.message}` : ""}`
    )
  }
  console.log(
    `Naba-Lens signed-out smoke: ${result.ok ? "PASS" : "FAIL"} (${result.results.filter((check) => check.ok).length}/${result.results.length})`
  )
  process.exitCode = result.ok ? 0 : 1
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      "Naba-Lens smoke could not run. Supply one production HTTPS origin without credentials, a path, query or fragment."
    )
    process.exitCode = 1
  })
}
