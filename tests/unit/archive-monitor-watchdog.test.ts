import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const admin = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: admin }))

import {
  createWatchdogEmailSender,
  runArchiveWatchdog,
  type WatchdogEvent,
  type WatchdogStore,
} from "@/lib/server/archive-monitor"
import { POST as heartbeat } from "@/app/api/internal/archive-monitor/heartbeat/route"
import { GET as watchdog } from "@/app/api/internal/archive-monitor/watchdog/route"

const HEARTBEAT_SECRET = "heartbeat-".repeat(5)
const CRON_SECRET = "cron-".repeat(10)
const MONITOR_SECRET = "monitor-".repeat(7)
const UUID = "fb78264c-1a21-4edb-9c19-56593256c169"
const event: WatchdogEvent = {
  id: UUID,
  claimId: "266efcc8-194a-4979-a6f4-34ad34d9dab1",
  kind: "stopped",
  observedAt: "2026-10-31T12:00:00.000Z",
  lastSeenAt: "2026-10-31T11:30:00.000Z",
}

function request(secret?: string, method = "GET") {
  return new Request("https://fixture.example/api/internal/archive-monitor", {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
    ...(method === "POST" ? { body: '{"timestamp":"2099-01-01"}' } : {}),
  })
}

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production")
  vi.stubEnv("ARCHIVE_MONITOR_HEARTBEAT_SECRET", HEARTBEAT_SECRET)
  vi.stubEnv("CRON_SECRET", CRON_SECRET)
  vi.stubEnv("CLEANUP_SECRET", CRON_SECRET)
  vi.stubEnv("MEDIA_ARCHIVE_MONITOR_SECRET", MONITOR_SECRET)
  vi.stubEnv("ARCHIVE_WATCHDOG_RESEND_API_KEY", "fixture-send-only-key")
  vi.stubEnv("ARCHIVE_WATCHDOG_EMAIL_FROM", "Naba-Lens <monitor@example.com>")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  admin.mockReset()
})

describe("independent heartbeat boundaries", () => {
  it("never records heartbeats or sends watchdog email from a Vercel preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview")
    expect((await heartbeat(request(HEARTBEAT_SECRET, "POST"))).status).toBe(
      503
    )
    expect((await watchdog(request(CRON_SECRET))).status).toBe(503)
    expect(admin).not.toHaveBeenCalled()
  })
  it("rejects unsigned and cross-purpose credentials before accessing the database", async () => {
    for (const secret of [undefined, CRON_SECRET, MONITOR_SECRET]) {
      expect((await heartbeat(request(secret, "POST"))).status).toBe(401)
    }
    expect((await watchdog(request(HEARTBEAT_SECRET))).status).toBe(401)
    expect(admin).not.toHaveBeenCalled()
  })

  it("fails closed when heartbeat reuses an application maintenance/status secret", async () => {
    for (const secret of [CRON_SECRET, MONITOR_SECRET]) {
      vi.stubEnv("ARCHIVE_MONITOR_HEARTBEAT_SECRET", secret)
      expect((await heartbeat(request(secret, "POST"))).status).toBe(503)
    }
    expect(admin).not.toHaveBeenCalled()
  })

  it("still runs the watchdog when the Worker heartbeat secret is missing", async () => {
    vi.stubEnv("ARCHIVE_MONITOR_HEARTBEAT_SECRET", "")
    admin.mockReturnValue({
      rpc: vi.fn(() => ({
        abortSignal: vi.fn().mockResolvedValue({
          data: { stopped: true, event: null },
          error: null,
        }),
      })),
    })
    const response = await watchdog(request(CRON_SECRET))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ stopped: true })
    expect(admin).toHaveBeenCalledOnce()
  })

  it("records only a server-clock heartbeat and never accepts a client timestamp", async () => {
    const rpc = vi.fn(() => ({
      abortSignal: vi.fn().mockResolvedValue({ data: null, error: null }),
    }))
    admin.mockReturnValue({ rpc })
    const response = await heartbeat(request(HEARTBEAT_SECRET, "POST"))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "record_archive_monitor_heartbeat"
    )
  })

  it("reports database failure as unavailable", async () => {
    admin.mockImplementation(() => {
      throw new Error("secret database detail")
    })
    const response = await heartbeat(request(HEARTBEAT_SECRET, "POST"))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain("secret database detail")
  })
})

describe("watchdog ordered delivery", () => {
  function store(events = [event]): WatchdogStore {
    return {
      heartbeat: vi.fn(),
      claim: vi.fn(async () => ({ stopped: false, event: events[0] ?? null })),
      complete: vi.fn(async () => {
        events.shift()
      }),
    }
  }

  it("retries an undelivered incident with the same id even after recovery", async () => {
    const pending = store()
    const failing = vi.fn().mockRejectedValue(new Error("transport failed"))
    await expect(
      runArchiveWatchdog({ store: pending, send: failing })
    ).rejects.toThrow("watchdog_failed")
    expect(pending.complete).not.toHaveBeenCalled()
    const success = vi.fn().mockResolvedValue(undefined)
    expect(
      await runArchiveWatchdog({ store: pending, send: success })
    ).toMatchObject({ ok: true, delivered: 1 })
    expect(success).toHaveBeenCalledWith(event)
    expect(failing).toHaveBeenCalledWith(event)
  })

  it("delivers queued incident and recovery in order", async () => {
    const recovery = {
      ...event,
      id: "bfb79aee-efc7-415e-981e-cb017094daef",
      kind: "recovered" as const,
    }
    const pending = store([event, recovery])
    const send = vi.fn().mockResolvedValue(undefined)
    const report = await runArchiveWatchdog({ store: pending, send })
    expect(send.mock.calls.map(([value]) => value.kind)).toEqual([
      "stopped",
      "recovered",
    ])
    expect(report).toMatchObject({ ok: true, delivered: 2 })
  })

  it("does not acknowledge a failed send or hide a stopped monitor", async () => {
    const pending = store([])
    vi.mocked(pending.claim).mockResolvedValue({ stopped: true, event: null })
    const report = await runArchiveWatchdog({ store: pending, send: vi.fn() })
    expect(report).toEqual({ ok: false, stopped: true, delivered: 0 })
    expect(pending.complete).not.toHaveBeenCalled()
  })

  it("emails unknown-health failure with a stable payload when heartbeat storage is down", async () => {
    const pending = store([])
    vi.mocked(pending.claim).mockRejectedValue(
      new Error("heartbeat_store_unavailable")
    )
    const send = vi.fn().mockResolvedValue(undefined)
    for (const time of ["2026-10-31T12:00:00Z", "2026-10-31T12:05:00Z"]) {
      await expect(
        runArchiveWatchdog({
          store: pending,
          send,
          now: () => Date.parse(time),
        })
      ).rejects.toThrow("watchdog_failed")
    }
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0])
    expect(send.mock.calls[0][0].kind).toBe("heartbeat_store_unavailable")
  })
})

describe("fixed destination email transport", () => {
  it("pins Resend, the owner, no redirects and a stable idempotency key", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }))
    await createWatchdogEmailSender(fetchImpl)(event)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://api.resend.com/emails")
    expect(init.redirect).toBe("error")
    expect(init.headers["idempotency-key"]).toBe(`naba-lens-watchdog/${UUID}`)
    expect(JSON.parse(init.body).to).toEqual(["amanshresthaaaaa@gmail.com"])
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("does not mark a rejected email as delivered", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("private provider error", { status: 500 })
      )
    await expect(createWatchdogEmailSender(fetchImpl)(event)).rejects.toThrow(
      "watchdog_email_failed"
    )
  })
})
