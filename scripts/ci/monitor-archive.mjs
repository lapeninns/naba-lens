#!/usr/bin/env node
// Read-only archive freshness check for the existing local smoke monitor.
// The credential is read from macOS Keychain into memory, never command arguments,
// environment files or output. It is valid only on the archive status route.
import { execFile } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { productionOrigin, runProductionSmoke } from "./smoke-production.mjs"

export const ARCHIVE_MONITOR_ORIGIN = "https://naba-lens.vercel.app"
export const ARCHIVE_MONITOR_KEYCHAIN_SERVICE =
  "naba-lens-production-archive-monitor"
const MAX_AGE_MS = 26 * 60 * 60 * 1000
const MAX_BODY_BYTES = 16 * 1024
const TIMEOUT_MS = 15_000
const runFile = promisify(execFile)

class MonitorFailure extends Error {}

function assert(condition, message) {
  if (!condition) throw new MonitorFailure(message)
}

/** Pin before reading Keychain: --url overrides must never redirect a secret. */
export function archiveMonitorOrigin(rawOrigin) {
  let origin
  try {
    origin = productionOrigin(rawOrigin)
  } catch {
    throw new MonitorFailure("Supply the configured production HTTPS origin.")
  }
  assert(
    origin === ARCHIVE_MONITOR_ORIGIN,
    "Archive monitoring is restricted to its configured production origin."
  )
  return origin
}

export async function readMonitorSecret({ execFileImpl = runFile } = {}) {
  try {
    const { stdout } = await execFileImpl(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-s",
        ARCHIVE_MONITOR_KEYCHAIN_SERVICE,
        "-a",
        ARCHIVE_MONITOR_ORIGIN,
        "-w",
      ],
      { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 }
    )
    const secret = stdout.trim()
    assert(
      /^[A-Za-z0-9_-]{32,256}$/.test(secret),
      "The archive monitor credential is missing or invalid in Keychain."
    )
    return secret
  } catch {
    // execFile errors can include stdout/stderr, so never print the exception.
    throw new MonitorFailure(
      "The archive monitor credential is missing or unavailable in Keychain."
    )
  }
}

async function boundedJson(response) {
  const reader = response.body?.getReader()
  assert(reader, "Archive status returned no body.")
  let bytes = 0
  const chunks = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      assert(bytes <= MAX_BODY_BYTES, "Archive status exceeded its size limit.")
      chunks.push(value)
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"))
    } catch {
      throw new MonitorFailure("Archive status was not valid JSON.")
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}

/** Only the fixed status URL receives the narrow monitor credential. */
export async function runArchiveMonitor(
  rawOrigin,
  { fetchImpl = fetch, loadSecret = readMonitorSecret, now = Date.now } = {}
) {
  try {
    const origin = archiveMonitorOrigin(rawOrigin)
    const secret = await loadSecret()
    assert(
      typeof secret === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(secret),
      "The archive monitor credential is missing or invalid in Keychain."
    )
    const response = await fetchImpl(
      new URL("/api/internal/media-archive/status", origin),
      {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${secret}`,
          "user-agent": "Naba-Lens-read-only-archive-monitor/1",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )
    assert(
      response.status === 200,
      "Archive status is unavailable or unhealthy."
    )
    const cache = new Set(
      (response.headers.get("cache-control") ?? "")
        .toLowerCase()
        .split(",")
        .map((value) => value.trim())
    )
    assert(
      cache.has("private") && cache.has("no-store"),
      "Archive status lacks private, no-store protection."
    )
    assert(
      /^application\/json(?:\s*;|$)/i.test(
        response.headers.get("content-type") ?? ""
      ),
      "Archive status was not an application JSON response."
    )
    const report = await boundedJson(response)
    assert(
      report?.ok === true &&
        report.status === "current" &&
        report.missing === 0 &&
        report.failed === false &&
        typeof report.inProgress === "boolean",
      "Archive verification is incomplete, disabled or failed."
    )
    const complete = Date.parse(report.lastCompleteAt)
    const lastRun = Date.parse(report.lastRunAt)
    // A successful audit may finish while Keychain/network/body reads await.
    // Compare against validation time, not the request's earlier start time.
    const checkedAt = typeof now === "function" ? now() : now
    assert(
      typeof report.lastCompleteAt === "string" &&
        typeof report.lastRunAt === "string" &&
        Number.isFinite(complete) &&
        Number.isFinite(lastRun) &&
        Number.isFinite(checkedAt) &&
        complete <= checkedAt &&
        checkedAt - complete <= MAX_AGE_MS &&
        lastRun >= complete &&
        lastRun <= checkedAt,
      "Archive verification is stale or has invalid completion times."
    )
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof MonitorFailure
          ? error.message
          : "Archive status request failed or exceeded its timeout.",
    }
  }
}

/** Run all existing signed-out checks before the independent health check. */
export async function runMonitoredSmoke(rawOrigin, options = {}) {
  archiveMonitorOrigin(rawOrigin)
  const smoke = await (options.smokeImpl ?? runProductionSmoke)(rawOrigin)
  const archive = await runArchiveMonitor(rawOrigin, options)
  return { ok: smoke.ok && archive.ok, smoke, archive }
}

async function main() {
  const args = process.argv.slice(2)
  const withSmoke = args[0] === "--with-smoke"
  assert(
    args.length === (withSmoke ? 2 : 1),
    "Usage: node scripts/ci/monitor-archive.mjs [--with-smoke] https://naba-lens.vercel.app"
  )
  const origin = args[withSmoke ? 1 : 0]
  let archive
  let ok
  if (withSmoke) {
    const result = await runMonitoredSmoke(origin)
    for (const check of result.smoke.results) {
      console.log(
        `${check.ok ? "PASS" : "FAIL"} ${check.path}${check.message ? `: ${check.message}` : ""}`
      )
    }
    console.log(
      `Naba-Lens signed-out smoke: ${result.smoke.ok ? "PASS" : "FAIL"}`
    )
    archive = result.archive
    ok = result.ok
  } else {
    archive = await runArchiveMonitor(origin)
    ok = archive.ok
  }
  console.log(
    `Naba-Lens archive freshness: ${archive.ok ? "PASS" : "FAIL"}${archive.message ? `: ${archive.message}` : ""}`
  )
  process.exitCode = ok ? 0 : 1
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      "Naba-Lens archive monitor could not run with its configured origin."
    )
    process.exitCode = 1
  })
}
