// Cloudflare Worker entry for the primary always-on checker (cron trigger).
// Bindings: MEDIA_ARCHIVE_MONITOR_SECRET (secret), ALERT_SINK_URL (secret, https),
// optional DIGEST_SINK_URL (secret, https, non-paging alerts), HEARTBEAT_URL (secret) and ALERT_SINK_FORMAT ("json" | "slack"),
// CHECKER_STATE (KV namespace). Nothing else may be bound: assertNarrowEnvironment
// rejects the cleanup/cron/service-role credentials by name.
import {
  CheckerFailure,
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

export async function runScheduled(
  env,
  { fetchImpl = fetch, now = Date.now } = {}
) {
  const sink = createHttpSink(
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
    heartbeat: env.HEARTBEAT_URL
      ? createHeartbeat(
          resolveDestination(env.HEARTBEAT_URL, {
            mode: "production",
            label: "heartbeat",
          }),
          { fetchImpl }
        )
      : undefined,
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
