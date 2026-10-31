import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

import { createAdminClient } from "@/lib/supabase/admin"

export const WATCHDOG_OWNER = "amanshresthaaaaa@gmail.com"
export const WATCHDOG_CRON = "*/5 * * * *"
const REQUEST_TIMEOUT_MS = 8_000
const TOKEN = /^[A-Za-z0-9_-]{32,256}$/
type Authorization = "ok" | "unconfigured" | "unauthorized"

export function monitorAuthorized(
  request: Request,
  kind: "heartbeat" | "watchdog"
): Authorization {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return "unconfigured"
  }
  const heartbeat = process.env.ARCHIVE_MONITOR_HEARTBEAT_SECRET
  const cron = process.env.CRON_SECRET
  const secret = kind === "heartbeat" ? heartbeat : cron
  // A Worker heartbeat credential must never also authorize maintenance or
  // reveal archive status; distinct values prevent accidental privilege reuse.
  if (
    !secret ||
    secret.length < 32 ||
    (kind === "heartbeat" &&
      (!heartbeat ||
        !TOKEN.test(heartbeat) ||
        [
          cron,
          process.env.CLEANUP_SECRET,
          process.env.MEDIA_ARCHIVE_MONITOR_SECRET,
        ]
          .filter(Boolean)
          .includes(heartbeat)))
  ) {
    return "unconfigured"
  }
  const header = request.headers.get("authorization") ?? ""
  const given = header.startsWith("Bearer ") ? header.slice(7) : ""
  const hash = (value: string) => createHash("sha256").update(value).digest()
  return timingSafeEqual(hash(given), hash(secret)) ? "ok" : "unauthorized"
}

export type WatchdogEvent = {
  id: string
  claimId: string
  kind: "stopped" | "recovered"
  observedAt: string
  lastSeenAt: string | null
}
type Claim = { stopped: boolean; event: WatchdogEvent | null }
export type WatchdogStore = {
  heartbeat(): Promise<void>
  claim(): Promise<Claim>
  complete(event: WatchdogEvent): Promise<void>
}

export function createWatchdogStore(): WatchdogStore {
  // Construct lazily so missing database configuration takes the same external
  // alert path as a failed database request.
  let client: ReturnType<typeof createAdminClient> | undefined
  function database() {
    try {
      return (client ??= createAdminClient())
    } catch {
      throw new Error("heartbeat_store_unavailable")
    }
  }
  const signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return {
    async heartbeat() {
      const result = await database()
        .rpc("record_archive_monitor_heartbeat")
        .abortSignal(signal())
      if (result.error) throw new Error("heartbeat_store_unavailable")
    },
    async claim() {
      const result = await database()
        .rpc("claim_archive_monitor_alert")
        .abortSignal(signal())
      if (result.error) throw new Error("heartbeat_store_unavailable")
      return parseClaim(result.data)
    },
    async complete(event) {
      const result = await database()
        .rpc("complete_archive_monitor_alert", {
          p_event_id: event.id,
          p_claim_id: event.claimId,
        })
        .abortSignal(signal())
      if (result.error || result.data !== true) {
        throw new Error("heartbeat_store_unavailable")
      }
    },
  }
}

function parseClaim(value: unknown): Claim {
  if (!value || typeof value !== "object") throw new Error("invalid_claim")
  const claim = value as Partial<Claim>
  if (typeof claim.stopped !== "boolean") throw new Error("invalid_claim")
  if (claim.event === null) return { stopped: claim.stopped, event: null }
  const event = claim.event
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
  if (
    !event ||
    !uuid.test(event.id) ||
    !uuid.test(event.claimId) ||
    !["stopped", "recovered"].includes(event.kind) ||
    !Number.isFinite(Date.parse(event.observedAt)) ||
    (event.lastSeenAt !== null &&
      !Number.isFinite(Date.parse(event.lastSeenAt)))
  )
    throw new Error("invalid_claim")
  return { stopped: claim.stopped, event }
}

export type WatchdogEmail = {
  id: string
  kind: "stopped" | "recovered" | "heartbeat_store_unavailable"
  observedAt: string
  lastSeenAt: string | null
}

export function createWatchdogEmailSender(fetchImpl: typeof fetch = fetch) {
  const key = process.env.ARCHIVE_WATCHDOG_RESEND_API_KEY
  const from = process.env.ARCHIVE_WATCHDOG_EMAIL_FROM
  if (!key || !from || /[\r\n]/.test(from)) {
    throw new Error("watchdog_email_not_configured")
  }
  return async (event: WatchdogEmail) => {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "idempotency-key": `naba-lens-watchdog/${event.id}`,
      },
      body: JSON.stringify({
        from,
        to: [WATCHDOG_OWNER],
        subject: `Naba-Lens archive monitor: ${event.kind}`,
        text: [
          `Condition: ${event.kind}`,
          `Observed at: ${event.observedAt}`,
          `Last successful Worker check: ${event.lastSeenAt ?? "none recorded"}`,
          event.kind === "stopped"
            ? "The independent Cloudflare checker has not reported a successful run within 25 minutes. Check its cron, logs, email delivery and heartbeat access."
            : event.kind === "recovered"
              ? "The independent Cloudflare checker is reporting successful checks again."
              : "The independent watchdog could not read or save heartbeat state. Monitor health is unknown; inspect Supabase and the watchdog deployment.",
        ].join("\n"),
      }),
    })
    if (!response.ok) throw new Error("watchdog_email_failed")
    await response.body?.cancel()
  }
}

export async function runArchiveWatchdog(options: {
  store: WatchdogStore
  send: (event: WatchdogEmail) => Promise<void>
  now?: () => number
}) {
  const now = options.now ?? Date.now
  let stopped = false
  let delivered = 0
  try {
    // Drain an incident plus its recovery in order. A failed send/ack retains
    // the event and stable provider idempotency key for the next invocation.
    for (let i = 0; i < 2; i++) {
      const claim = await options.store.claim()
      stopped = claim.stopped
      if (!claim.event) break
      await options.send(claim.event)
      await options.store.complete(claim.event)
      delivered++
    }
    return { ok: !stopped, stopped, delivered }
  } catch (error) {
    if (
      error instanceof Error &&
      ["heartbeat_store_unavailable", "invalid_claim"].includes(error.message)
    ) {
      // When storage itself is unavailable there is nowhere durable to dedup.
      // One deterministic key per UTC day gives provider-side retry dedup.
      const day = new Date(now()).toISOString().slice(0, 10)
      await options.send({
        id: `store-unavailable-${day}`,
        kind: "heartbeat_store_unavailable",
        observedAt: `${day}T00:00:00.000Z`,
        lastSeenAt: null,
      })
    }
    throw new Error("watchdog_failed")
  }
}
