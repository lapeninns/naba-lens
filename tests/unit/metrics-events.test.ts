import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  EVENT_BATCH_MAX,
  EVENT_FIELDS,
  FLOW_EVENT_NAMES,
  CAPTURE_ROUTES,
  cleanEvent,
  cleanEvents,
} from "@/lib/metrics/events"

// S2-METRICS (spec §18.3, AC13): workflow events carry ids, a route, counts
// and short codes only, never location or photo content.

const VENUE = "00000000-0000-4000-8000-00000000a001"
const ID = "11111111-1111-4111-8111-111111111111"
const base = { name: "flow_started", venueId: VENUE, clientEventId: ID }

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20261118117000_metrics_instrumentation.sql",
      import.meta.url
    )
  ),
  "utf8"
)

describe("the allowlist matches the database", () => {
  it("has the same fields as private.product_event_fields", () => {
    const sql = migration.match(/select array\[([^\]]+)\]/)![1]!
    const fields = [...sql.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1])
    expect([...EVENT_FIELDS].sort()).toEqual([...fields].sort())
  })

  it("has the same names and routes as the table's checks", () => {
    for (const name of FLOW_EVENT_NAMES)
      expect(migration).toContain(`'${name}'`)
    for (const route of CAPTURE_ROUTES)
      expect(migration).toContain(`'${route}'`)
  })
})

describe("cleanEvent", () => {
  it("drops location, file names, notes and any other field", () => {
    const e = cleanEvent({
      ...base,
      latitude: 51.5,
      longitude: -0.12,
      location: "Garden",
      exif: { GPSLatitude: 1 },
      fileName: "IMG_0001.HEIC",
      note: "free text",
      count: 3,
    })!
    expect(Object.keys(e).sort()).toEqual(
      ["clientEventId", "count", "name", "occurredAt", "venueId"].sort()
    )
    for (const key of Object.keys(e))
      expect(EVENT_FIELDS as readonly string[]).toContain(key)
  })

  it("needs a known name, a venue and a client id", () => {
    expect(cleanEvent({ ...base, name: "location_seen" })).toBeNull()
    expect(cleanEvent({ ...base, venueId: "nope" })).toBeNull()
    expect(cleanEvent({ ...base, clientEventId: undefined })).toBeNull()
    expect(cleanEvent("flow_started")).toBeNull()
    expect(cleanEvent([base])).toBeNull()
  })

  it("takes the fallback venue when none is given", () => {
    const { venueId: _v, ...noVenue } = base
    expect(cleanEvent(noVenue)).toBeNull()
    expect(cleanEvent(noVenue, VENUE)!.venueId).toBe(VENUE)
    // A named venue wins over the fallback; the database checks it.
    const other = "00000000-0000-4000-8000-00000000a002"
    expect(cleanEvent({ ...base, venueId: other }, VENUE)!.venueId).toBe(other)
  })

  it("drops malformed optional fields rather than sending them", () => {
    const e = cleanEvent({
      ...base,
      route: "camera",
      batchId: "batch-1",
      assetId: ID,
      subjectKind: "dish",
      count: -1,
      stage: "upload",
      outcome: "Bad photo: GPS 51.5",
    })!
    expect(e.route).toBeUndefined()
    expect(e.batchId).toBeUndefined()
    expect(e.assetId).toBe(ID)
    // A subject needs both its kind and id.
    expect(e.subjectKind).toBeUndefined()
    expect(e.count).toBeUndefined()
    expect(e.stage).toBeUndefined()
    expect(e.outcome).toBeUndefined()
    expect(
      cleanEvent({ ...base, outcome: "waiting", count: 1000 })
    ).toMatchObject({ outcome: "waiting", count: 1000 })
    expect(cleanEvent({ ...base, count: 1.5 })!.count).toBeUndefined()
  })

  it("keeps a subject with both kind and id", () => {
    expect(
      cleanEvent({ ...base, subjectKind: "area", subjectId: ID })
    ).toMatchObject({ subjectKind: "area", subjectId: ID })
  })

  it("normalises the time and defaults a bad one to now", () => {
    expect(
      cleanEvent({ ...base, occurredAt: "2026-11-18T10:00:00+01:00" })!
        .occurredAt
    ).toBe("2026-11-18T09:00:00.000Z")
    expect(
      Date.parse(cleanEvent({ ...base, occurredAt: "yesterday" })!.occurredAt)
    ).not.toBeNaN()
  })
})

describe("cleanEvents", () => {
  it("keeps at most one batch of sendable events", () => {
    const many = Array.from({ length: EVENT_BATCH_MAX + 5 }, () => base)
    expect(cleanEvents(many)).toHaveLength(EVENT_BATCH_MAX)
    expect(cleanEvents([base, { name: "x" }, null])).toHaveLength(1)
    expect(cleanEvents("not a list")).toEqual([])
  })
})
