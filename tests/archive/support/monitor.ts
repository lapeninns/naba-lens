import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export type Alert = {
  schema: string
  alertId: string
  condition: string
  severity: "info" | "warning" | "critical"
  summary: string
  ownerAction: string
  observedAt: string
  target: string
  status: Record<string, unknown> | null
  recoveredCondition?: string
}

export type CheckResult = {
  ok: boolean
  exitCode: 0 | 1 | 2
  observedAt: string
  conditions: string[]
  alerts: {
    alertId: string
    condition: string
    severity: string
    delivered: boolean
    reason?: string
  }[]
  heartbeat: { sent: boolean; reason?: string }
  errors: string[]
}

export type StateStore = {
  load(): Promise<unknown>
  save(state: unknown): Promise<void>
}

export type CheckerModule = {
  runCheck(options: Record<string, unknown>): Promise<CheckResult>
  memoryStateStore(initial?: unknown): StateStore
  normalizeStatus(body: unknown): Record<string, unknown> | null
  MAX_AGE_SECONDS: number
  SLOW_CYCLE_SECONDS: number
  PRODUCTION_ORIGIN: string
}

const CHECKER = resolve(process.cwd(), "scripts/monitoring/archive-checker.mjs")

/** The checker module, or null until Monitoring's branch is present. */
export async function loadChecker(): Promise<CheckerModule | null> {
  if (!existsSync(CHECKER)) return null
  return (await import(
    /* @vite-ignore */ pathToFileURL(CHECKER).href
  )) as CheckerModule
}

export const SECRET = "s".repeat(40)
export const ORIGIN = "http://127.0.0.1:3642"
export const STATUS_URL = `${ORIGIN}/api/internal/media-archive/status`

export const HOUR = 3_600_000
export const NOW = Date.parse("2026-10-31T12:00:00.000Z")

/** A valid, healthy §4.5 status body at NOW. */
export function healthyBody(
  overrides: Record<string, unknown> = {},
  now = NOW
) {
  return {
    ok: true,
    status: "current",
    missing: 0,
    lastCompleteAt: new Date(now - HOUR).toISOString(),
    lastRunAt: new Date(now - 120_000).toISOString(),
    failed: false,
    inProgress: false,
    lastError: null,
    lastRunOutcome: "completed_cycle",
    consecutiveFailures: 0,
    cycleStartedAt: null,
    cycleProgress: null,
    lastCycleDurationSeconds: 3600,
    maxAgeSeconds: 93600,
    scheduleIntervalSeconds: 600,
    ...overrides,
  }
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      ...init.headers,
    },
  })
}

export type Harness = ReturnType<typeof createHarness>

/**
 * One checker "installation": a persistent dedup state, a sink that records
 * every delivered alert, and a fallback that records every undelivered one.
 * `run` performs one scheduled check against whatever `respond` returns.
 */
export function createHarness(checker: CheckerModule) {
  const state = checker.memoryStateStore()
  const delivered: Alert[] = []
  const digest: Alert[] = []
  const undelivered: { alert: Alert; reason: string }[] = []
  const requests: { url: string; init: RequestInit }[] = []
  const faults = { sink: null as null | (() => Error | null), heartbeat: 0 }
  let respond: () => Response | Promise<Response> = () =>
    jsonResponse(healthyBody())
  let loadSecretCalls = 0
  let runNow = NOW
  let nextId = 0

  const harness = {
    delivered,
    digest,
    undelivered,
    requests,
    faults,
    get loadSecretCalls() {
      return loadSecretCalls
    },
    respond(next: () => Response | Promise<Response>) {
      respond = next
    },
    body(overrides: Record<string, unknown> = {}, status = 200) {
      respond = () => jsonResponse(healthyBody(overrides, runNow), { status })
    },
    async run(
      options: {
        now?: number
        env?: Record<string, string>
        mode?: string
        origin?: string
        digestSink?: boolean
        heartbeat?: () => Promise<{ sent: boolean; reason?: string }>
        loadSecret?: () => Promise<string>
      } = {}
    ) {
      runNow = options.now ?? NOW
      return checker.runCheck({
        mode: options.mode ?? "local",
        origin: options.origin ?? ORIGIN,
        loadSecret:
          options.loadSecret ??
          (async () => {
            loadSecretCalls++
            return SECRET
          }),
        env: options.env ?? {},
        now: options.now ?? NOW,
        newId: () =>
          `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
        state,
        fetchImpl: async (url: URL, init: RequestInit) => {
          requests.push({ url: String(url), init })
          return respond()
        },
        sink: {
          async deliver(alert: Alert) {
            const failure = faults.sink?.()
            if (failure) throw failure
            delivered.push(structuredClone(alert))
          },
        },
        digestSink: options.digestSink
          ? {
              async deliver(alert: Alert) {
                digest.push(structuredClone(alert))
              },
            }
          : undefined,
        fallback: {
          async record(alert: Alert, reason: string) {
            undelivered.push({ alert: structuredClone(alert), reason })
          },
        },
        heartbeat: options.heartbeat,
      })
    },
  }
  return harness
}

export const conditionsOf = (alerts: Alert[]) =>
  alerts.map((alert) => alert.condition)
