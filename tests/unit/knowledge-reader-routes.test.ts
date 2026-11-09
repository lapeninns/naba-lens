import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { credentialDigest } from "@/app/api/knowledge/_reader/credentials"

const helper = vi.hoisted(() => ({ read: vi.fn() }))
const SERVICE = vi.hoisted(() => ({ kind: "service-role client" }))
vi.mock("@/lib/server/knowledge", () => ({ readKnowledgeAnswers: helper.read }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => SERVICE }))

const answersRoute =
  await import("@/app/api/knowledge/v1/venues/[venueId]/answers/route")
const metaRoute = await import("@/app/api/knowledge/v1/meta/route")

const VENUE = "0f8f6b2e-1111-4111-8111-111111111111"
const CRED = `nlr_route-test_${"r".repeat(43)}`
const QUERY =
  "keys=onsite_parking,guest_toilets&audience=internal&purpose=operations_lookup&schema=1.0"

const available = {
  question_key: "onsite_parking",
  status: "available",
  reason: null,
  detail: null,
  revision: 5,
  question_version: 1,
  value: "no",
  finding: null,
  limitations: null,
  reason_text: "TEST no car park",
  source_basis: "staff",
  current_contribution_id: "7d2f0000-0000-4000-8000-000000000002",
  current_submission_id: "6c1e0000-0000-4000-8000-000000000001",
  contribution_kind: "contribution",
  confirmation_required: false,
  confirmation_state: "not_required",
  confirmation_basis: null,
  confirmation_self: null,
  confirmation_saved_at: null,
  evidence_photos: 1,
  evidence_videos: 0,
  redaction_proof: "not_applicable",
  saved_at: "2026-11-18T14:02:11.123+00:00",
  observed_at: null,
  next_check_due: null,
  freshness_state: "unrated",
}
const unavailable = {
  ...Object.fromEntries(Object.keys(available).map((k) => [k, null])),
  question_key: "guest_toilets",
  status: "unavailable",
  reason: "unknown",
  detail: "not_checked",
  revision: 2,
  question_version: 1,
  confirmation_required: false,
}

beforeEach(() => {
  vi.stubEnv("KNOWLEDGE_READER_ENABLED", "true")
  vi.stubEnv(
    "KNOWLEDGE_READER_CONSUMERS",
    JSON.stringify([
      {
        id: "route-test",
        credentials: [
          { sha256: credentialDigest(CRED), expiresAt: "2099-01-01T00:00:00Z" },
        ],
        venues: [VENUE],
        audiences: ["internal"],
        purposes: ["operations_lookup"],
        questions: "all",
        schemaMajors: [1],
      },
    ])
  )
  helper.read.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

function request(
  method = "GET",
  path = `/api/knowledge/v1/venues/${VENUE.toUpperCase()}/answers?${QUERY}`
) {
  return new Request(`https://lens.test${path}`, {
    method,
    headers: { authorization: `Bearer ${CRED}` },
  })
}
const params = { params: Promise.resolve({ venueId: VENUE.toUpperCase() }) }

describe("GET /api/knowledge/v1/venues/{venueId}/answers", () => {
  it("reads through WS1's helper with the service-role client", async () => {
    helper.read.mockResolvedValue({ ok: true, rows: [available, unavailable] })
    const res = await answersRoute.GET(request(), params)
    expect(res.status).toBe(200)
    expect(helper.read).toHaveBeenCalledExactlyOnceWith(SERVICE, VENUE, [
      "onsite_parking",
      "guest_toilets",
    ])
    const body = await res.json()
    expect(body.answers).toEqual([
      expect.objectContaining({
        key: "onsite_parking",
        value: { type: "yes_no_na", answer: "no" },
        conditions: [{ kind: "reason", text: "TEST no car park" }],
        provenance: expect.objectContaining({
          sourceKind: "staff_observation",
          idKind: "contribution",
          contributionId: available.current_contribution_id,
        }),
        revision: 5,
      }),
      expect.objectContaining({
        key: "guest_toilets",
        status: "unavailable",
        revision: 2,
        unavailable: { reason: "unknown", detail: "not_checked" },
      }),
    ])
  })

  it("maps the helper's venue_not_found to 404 and its other failures to 503", async () => {
    helper.read.mockResolvedValue({ ok: false, code: "venue_not_found" })
    expect((await answersRoute.GET(request(), params)).status).toBe(404)
    for (const code of ["unavailable", "invalid_input"]) {
      helper.read.mockResolvedValue({ ok: false, code })
      expect((await answersRoute.GET(request(), params)).status, code).toBe(503)
    }
  })

  it("answers HEAD without a body and refuses other methods with the reader's 405", async () => {
    helper.read.mockResolvedValue({ ok: true, rows: [available, unavailable] })
    const head = await answersRoute.HEAD(request("HEAD"), params)
    expect(head.status).toBe(200)
    expect(await head.text()).toBe("")
    for (const method of [
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ] as const) {
      const res = await answersRoute[method](request(method), params)
      expect(res.status, method).toBe(405)
      expect(res.headers.get("allow")).toBe("GET, HEAD")
      expect((await res.json()).error.code).toBe("method_not_allowed")
    }
  })

  it("never reaches the database while the reader is switched off", async () => {
    vi.stubEnv("KNOWLEDGE_READER_ENABLED", "")
    expect((await answersRoute.GET(request(), params)).status).toBe(503)
    expect(helper.read).not.toHaveBeenCalled()
  })
})

describe("GET /api/knowledge/v1/meta", () => {
  it("describes the credential without touching the database", async () => {
    const res = await metaRoute.GET(request("GET", "/api/knowledge/v1/meta"))
    expect(res.status).toBe(200)
    expect((await res.json()).consumer).toMatchObject({
      id: "route-test",
      venues: [VENUE],
    })
    expect(helper.read).not.toHaveBeenCalled()
    expect(
      (await metaRoute.POST(request("POST", "/api/knowledge/v1/meta"))).status
    ).toBe(405)
  })
})
