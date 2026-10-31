#!/usr/bin/env node
// Local-only stub alert sink for the archive checker. Listens on 127.0.0.1
// (port 3650-3659 from the CLI) and appends every valid alert to a JSONL file.
// It never forwards anything: it is a stand-in for the owner's real destination.
// Usage: node scripts/monitoring/stub-alert-sink.mjs [--port 3650] [--dir /tmp/nabalens-ws/alerts]
import { appendFile, mkdir } from "node:fs/promises"
import { createServer } from "node:http"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const DEFAULT_SINK_PORT = 3650
export const DEFAULT_ALERTS_DIR = "/tmp/nabalens-ws/alerts"
export const ALERTS_FILE = "alerts.jsonl"
export const UNDELIVERED_FILE = "undelivered.jsonl"
const MAX_BODY_BYTES = 32 * 1024
const CONDITIONS = new Set([
  "stale",
  "missing_originals",
  "run_failed",
  "cycle_slow",
  "not_running",
  "unreachable",
  "auth_rejected",
  "monitor_error",
  "recovered",
])
const SEVERITIES = new Set(["critical", "warning", "info"])

export function validAlert(alert) {
  return (
    alert !== null &&
    typeof alert === "object" &&
    alert.schema === "nabalens.archive-alert/v1" &&
    typeof alert.alertId === "string" &&
    CONDITIONS.has(alert.condition) &&
    SEVERITIES.has(alert.severity) &&
    typeof alert.summary === "string" &&
    typeof alert.ownerAction === "string" &&
    typeof alert.observedAt === "string" &&
    typeof alert.target === "string"
  )
}

/**
 * `port: 0` picks an ephemeral port for tests. The CLI restricts the port to
 * the 3650-3659 block reserved for this workstream.
 */
export async function startStubSink({
  port = DEFAULT_SINK_PORT,
  dir = DEFAULT_ALERTS_DIR,
} = {}) {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, ALERTS_FILE)
  let received = 0
  const server = createServer((request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" })
      response.end(JSON.stringify(body))
    }
    if (request.method === "GET" && request.url === "/health") {
      return reply(200, { ok: true, received })
    }
    if (request.method !== "POST" || request.url !== "/alerts") {
      return reply(404, { error: "not_found" })
    }
    const chunks = []
    let bytes = 0
    let tooLarge = false
    request.on("data", (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) tooLarge = true
      else chunks.push(chunk)
    })
    request.on("end", async () => {
      if (tooLarge) return reply(413, { error: "too_large" })
      let alert
      try {
        alert = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      } catch {
        return reply(400, { error: "invalid_json" })
      }
      if (!validAlert(alert)) return reply(422, { error: "invalid_alert" })
      try {
        await appendFile(
          file,
          `${JSON.stringify({ receivedAt: new Date().toISOString(), alert })}\n`,
          { mode: 0o600 }
        )
      } catch {
        return reply(500, { error: "write_failed" })
      }
      received++
      return reply(202, { ok: true })
    })
  })
  await new Promise((resolveListen, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", resolveListen)
  })
  const boundPort = server.address().port
  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}/alerts`,
    file,
    close: () =>
      new Promise((resolveClose) => {
        server.closeAllConnections?.()
        server.close(resolveClose)
      }),
  }
}

function parseArgs(argv) {
  const options = { port: DEFAULT_SINK_PORT, dir: DEFAULT_ALERTS_DIR }
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === "--port") options.port = Number(argv[i + 1])
    else if (argv[i] === "--dir") options.dir = argv[i + 1]
    else throw new Error("usage")
  }
  if (
    !Number.isInteger(options.port) ||
    options.port < 3650 ||
    options.port > 3659
  ) {
    throw new Error("The stub sink port must be in 3650-3659.")
  }
  if (!options.dir) throw new Error("usage")
  return options
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const sink = await startStubSink(parseArgs(process.argv.slice(2)))
    console.log(
      `Stub alert sink listening on ${sink.url}, writing ${sink.file}`
    )
    const stop = () => sink.close().then(() => process.exit(0))
    process.on("SIGINT", stop)
    process.on("SIGTERM", stop)
  } catch (error) {
    console.error(
      error instanceof Error && error.message.startsWith("The stub sink")
        ? error.message
        : "Usage: node scripts/monitoring/stub-alert-sink.mjs [--port 3650-3659] [--dir DIR]"
    )
    process.exitCode = 1
  }
}
