// S2-METRICS server reads and the event writer with a stubbed database
// client: venue ids are checked before any call, errors map onto the shared
// shape, and events are cleaned (allowlist, active venue) before they leave.
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/server/media/context", () => ({ getMediaActor: vi.fn() }))

import { recordFlowEventsAction } from "@/app/_metrics/actions"
import { fixtureMetrics } from "@/lib/metrics/fixtures"
import { getMediaActor } from "@/lib/server/media/context"
import {
  loadMetricsOverview,
  loadMyContributions,
  loadVenueMetrics,
  recordFlowEvents,
} from "@/lib/server/metrics"

const VENUE = "00000000-0000-4000-8000-00000000a001"
const ID = "11111111-1111-4111-8111-111111111111"

function fakeDb(
  data: unknown,
  error: { message: string; code: string } | null = null
) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const db = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return { data: error ? null : data, error }
    }),
  }
  return { caller: { db: db as never }, calls }
}

describe("loadVenueMetrics", () => {
  it("reads one venue for the period and parses it", async () => {
    const { caller, calls } = fakeDb(fixtureMetrics())
    const read = await loadVenueMetrics(caller, VENUE, 7)
    expect(read.ok).toBe(true)
    expect(calls).toEqual([
      { fn: "venue_metrics", args: { p_venue_id: VENUE, p_days: 7 } },
    ])
  })

  it("lets the database choose the manager's venue when none is named", async () => {
    const { caller, calls } = fakeDb(fixtureMetrics())
    await loadVenueMetrics(caller, null, 30)
    expect(calls[0]!.args).toEqual({ p_days: 30 })
  })

  it("refuses a malformed venue id without calling the database", async () => {
    const { caller, calls } = fakeDb(fixtureMetrics())
    const read = await loadVenueMetrics(caller, "not-a-uuid", 30)
    expect(read).toMatchObject({ ok: false, code: "not_found" })
    expect(calls).toEqual([])
  })

  it("maps a refused scope and an unreadable answer", async () => {
    const refused = await loadVenueMetrics(
      fakeDb(null, { message: "not_venue_manager", code: "42501" }).caller,
      VENUE,
      30
    )
    expect(refused).toMatchObject({ ok: false, code: "forbidden" })
    const vi_ = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const broken = await loadVenueMetrics(fakeDb({}).caller, VENUE, 30)
    expect(broken).toMatchObject({ ok: false, code: "unavailable" })
    vi_.mockRestore()
  })
})

describe("overview and own contributions", () => {
  it("reads both for the period", async () => {
    const o = fakeDb({ days: 7, generatedAt: "x", failedJobs: 0, venues: [] })
    expect((await loadMetricsOverview(o.caller, 7)).ok).toBe(true)
    expect(o.calls[0]).toEqual({
      fn: "metrics_overview",
      args: { p_days: 7 },
    })
    const mine = fakeDb({ days: 7, useful: 1, firstFulfilment: 1 })
    const read = await loadMyContributions(mine.caller, 7)
    expect(read).toMatchObject({ ok: true, contributions: { useful: 1 } })
  })
})

describe("recordFlowEvents", () => {
  it("sends only allowlisted fields, at the active venue when none is named", async () => {
    const { caller, calls } = fakeDb(1)
    const read = await recordFlowEvents(
      caller,
      [
        {
          name: "submitted",
          clientEventId: ID,
          route: "gallery",
          latitude: 51.5,
          fileName: "IMG_0001.HEIC",
        },
      ],
      VENUE
    )
    expect(read).toEqual({ ok: true, stored: 1 })
    const [event] = calls[0]!.args.p_events as Array<Record<string, unknown>>
    expect(event).toMatchObject({
      name: "submitted",
      venueId: VENUE,
      route: "gallery",
    })
    expect(event).not.toHaveProperty("latitude")
    expect(event).not.toHaveProperty("fileName")
  })

  it("makes no call when nothing is sendable", async () => {
    const { caller, calls } = fakeDb(0)
    expect(await recordFlowEvents(caller, [{ name: "nope" }], VENUE)).toEqual({
      ok: true,
      stored: 0,
    })
    expect(calls).toEqual([])
  })
})

describe("recordFlowEventsAction", () => {
  it("never throws and records nothing when signed out", async () => {
    vi.mocked(getMediaActor).mockResolvedValueOnce({
      ok: false,
      status: 401,
      message: "Sign in to continue.",
    } as never)
    expect(await recordFlowEventsAction([])).toEqual({ ok: false, stored: 0 })
    vi.mocked(getMediaActor).mockRejectedValueOnce(new Error("down"))
    expect(await recordFlowEventsAction([])).toEqual({ ok: false, stored: 0 })
  })

  it("records at the person's active venue", async () => {
    const { caller, calls } = fakeDb(1)
    vi.mocked(getMediaActor).mockResolvedValueOnce({
      ok: true,
      actor: { ...caller, profile: { venueId: VENUE } },
    } as never)
    expect(
      await recordFlowEventsAction([
        { name: "flow_started", clientEventId: ID },
      ])
    ).toEqual({ ok: true, stored: 1 })
    expect(
      (calls[0]!.args.p_events as Array<{ venueId: string }>)[0]!.venueId
    ).toBe(VENUE)
  })
})
