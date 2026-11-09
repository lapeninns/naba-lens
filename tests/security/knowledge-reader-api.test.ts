// The internal reader end to end (docs/knowledge/internal-reader-api.md):
// the real route handler, the service-role source and
// knowledge_reader_answers_v1 on the isolated stack. The wrapper's own
// contract is knowledge-reader.test.ts; this covers what the reader adds.
import { randomBytes, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { credentialDigest } from "@/app/api/knowledge/_reader/credentials"
import { databaseSource } from "@/app/api/knowledge/_reader/source"
import { GET } from "@/app/api/knowledge/v1/venues/[venueId]/answers/route"

import { createVenue } from "../support/identities"
import {
  call,
  decide,
  json,
  service,
  submit,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

const credential = (id: string) =>
  `nlr_${id}_${randomBytes(32).toString("base64url")}`
const OPS = credential("sec-ops")
const TOILETS = credential("sec-toilets")
const ALL_KEYS = "onsite_parking,step_free_entrance,guest_toilets,guest_wifi"

let w: World
let other: World
let noScope: World
let inactive: string
let removed: World
let stepFree: string
const UNKNOWN = randomUUID()
const OUTSIDE = randomUUID()

function read(venue: string, keys: string, as = OPS) {
  const query = new URLSearchParams({
    keys,
    audience: "internal",
    purpose: "operations_lookup",
    schema: "1.0",
  })
  if (as === TOILETS) query.set("purpose", "pilot_verification")
  return GET(
    new Request(
      `http://127.0.0.1:3000/api/knowledge/v1/venues/${venue}/answers?${query}`,
      { headers: { authorization: `Bearer ${as}` } }
    ),
    { params: Promise.resolve({ venueId: venue }) }
  )
}

beforeAll(async () => {
  ;[w, other, noScope, removed] = await Promise.all([
    world("kn-api"),
    world("kn-api-other"),
    world("kn-api-noscope", { enable: false }),
    world("kn-api-removed"),
  ])
  inactive = (await createVenue(service, "kn-api-inactive", false)).id
  const venues = [
    w.venue,
    other.venue,
    noScope.venue,
    removed.venue,
    inactive,
    UNKNOWN,
  ]
  const entry = (id: string, cred: string, extra: object) => ({
    id,
    credentials: [
      { sha256: credentialDigest(cred), expiresAt: "2099-01-01T00:00:00Z" },
    ],
    venues,
    audiences: ["internal"],
    schemaMajors: [1],
    ...extra,
  })
  vi.stubEnv("KNOWLEDGE_READER_ENABLED", "true")
  vi.stubEnv(
    "KNOWLEDGE_READER_CONSUMERS",
    JSON.stringify([
      entry("sec-ops", OPS, {
        purposes: ["operations_lookup"],
        questions: "all",
      }),
      entry("sec-toilets", TOILETS, {
        purposes: ["pilot_verification"],
        questions: ["guest_toilets"],
      }),
    ])
  )
})
afterAll(() => vi.unstubAllEnvs())

describe("internal reader over the database", () => {
  it("returns the projection allowlist and no secrets, staff data or internal notes", async () => {
    const parking = await yes(w.staffA, w, "onsite_parking", {
      finding: "TEST car park behind",
      limitations: "TEST gravel",
    })
    await yes(w.staffA, w, "guest_wifi", {
      finding: "TEST password is hunter2",
      limitations: "TEST hunter2 on the bar",
    })
    await submit(w.staffB, w, "guest_toilets", { answer: "unknown" })
    stepFree = (await yes(w.staffA, w, "step_free_entrance")).contributionId
    await yes(other.staffA, other, "onsite_parking", {
      finding: "TEST other venue",
    })

    const logs: unknown[] = []
    const info = vi.spyOn(console, "info").mockImplementation((...args) => {
      logs.push(args)
    })
    const res = await read(w.venue, ALL_KEYS)
    info.mockRestore()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    const raw = await res.text()
    const body = JSON.parse(raw)

    expect(Object.keys(body).sort()).toEqual(
      ["answers", "audience", "purpose", "schema", "snapshot", "venue"].sort()
    )
    const [p, s, t, g] = body.answers
    for (const a of body.answers)
      expect(Object.keys(a).sort()).toEqual(
        [
          "conditions",
          "freshness",
          "key",
          "provenance",
          "questionVersion",
          "revision",
          "status",
          "summary",
          "unavailable",
          "value",
        ].sort()
      )
    expect(p).toMatchObject({
      key: "onsite_parking",
      status: "available",
      value: { type: "yes_no_na", answer: "yes" },
      summary: "TEST car park behind",
      conditions: [{ kind: "limitation", text: "TEST gravel" }],
      provenance: {
        sourceKind: "staff_observation",
        contributionId: parking.contributionId,
        idKind: "contribution",
        confirmation: null,
        redactionProof: null,
        evidence: { photos: 1, videos: 0 },
      },
      freshness: { observedAt: null, nextCheckDue: null, state: "unrated" },
    })
    expect(Object.keys(p.provenance).sort()).toEqual(
      [
        "confirmation",
        "contributionId",
        "evidence",
        "idKind",
        "redactionProof",
        "sourceKind",
      ].sort()
    )
    expect(s).toMatchObject({
      key: "step_free_entrance",
      status: "unavailable",
      value: null,
      provenance: null,
      unavailable: { reason: "not_confirmed", detail: "pending" },
    })
    expect(t).toMatchObject({
      key: "guest_toilets",
      unavailable: { reason: "unknown", detail: "unable_to_establish" },
    })
    expect(g).toMatchObject({
      key: "guest_wifi",
      status: "available",
      summary: null,
      conditions: [],
      provenance: {
        redactionProof: "recorded",
        evidence: { photos: 1, videos: 1 },
      },
    })

    const { data: assets } = await service
      .from("amenity_submission_assets")
      .select("asset_id")
      .eq("venue_id", w.venue)
    const forbidden = [
      "hunter2",
      "Back bar", // Wi-Fi test notes
      "testSpot",
      "TEST other venue",
      w.staffA.id,
      w.staffB.id,
      w.staffA.email,
      w.staffB.email,
      "TEST kn-api",
      OPS,
      ...(assets ?? []).map((a) => a.asset_id as string),
    ]
    for (const secret of forbidden) {
      expect(raw, secret).not.toContain(secret)
      expect(JSON.stringify(logs), secret).not.toContain(secret)
    }
    expect(JSON.stringify(logs)).not.toContain("TEST car park")
  })

  it("follows a confirmation to available, with a higher revision", async () => {
    const before = (await (await read(w.venue, "step_free_entrance")).json())
      .answers[0]
    const confirmed = await decide(
      w.manager,
      w,
      "step_free_entrance",
      { type: "contribution", id: stepFree },
      "confirm"
    )
    expect(confirmed.error).toBeNull()
    const after = (await (await read(w.venue, "step_free_entrance")).json())
      .answers[0]
    expect(after).toMatchObject({
      status: "available",
      provenance: {
        sourceKind: "staff_observation",
        confirmation: { authority: "venue_manager", selfConfirmed: false },
      },
    })
    expect(after.revision).toBeGreaterThan(before.revision)
  })

  it("gives the same 404 for unknown, inactive, unlisted and out-of-scope venues (NLK06)", async () => {
    await json(removed.admin, "knowledge_set_working_list", {
      p_venue_id: removed.venue,
      p_keys: [
        "onsite_parking",
        "step_free_entrance",
        "guest_toilets",
        "guest_wifi",
      ],
      p_enabled: false,
      p_reason: "TEST",
    })
    const bodies = new Set<string>()
    for (const venue of [
      UNKNOWN,
      inactive,
      noScope.venue,
      removed.venue,
      OUTSIDE,
    ]) {
      const res = await read(venue, "guest_toilets")
      expect(res.status, venue).toBe(404)
      const body = await res.json()
      expect(body.error.code).toBe("venue_not_found")
      bodies.add(JSON.stringify({ ...body.error, requestId: null }))
    }
    expect(bodies.size).toBe(1)
  })

  it("checks the venue even when no requested key is permitted (empty key list)", async () => {
    for (const venue of [UNKNOWN, inactive, noScope.venue]) {
      expect((await read(venue, "guest_wifi", TOILETS)).status, venue).toBe(404)
      expect(
        await databaseSource({
          venueId: venue,
          keys: [],
          signal: new AbortController().signal,
        })
      ).toEqual({
        ok: false,
        error: "venue_not_found",
      })
    }
    const res = await read(w.venue, "guest_wifi", TOILETS)
    expect(res.status).toBe(200)
    expect((await res.json()).answers).toEqual([
      expect.objectContaining({
        key: "guest_wifi",
        revision: null,
        unavailable: { reason: "not_permitted", detail: null },
      }),
    ])
  })

  it("reads only with the service role: a signed-in user gets 42501", async () => {
    for (const who of [w.staffA, w.manager, w.admin]) {
      const { error } = await call(who, "knowledge_reader_answers_v1", {
        p_venue_id: w.venue,
        p_keys: ["guest_toilets"],
      })
      expect(error?.code).toBe("42501")
    }
  })
})
