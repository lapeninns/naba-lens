// Portable archive freshness checker: evaluates the status body from
// GET /api/internal/media-archive/status against the contract 4.6 conditions,
// deduplicates alerts by condition and delivers them to an injected sink.
// Uses only web-standard APIs (fetch, AbortSignal, TextDecoder, crypto) so the
// same module runs in Node, a Cloudflare Worker or GitHub Actions.
// The monitor credential is sent only to the pinned status URL. A separate
// optional heartbeat credential authenticates the independent watchdog.

export const ARCHIVE_ALERT_SCHEMA = "nabalens.archive-alert/v1"
export const PRODUCTION_ORIGIN = "https://naba-lens.vercel.app"
export const STATUS_PATH = "/api/internal/media-archive/status"
export const DOCS_PATH = "docs/archive-monitoring.md"
// The 26-hour threshold is a ceiling: a status body may tighten it but can
// never widen it.
export const MAX_AGE_SECONDS = 93_600
export const MAX_SCHEDULE_INTERVAL_SECONDS = 86_400
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{32,256}$/
export const MAX_BODY_BYTES = 16 * 1024
export const STATUS_TIMEOUT_MS = 15_000
export const SINK_TIMEOUT_MS = 10_000
const CLOCK_SKEW_MS = 5 * 60 * 1000
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"])
// Credentials that must never be present where the checker runs.
export const FORBIDDEN_ENV_NAMES = [
  "CLEANUP_SECRET",
  "CRON_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
]
// Outcomes never raise or suppress a condition on their own: health comes from
// the explicit flags and timestamps. `idle` (no open cycle, throttle not elapsed)
// still updates lastRunAt, so it must not trip not_running. An outcome this
// checker does not know yet is passed through only if it is a plain code.
const OUTCOME_PATTERN = /^[a-z_]{1,32}$/
export const SLOW_CYCLE_SECONDS = 72_000
// Conditions routed to the digest sink instead of the paging sink.
export const NON_PAGING_CONDITIONS = new Set(["cycle_slow"])
const PROBE_CONDITIONS = new Set([
  "unreachable",
  "auth_rejected",
  "monitor_error",
])
const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 }

export const CONDITION_ACTIONS = {
  stale: "Check the media-archive cron logs and lastRunOutcome",
  missing_originals:
    "Do not delete media; run a verification pass and restore the missing copies",
  run_failed: "Read lastError and the media-archive cron logs",
  cycle_slow:
    "Review archive capacity: cycles are approaching the 24 hour target",
  not_running:
    "Confirm the media-archive Vercel cron is enabled and its secret matches",
  unreachable: "Check the Vercel deployment and the status route",
  auth_rejected:
    "Re-provision MEDIA_ARCHIVE_MONITOR_SECRET on the app and on the checker",
  monitor_error: "Fix the checker configuration or credential",
  recovered: "No action needed; confirm the archive stays healthy",
}

export class CheckerFailure extends Error {
  constructor(code, message) {
    super(message ?? code)
    this.code = code
  }
}

export class CheckerConfigError extends CheckerFailure {}

function ownerAction(condition) {
  return `${CONDITION_ACTIONS[condition]}; see ${DOCS_PATH}#${condition}`
}

function parseOrigin(raw, { loopback }) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new CheckerConfigError("bad_origin", "The status origin is invalid.")
  }
  const schemeOk = loopback
    ? url.protocol === "http:" || url.protocol === "https:"
    : url.protocol === "https:"
  if (
    !schemeOk ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new CheckerConfigError(
      "bad_origin",
      "The status origin must be a bare origin without credentials."
    )
  }
  return url
}

/**
 * Production mode pins the origin before any secret is read. Local mode is an
 * explicit opt-in that accepts loopback origins only, so it can never aim the
 * credential at a remote host.
 */
export function resolveOrigin({ mode = "production", origin } = {}) {
  if (mode === "production") {
    const url = parseOrigin(origin ?? PRODUCTION_ORIGIN, { loopback: false })
    if (url.origin !== PRODUCTION_ORIGIN) {
      throw new CheckerConfigError(
        "origin_not_pinned",
        "Production checks are restricted to the configured production origin."
      )
    }
    return url.origin
  }
  if (mode === "local") {
    if (!origin) {
      throw new CheckerConfigError("bad_origin", "Local mode needs an origin.")
    }
    const url = parseOrigin(origin, { loopback: true })
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new CheckerConfigError(
        "origin_not_loopback",
        "Local mode accepts loopback origins only."
      )
    }
    return url.origin
  }
  throw new CheckerConfigError("bad_mode", "Mode must be production or local.")
}

/** Alert and heartbeat destinations: https in production, loopback in local mode. */
export function resolveDestination(raw, { mode, label }) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new CheckerConfigError(
      "bad_destination",
      `The ${label} URL is invalid.`
    )
  }
  const ok =
    !url.username &&
    !url.password &&
    !url.hash &&
    (mode === "local"
      ? (url.protocol === "http:" || url.protocol === "https:") &&
        LOOPBACK_HOSTS.has(url.hostname)
      : url.protocol === "https:")
  if (!ok) {
    throw new CheckerConfigError(
      "bad_destination",
      mode === "local"
        ? `The ${label} URL must be a loopback URL in local mode.`
        : `The ${label} URL must be https without credentials.`
    )
  }
  return url
}

/** Refuse to run anywhere that also holds the powerful cleanup/cron/service credentials. */
export function assertNarrowEnvironment(env, secret) {
  for (const name of FORBIDDEN_ENV_NAMES) {
    const value = env?.[name]
    if (value !== undefined && value !== "") {
      throw new CheckerConfigError(
        "broad_credential",
        "The checker environment holds credentials broader than the monitor secret."
      )
    }
  }
  if (typeof secret !== "string" || !SECRET_PATTERN.test(secret)) {
    throw new CheckerConfigError(
      "bad_secret",
      "The monitor credential is missing or invalid."
    )
  }
}

async function readBoundedText(response) {
  const reader = response.body?.getReader()
  if (!reader) throw new CheckerFailure("no_body")
  const chunks = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) throw new CheckerFailure("oversized_body")
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  const all = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    all.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(all)
}

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const isCount = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
const isPositive = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
const isTime = (value) =>
  value === null ||
  (typeof value === "string" && Number.isFinite(Date.parse(value)))

/**
 * Validates the 4.5 body and returns only the whitelisted fields. Additive
 * fields may be absent (older route) but are rejected when present and malformed.
 * lastError and lastRunOutcome are echoed only if they look like known codes.
 */
export function normalizeStatus(body) {
  if (
    !isObject(body) ||
    typeof body.ok !== "boolean" ||
    !["current", "stale", "disabled"].includes(body.status)
  ) {
    return null
  }
  if (body.status === "disabled") return { ok: body.ok, status: "disabled" }
  if (
    !isCount(body.missing) ||
    typeof body.failed !== "boolean" ||
    typeof body.inProgress !== "boolean" ||
    body.lastCompleteAt === undefined ||
    body.lastRunAt === undefined ||
    !isTime(body.lastCompleteAt) ||
    !isTime(body.lastRunAt)
  ) {
    return null
  }
  const status = {
    ok: body.ok,
    status: body.status,
    missing: body.missing,
    lastCompleteAt: body.lastCompleteAt,
    lastRunAt: body.lastRunAt,
    failed: body.failed,
    inProgress: body.inProgress,
  }
  const optional = [
    ["consecutiveFailures", isCount],
    ["cycleStartedAt", isTime],
    ["lastCycleDurationSeconds", (v) => v === null || isCount(v)],
    ["maxAgeSeconds", isPositive],
    ["scheduleIntervalSeconds", isPositive],
    [
      "cycleProgress",
      (v) =>
        v === null || (isObject(v) && isCount(v.checked) && isCount(v.target)),
    ],
    [
      "lastError",
      (v) => v === null || (typeof v === "string" && /^[a-z_]{1,64}$/.test(v)),
    ],
    [
      "lastRunOutcome",
      (v) => v === null || (typeof v === "string" && OUTCOME_PATTERN.test(v)),
    ],
  ]
  for (const [name, valid] of optional) {
    if (body[name] === undefined) continue
    if (!valid(body[name])) return null
    status[name] =
      name === "cycleProgress" && body[name]
        ? { checked: body[name].checked, target: body[name].target }
        : body[name]
  }
  return status
}

/** Pure evaluation of contract 4.6 against a normalized status. */
export function evaluateStatus(status, nowMs) {
  const found = new Map()
  const raise = (condition, severity, summary) =>
    found.set(condition, { severity, summary })

  if (status.status === "disabled") {
    raise("stale", "critical", "Archive verification is disabled")
    return found
  }
  const maxAgeMs =
    Math.min(status.maxAgeSeconds ?? MAX_AGE_SECONDS, MAX_AGE_SECONDS) * 1000
  const completeMs = status.lastCompleteAt
    ? Date.parse(status.lastCompleteAt)
    : NaN
  if (!Number.isFinite(completeMs)) {
    raise("stale", "critical", "Archive verification has never completed")
  } else if (completeMs > nowMs + CLOCK_SKEW_MS) {
    raise(
      "stale",
      "critical",
      "Archive verification reports a completion time in the future"
    )
  } else if (nowMs - completeMs > maxAgeMs) {
    const hours = Math.floor((nowMs - completeMs) / 3_600_000)
    raise(
      "stale",
      "critical",
      `Archive verification has not completed for ${hours} hours`
    )
  } else if (status.status === "stale") {
    raise("stale", "critical", "Archive status reports stale verification")
  }

  if (status.missing > 0) {
    raise(
      "missing_originals",
      "critical",
      `${status.missing} ready original${status.missing === 1 ? " has" : "s have"} no verified archive copy`
    )
  }

  const failures = status.consecutiveFailures ?? 0
  if (status.failed || failures >= 1) {
    const code = status.lastError ? ` (${status.lastError})` : ""
    raise(
      "run_failed",
      failures >= 3 ? "critical" : "warning",
      `The last archive run failed${code}; ${failures} consecutive failure${failures === 1 ? "" : "s"}`
    )
  }

  if (
    status.lastCycleDurationSeconds !== undefined &&
    status.lastCycleDurationSeconds !== null &&
    status.lastCycleDurationSeconds > SLOW_CYCLE_SECONDS
  ) {
    const hours = (status.lastCycleDurationSeconds / 3600).toFixed(1)
    raise(
      "cycle_slow",
      "warning",
      `The last archive cycle took ${hours} hours (limit ${SLOW_CYCLE_SECONDS / 3600})`
    )
  }

  if (status.scheduleIntervalSeconds !== undefined) {
    const interval = Math.min(
      status.scheduleIntervalSeconds,
      MAX_SCHEDULE_INTERVAL_SECONDS
    )
    const lastRunMs = status.lastRunAt ? Date.parse(status.lastRunAt) : NaN
    if (!Number.isFinite(lastRunMs)) {
      raise("not_running", "critical", "The archive job has never run")
    } else if (nowMs - lastRunMs > 3 * interval * 1000) {
      const minutes = Math.floor((nowMs - lastRunMs) / 60_000)
      raise(
        "not_running",
        "critical",
        `The archive job has not run for ${minutes} minutes`
      )
    }
  }
  if (found.size === 0 && status.ok !== true) {
    raise("stale", "critical", "Archive status is not healthy")
  }
  return found
}

function probeFailure(condition, reason) {
  return { kind: "probe_failure", condition, reason }
}

/** One GET to the fixed status URL. Never follows redirects or reflects the response. */
export async function probeStatus({
  origin,
  secret,
  fetchImpl = fetch,
  timeoutMs = STATUS_TIMEOUT_MS,
}) {
  let response
  try {
    response = await fetchImpl(new URL(STATUS_PATH, origin), {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${secret}`,
        "user-agent": "Naba-Lens-archive-checker/1",
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const timedOut =
      error?.name === "TimeoutError" || error?.name === "AbortError"
    return probeFailure("unreachable", timedOut ? "timeout" : "network_error")
  }
  const discard = () => response.body?.cancel().catch(() => {})
  if (response.status === 401 || response.status === 403) {
    await discard()
    return probeFailure("auth_rejected", `http_${response.status}`)
  }
  if (
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 400)
  ) {
    await discard()
    return probeFailure("unreachable", "redirect")
  }
  if (response.status !== 200 && response.status !== 503) {
    await discard()
    return probeFailure("unreachable", `http_${response.status}`)
  }
  const cache = new Set(
    (response.headers.get("cache-control") ?? "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim())
  )
  if (
    !cache.has("private") ||
    !cache.has("no-store") ||
    !/^application\/json(?:\s*;|$)/i.test(
      response.headers.get("content-type") ?? ""
    )
  ) {
    await discard()
    return probeFailure("unreachable", "bad_headers")
  }
  let body
  try {
    body = JSON.parse(await readBoundedText(response))
  } catch (error) {
    return probeFailure(
      "unreachable",
      error?.code === "oversized_body" ? "oversized_body" : "invalid_body"
    )
  }
  const status = normalizeStatus(body)
  if (!status) return probeFailure("unreachable", "invalid_body")
  return { kind: "status", status }
}

export function buildAlert({
  condition,
  severity,
  summary,
  observedAt,
  target,
  status = null,
  recoveredCondition,
  newId = () => crypto.randomUUID(),
}) {
  const alert = {
    schema: ARCHIVE_ALERT_SCHEMA,
    alertId: newId(),
    condition,
    severity,
    summary,
    ownerAction: ownerAction(condition),
    observedAt,
    target,
    status,
  }
  if (recoveredCondition) alert.recoveredCondition = recoveredCondition
  return alert
}

function emptyState() {
  return { version: 1, active: {}, pending: [] }
}

function applyDelivery(active, { kind, condition, alert }) {
  if (kind === "recover") delete active[condition]
  else {
    active[condition] = {
      severity: alert.severity,
      alertId: alert.alertId,
      since: active[condition]?.since ?? alert.observedAt,
    }
  }
}

function sanitizeState(raw) {
  if (raw == null) return emptyState()
  if (
    !isObject(raw) ||
    raw.version !== 1 ||
    !isObject(raw.active) ||
    (Object.hasOwn(raw, "pending") && !Array.isArray(raw.pending))
  ) {
    throw new CheckerFailure("state_invalid")
  }
  const active = {}
  for (const [condition, entry] of Object.entries(raw.active)) {
    if (
      !Object.hasOwn(CONDITION_ACTIONS, condition) ||
      condition === "recovered" ||
      !isObject(entry) ||
      !Object.hasOwn(SEVERITY_RANK, entry.severity) ||
      !(entry.alertId === null || typeof entry.alertId === "string") ||
      !(
        entry.since === null ||
        (typeof entry.since === "string" && isTime(entry.since))
      )
    ) {
      throw new CheckerFailure("state_invalid")
    }
    active[condition] = {
      severity: entry.severity,
      alertId: entry.alertId,
      since: entry.since,
    }
  }
  // Older version-1 state has no outbox. Keep payloads and ids across retries,
  // while allowing only the same fields the checker can produce itself.
  const pending = []
  for (const item of raw.pending ?? []) {
    const alert = item?.alert
    if (
      !isObject(item) ||
      !["raise", "escalate", "recover"].includes(item.kind) ||
      (Object.hasOwn(item, "fallbackRecorded") &&
        typeof item.fallbackRecorded !== "boolean") ||
      !Object.hasOwn(CONDITION_ACTIONS, item.condition) ||
      item.condition === "recovered" ||
      !isObject(alert) ||
      alert.schema !== ARCHIVE_ALERT_SCHEMA ||
      alert.condition !==
        (item.kind === "recover" ? "recovered" : item.condition) ||
      (item.kind === "recover" &&
        alert.recoveredCondition !== item.condition) ||
      !Object.hasOwn(SEVERITY_RANK, alert.severity) ||
      typeof alert.alertId !== "string" ||
      typeof alert.summary !== "string" ||
      typeof alert.observedAt !== "string" ||
      !isTime(alert.observedAt) ||
      !["production", "local"].includes(alert.target)
    ) {
      throw new CheckerFailure("state_invalid")
    }
    const status = alert.status === null ? null : normalizeStatus(alert.status)
    if (alert.status !== null && !status)
      throw new CheckerFailure("state_invalid")
    pending.push({
      kind: item.kind,
      condition: item.condition,
      ...(item.fallbackRecorded === true ? { fallbackRecorded: true } : {}),
      alert: buildAlert({
        condition: alert.condition,
        severity: alert.severity,
        summary: alert.summary,
        observedAt: alert.observedAt,
        target: alert.target,
        status,
        recoveredCondition:
          item.kind === "recover" ? item.condition : undefined,
        newId: () => alert.alertId,
      }),
    })
  }
  return { version: 1, active, pending }
}

export function memoryStateStore(initial) {
  let state = initial ?? emptyState()
  return {
    load: async () => structuredClone(state),
    save: async (next) => {
      state = structuredClone(next)
    },
  }
}

/** HTTP sink client. `format: "slack"` posts {text}; default posts the alert JSON. */
export function createHttpSink(
  url,
  { fetchImpl = fetch, timeoutMs = SINK_TIMEOUT_MS, format = "json" } = {}
) {
  return {
    async deliver(alert) {
      const payload =
        format === "slack"
          ? {
              text: `[${alert.severity.toUpperCase()}] ${alert.summary}. ${alert.ownerAction}`,
            }
          : alert
      let response
      try {
        response = await fetchImpl(url, {
          method: "POST",
          redirect: "manual",
          credentials: "omit",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        const timedOut =
          error?.name === "TimeoutError" || error?.name === "AbortError"
        throw new CheckerFailure(
          timedOut ? "sink_timeout" : "sink_network_error"
        )
      }
      await response.body?.cancel().catch(() => {})
      if (response.status < 200 || response.status >= 300) {
        throw new CheckerFailure(
          response.status >= 300 && response.status < 400
            ? "sink_redirect"
            : `sink_status_${response.status}`
        )
      }
    },
  }
}

export function createHeartbeat(
  url,
  { fetchImpl = fetch, timeoutMs = SINK_TIMEOUT_MS, bearer } = {}
) {
  if (bearer !== undefined && !SECRET_PATTERN.test(bearer)) {
    throw new CheckerFailure("heartbeat_secret_invalid")
  }
  return async () => {
    try {
      const response = await fetchImpl(url, {
        method: bearer === undefined ? "GET" : "POST",
        redirect: "manual",
        credentials: "omit",
        ...(bearer === undefined
          ? {}
          : { headers: { authorization: `Bearer ${bearer}` } }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      await response.body?.cancel().catch(() => {})
      return response.status >= 200 && response.status < 300
        ? { sent: true }
        : { sent: false, reason: `heartbeat_status_${response.status}` }
    } catch {
      return { sent: false, reason: "heartbeat_network_error" }
    }
  }
}

/**
 * One check cycle. Alerts fire once per condition until it clears, escalate
 * once when severity rises, and a `recovered` alert follows when it clears.
 * Delivered state advances only after delivery. A durable outbox retains failed
 * deliveries even after their condition clears and preserves transition order.
 * Probe failures leave data conditions
 * (stale, missing_originals, ...) untouched because they say nothing about them.
 */
export async function runCheck({
  mode = "production",
  origin,
  loadSecret,
  env = {},
  fetchImpl = fetch,
  timeoutMs = STATUS_TIMEOUT_MS,
  now = Date.now,
  target = mode === "local" ? "local" : "production",
  state: stateStore,
  sink,
  digestSink,
  fallback = { record: async () => {} },
  heartbeat,
  newId,
}) {
  const nowMs = typeof now === "function" ? now() : now
  const observedAt = new Date(nowMs).toISOString()
  let status = null
  let found = new Map()
  let statusKnown = false

  try {
    const resolved = resolveOrigin({ mode, origin })
    const secret = await loadSecret()
    assertNarrowEnvironment(env, secret)
    const probe = await probeStatus({
      origin: resolved,
      secret,
      fetchImpl,
      timeoutMs,
    })
    if (probe.kind === "status") {
      status = probe.status
      statusKnown = true
      found = evaluateStatus(status, nowMs)
    } else {
      const summaries = {
        unreachable: `The archive status route could not be read (${probe.reason})`,
        auth_rejected: `The archive status route rejected the monitor credential (${probe.reason})`,
      }
      found.set(probe.condition, {
        severity: "critical",
        summary: summaries[probe.condition],
      })
    }
  } catch (error) {
    const code = error instanceof CheckerFailure ? error.code : "checker_error"
    found.set("monitor_error", {
      severity: "critical",
      summary: `The archive checker could not run (${code})`,
    })
  }

  let current
  try {
    current = sanitizeState(await stateStore.load())
  } catch {
    // An unavailable store may still hold undelivered critical alerts. Treating
    // it as empty would erase that outbox and falsely report monitor liveness.
    // Do not deliver, save or heartbeat until its original state can be read.
    return {
      ok: false,
      exitCode: 2,
      observedAt,
      conditions: [...found.keys()],
      alerts: [],
      heartbeat: { sent: false, reason: "state_load_failed" },
      errors: ["state_load_failed"],
    }
  }
  const next = structuredClone(current)
  const projected = structuredClone(current.active)
  for (const pending of current.pending) applyDelivery(projected, pending)
  const outgoing = []

  const probeActive = [...found.keys()].some((c) => PROBE_CONDITIONS.has(c))
  for (const [condition, entry] of Object.entries(projected)) {
    const isProbe = PROBE_CONDITIONS.has(condition)
    if (found.has(condition)) {
      const hit = found.get(condition)
      if (SEVERITY_RANK[hit.severity] > SEVERITY_RANK[entry.severity]) {
        outgoing.push({ kind: "escalate", condition, ...hit })
      } else {
        if (next.active[condition])
          next.active[condition].severity = hit.severity
      }
    } else if (isProbe && probeActive) {
      // One probe condition replaced another; the checker is still failing.
      delete next.active[condition]
    } else if (isProbe || statusKnown) {
      outgoing.push({ kind: "recover", condition })
    }
  }
  for (const [condition, hit] of found) {
    if (!(condition in projected)) {
      outgoing.push({ kind: "raise", condition, ...hit })
    }
  }

  for (const item of outgoing) {
    const alert =
      item.kind === "recover"
        ? buildAlert({
            condition: "recovered",
            severity: "info",
            summary: `Archive condition ${item.condition} recovered`,
            observedAt,
            target,
            status,
            recoveredCondition: item.condition,
            newId,
          })
        : buildAlert({
            condition: item.condition,
            severity: item.severity,
            summary: item.summary,
            observedAt,
            target,
            status,
            newId,
          })
    next.pending.push({ kind: item.kind, condition: item.condition, alert })
  }

  const alerts = []
  let deliveryFailures = 0
  const blocked = new Set()
  const pending = []
  for (const item of next.pending) {
    const { alert } = item
    // Never send a recovery (or a later recurrence) ahead of its failed raise.
    if (blocked.has(item.condition)) {
      pending.push(item)
      continue
    }
    const nonPaging = NON_PAGING_CONDITIONS.has(
      alert.recoveredCondition ?? alert.condition
    )
    try {
      await (nonPaging && digestSink ? digestSink : sink).deliver(alert)
      alerts.push({
        alertId: alert.alertId,
        condition: alert.condition,
        severity: alert.severity,
        delivered: true,
      })
      applyDelivery(next.active, item)
    } catch (error) {
      deliveryFailures++
      blocked.add(item.condition)
      pending.push(item)
      const reason = error instanceof CheckerFailure ? error.code : "sink_error"
      alerts.push({
        alertId: alert.alertId,
        condition: alert.condition,
        severity: alert.severity,
        delivered: false,
        reason,
      })
      // One fallback record per pending event, rather than a KV write on every
      // retry. Persist the marker with the outbox only after recording succeeds.
      // The outbox itself remains authoritative after fallback TTL expiry.
      if (!item.fallbackRecorded) {
        try {
          await fallback.record(alert, reason)
          item.fallbackRecorded = true
        } catch {
          // Keep the event pending and retry fallback recording next time.
        }
      }
    }
  }
  next.pending = pending
  // Replacing a probe failure never reports a misleading recovery. A replayed
  // old probe alert must not restore that obsolete condition in delivered state.
  if (probeActive) {
    for (const condition of PROBE_CONDITIONS) {
      if (!found.has(condition)) delete next.active[condition]
    }
  }

  let stateSaved = true
  // Healthy and already-deduplicated runs do not change durable state. Avoid a
  // KV write for each cron tick: a known unchanged state needs no new commit.
  // Both values use the same validated canonical shape, including the outbox.
  if (JSON.stringify(next) !== JSON.stringify(current)) {
    try {
      await stateStore.save(next)
    } catch {
      stateSaved = false
    }
  }

  let heartbeatResult = { sent: false, reason: "not_configured" }
  if (heartbeat) {
    heartbeatResult =
      deliveryFailures > 0
        ? { sent: false, reason: "delivery_failed" }
        : !stateSaved
          ? { sent: false, reason: "state_save_failed" }
          : await heartbeat()
  }

  const errors = []
  if (deliveryFailures > 0) errors.push("sink_delivery_failed")
  if (!stateSaved) errors.push("state_save_failed")
  if (
    heartbeat &&
    !heartbeatResult.sent &&
    deliveryFailures === 0 &&
    stateSaved
  ) {
    errors.push("heartbeat_failed")
  }
  return {
    ok: found.size === 0 && errors.length === 0,
    exitCode: errors.length > 0 ? 2 : found.size > 0 ? 1 : 0,
    observedAt,
    conditions: [...found.keys()],
    alerts,
    heartbeat: heartbeatResult,
    errors,
  }
}
