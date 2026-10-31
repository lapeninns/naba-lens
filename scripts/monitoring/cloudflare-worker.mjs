// Cloudflare Worker entry for the primary always-on checker (cron trigger).
// Primary delivery: ARCHIVE_ALERT_EMAIL (send_email binding restricted to owner)
// and ALERT_EMAIL_FROM (confirmed sender), or legacy ALERT_SINK_URL (HTTPS).
// CHECKER_STATE is the only storage binding. MEDIA_ARCHIVE_MONITOR_SECRET reads
// archive status; distinct ARCHIVE_MONITOR_HEARTBEAT_SECRET posts only to the
// fixed Vercel watchdog endpoint. Optional legacy HTTPS sink/digest/heartbeat
// configuration remains supported. No cleanup, cron, Supabase or R2 credentials.
import {
  CheckerFailure,
  PRODUCTION_ORIGIN,
  SECRET_PATTERN,
  createHeartbeat,
  createHttpSink,
  resolveDestination,
  runCheck,
} from "./archive-checker.mjs"

const STATE_KEY = "state:production"
const UNDELIVERED_PREFIX = "undelivered:"
const UNDELIVERED_TTL_SECONDS = 30 * 24 * 60 * 60

export function kvStateStore(kv) {
  return {
    load: async () => (await kv.get(STATE_KEY, "json")) ?? null,
    save: (state) => kv.put(STATE_KEY, JSON.stringify(state)),
  }
}

export const ALERT_EMAIL_RECIPIENT = "amanshresthaaaaa@gmail.com"
export const WATCHDOG_HEARTBEAT_URL = `${PRODUCTION_ORIGIN}/api/internal/archive-monitor/heartbeat`

/** Provider binding must also restrict destination_address to this recipient. */
export function createEmailSink(binding, from, { timeoutMs = 10_000 } = {}) {
  if (
    typeof binding?.send !== "function" ||
    typeof from !== "string" ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(
      from
    )
  ) {
    throw new CheckerFailure("email_binding_invalid")
  }
  return {
    async deliver(alert) {
      let timer
      try {
        await Promise.race([
          binding.send({
            from,
            to: ALERT_EMAIL_RECIPIENT,
            subject: `[Naba-Lens ${alert.severity}] ${alert.condition}`,
            text: `${alert.summary}\n\n${alert.ownerAction}\n\nObserved: ${alert.observedAt}\nEvent: ${alert.alertId}`,
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new CheckerFailure("email_timeout")),
              timeoutMs
            )
          }),
        ])
      } catch (error) {
        throw new CheckerFailure(
          error?.code === "email_timeout"
            ? "email_timeout"
            : "email_delivery_failed"
        )
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

function workerHeartbeat(env, fetchImpl) {
  if (env.ARCHIVE_MONITOR_HEARTBEAT_SECRET !== undefined) {
    if (
      !SECRET_PATTERN.test(env.ARCHIVE_MONITOR_HEARTBEAT_SECRET) ||
      env.ARCHIVE_MONITOR_HEARTBEAT_SECRET ===
        env.MEDIA_ARCHIVE_MONITOR_SECRET ||
      (env.HEARTBEAT_URL !== undefined &&
        env.HEARTBEAT_URL !== WATCHDOG_HEARTBEAT_URL)
    ) {
      throw new CheckerFailure("heartbeat_configuration_invalid")
    }
    return createHeartbeat(WATCHDOG_HEARTBEAT_URL, {
      fetchImpl,
      bearer: env.ARCHIVE_MONITOR_HEARTBEAT_SECRET,
    })
  }
  return env.HEARTBEAT_URL
    ? createHeartbeat(
        resolveDestination(env.HEARTBEAT_URL, {
          mode: "production",
          label: "heartbeat",
        }),
        { fetchImpl }
      )
    : undefined
}

export async function runScheduled(
  env,
  { fetchImpl = fetch, now = Date.now } = {}
) {
  const sink = env.ARCHIVE_ALERT_EMAIL
    ? createEmailSink(env.ARCHIVE_ALERT_EMAIL, env.ALERT_EMAIL_FROM)
    : createHttpSink(
        resolveDestination(env.ALERT_SINK_URL, {
          mode: "production",
          label: "alert sink",
        }),
        { fetchImpl, format: env.ALERT_SINK_FORMAT ?? "json" }
      )
  const digestSink = env.DIGEST_SINK_URL
    ? createHttpSink(
        resolveDestination(env.DIGEST_SINK_URL, {
          mode: "production",
          label: "digest sink",
        }),
        { fetchImpl, format: env.ALERT_SINK_FORMAT ?? "json" }
      )
    : undefined
  const result = await runCheck({
    mode: "production",
    loadSecret: async () => env.MEDIA_ARCHIVE_MONITOR_SECRET,
    env,
    fetchImpl,
    now,
    state: kvStateStore(env.CHECKER_STATE),
    sink,
    digestSink,
    fallback: {
      record: (alert, reason) =>
        env.CHECKER_STATE.put(
          `${UNDELIVERED_PREFIX}${alert.alertId}`,
          JSON.stringify({ reason, alert }),
          { expirationTtl: UNDELIVERED_TTL_SECONDS }
        ),
    },
    heartbeat: workerHeartbeat(env, fetchImpl),
  })
  // A failed run must show as a failed invocation in Workers logs and metrics.
  if (result.errors.length > 0) {
    throw new CheckerFailure(result.errors.join(","))
  }
  return result
}

const worker = {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduled(env))
  },
}

export default worker
