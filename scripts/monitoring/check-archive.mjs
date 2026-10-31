#!/usr/bin/env node
// CLI for the independent archive checker. One run = one status read, alert
// reconciliation against the dedup state file, delivery, optional heartbeat.
//
// Exit codes: 0 healthy, 1 archive unhealthy (alerts delivered or already sent),
// 2 the checker, its alert delivery, state or heartbeat failed.
//
// Production: MEDIA_ARCHIVE_MONITOR_SECRET (or _FILE) + ARCHIVE_ALERT_SINK_URL (https).
// Local e2e:  --local --origin http://127.0.0.1:<port> --sink http://127.0.0.1:3650/alerts
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  CheckerConfigError,
  createHeartbeat,
  createHttpSink,
  buildAlert,
  resolveDestination,
  runCheck,
} from "./archive-checker.mjs"
import { DEFAULT_ALERTS_DIR, UNDELIVERED_FILE } from "./stub-alert-sink.mjs"

const VALUE_FLAGS = {
  "--origin": "origin",
  "--sink": "sink",
  "--digest-sink": "digestSink",
  "--sink-format": "sinkFormat",
  "--state": "state",
  "--alerts-dir": "alertsDir",
  "--heartbeat": "heartbeat",
}

export function fileStateStore(path) {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, "utf8"))
      } catch {
        return null
      }
    },
    async save(state) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temp = `${path}.${process.pid}.tmp`
      await writeFile(temp, JSON.stringify(state), { mode: 0o600 })
      await rename(temp, path)
    },
  }
}

export function jsonlFallback(dir) {
  return {
    async record(alert, reason) {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await appendFile(
        join(dir, UNDELIVERED_FILE),
        `${JSON.stringify({
          schema: "nabalens.archive-alert-undelivered/v1",
          failedAt: new Date().toISOString(),
          reason,
          alert,
        })}\n`,
        { mode: 0o600 }
      )
    },
  }
}

function parseArgs(argv, env) {
  const options = {
    mode: env.ARCHIVE_CHECKER_MODE === "local" ? "local" : "production",
    origin: env.ARCHIVE_CHECKER_ORIGIN,
    sink: env.ARCHIVE_ALERT_SINK_URL,
    digestSink: env.ARCHIVE_ALERT_DIGEST_SINK_URL,
    sinkFormat: env.ARCHIVE_ALERT_SINK_FORMAT ?? "json",
    state: env.ARCHIVE_CHECKER_STATE_FILE,
    alertsDir: env.ARCHIVE_CHECKER_ALERTS_DIR ?? DEFAULT_ALERTS_DIR,
    heartbeat: env.ARCHIVE_HEARTBEAT_URL,
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--local") options.mode = "local"
    else if (argv[i] in VALUE_FLAGS && argv[i + 1] !== undefined) {
      options[VALUE_FLAGS[argv[i]]] = argv[++i]
    } else throw new CheckerConfigError("usage", "Unrecognised arguments.")
  }
  if (!["json", "slack"].includes(options.sinkFormat)) {
    throw new CheckerConfigError("usage", "Unknown sink format.")
  }
  return options
}

function secretLoader(env) {
  return async () => {
    const inline = env.MEDIA_ARCHIVE_MONITOR_SECRET
    const file = env.MEDIA_ARCHIVE_MONITOR_SECRET_FILE
    if (inline && file) {
      throw new CheckerConfigError(
        "bad_secret",
        "Set one credential source only."
      )
    }
    if (file) {
      try {
        return (await readFile(file, "utf8")).trim()
      } catch {
        throw new CheckerConfigError(
          "bad_secret",
          "Credential file unreadable."
        )
      }
    }
    return inline?.trim()
  }
}

/** Returns the process exit code; all output goes through `log`/`logError`. */
export async function runCli(
  argv,
  {
    env = process.env,
    fetchImpl = fetch,
    now = Date.now,
    log = console.log,
    logError = console.error,
  } = {}
) {
  let options
  let sink
  let digestSink
  let heartbeat
  const fallbackDir = resolve(
    (argv.includes("--alerts-dir") && argv[argv.indexOf("--alerts-dir") + 1]) ||
      env.ARCHIVE_CHECKER_ALERTS_DIR ||
      DEFAULT_ALERTS_DIR
  )
  try {
    options = parseArgs(argv, env)
    const destination = options.sink
      ? resolveDestination(options.sink, {
          mode: options.mode,
          label: "alert sink",
        })
      : null
    if (!destination) {
      throw new CheckerConfigError(
        "bad_destination",
        "No alert sink is configured."
      )
    }
    sink = createHttpSink(destination, {
      fetchImpl,
      format: options.sinkFormat,
    })
    if (options.digestSink) {
      digestSink = createHttpSink(
        resolveDestination(options.digestSink, {
          mode: options.mode,
          label: "digest sink",
        }),
        { fetchImpl, format: options.sinkFormat }
      )
    }
    if (options.heartbeat) {
      heartbeat = createHeartbeat(
        resolveDestination(options.heartbeat, {
          mode: options.mode,
          label: "heartbeat",
        }),
        { fetchImpl }
      )
    }
  } catch (error) {
    // Without a usable sink nothing can be delivered: record locally and fail.
    const code =
      error instanceof CheckerConfigError ? error.code : "checker_error"
    try {
      await jsonlFallback(fallbackDir).record(
        buildAlert({
          condition: "monitor_error",
          severity: "critical",
          summary: `The archive checker could not run (${code})`,
          observedAt: new Date(
            typeof now === "function" ? now() : now
          ).toISOString(),
          target:
            env.ARCHIVE_CHECKER_MODE === "local" || argv.includes("--local")
              ? "local"
              : "production",
        }),
        code
      )
    } catch {
      // The console line below is the last resort.
    }
    logError(`Naba-Lens archive checker could not start (${code}).`)
    return 2
  }

  const stateFile = resolve(
    options.state ??
      join(options.alertsDir, `checker-state.${options.mode}.json`)
  )
  const result = await runCheck({
    mode: options.mode,
    origin: options.origin,
    loadSecret: secretLoader(env),
    env,
    fetchImpl,
    now,
    state: fileStateStore(stateFile),
    sink,
    digestSink,
    fallback: jsonlFallback(resolve(options.alertsDir)),
    heartbeat,
  })
  for (const alert of result.alerts) {
    log(
      `ALERT ${alert.condition} ${alert.severity} ${alert.delivered ? "delivered" : `NOT DELIVERED (${alert.reason})`}`
    )
  }
  if (result.errors.length > 0) {
    logError(`Naba-Lens archive checker ERROR: ${result.errors.join(", ")}`)
  } else if (result.conditions.length > 0) {
    log(`Naba-Lens archive checker UNHEALTHY: ${result.conditions.join(", ")}`)
  } else {
    log("Naba-Lens archive checker HEALTHY")
  }
  return result.exitCode
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    () => {
      console.error("Naba-Lens archive checker failed unexpectedly.")
      process.exitCode = 2
    }
  )
}
