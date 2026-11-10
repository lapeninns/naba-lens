import { describe, expect, it } from "vitest"

import { parseResolverRow, toAnswer } from "@/app/api/knowledge/_reader/answers"
import {
  credentialDigest,
  parseRegistry,
} from "@/app/api/knowledge/_reader/credentials"
import {
  handleAnswersRequest,
  type ReaderDeps,
} from "@/app/api/knowledge/_reader/handler"
import { ConsumerLimiter } from "@/app/api/knowledge/_reader/rate-limit"

// B03 changes what knowledge_reader_answers_v1 returns (b03-design §3.8,
// §5.2, §7.3, §9.3): new details under the existing reasons, never a new
// reason, and value and detail fields null as for every unavailable row.

const VENUE = "0f8f6b2e-1111-4111-8111-111111111111"
const CRED = `nlr_b03-test_${"b".repeat(43)}`
const NOW = Date.parse("2026-11-20T10:00:00Z")

/** An unavailable row exactly as the B03-c wrapper returns it. */
function withheld(key: string, reason: string, detail: string) {
  return {
    question_key: key,
    status: "unavailable",
    reason,
    detail,
    revision: 6,
    question_version: 2,
    value: null,
    finding: null,
    limitations: null,
    reason_text: null,
    source_basis: null,
    current_contribution_id: null,
    current_submission_id: null,
    contribution_kind: null,
    confirmation_required: true,
    confirmation_state: null,
    confirmation_basis: null,
    confirmation_self: null,
    confirmation_saved_at: null,
    evidence_photos: null,
    evidence_videos: null,
    redaction_proof: null,
    saved_at: null,
    // The wrapper keeps these on unavailable rows; the reader drops them.
    observed_at: "2026-11-01T00:00:00+00:00",
    next_check_due: "2026-12-01T00:00:00+00:00",
    freshness_state: null,
  }
}

function plainYes(key: string) {
  return {
    ...withheld(key, "", ""),
    status: "available",
    reason: null,
    detail: null,
    question_version: 1,
    value: "yes",
    finding: "TEST level door",
    source_basis: "staff",
    current_contribution_id: "7d2f0000-0000-4000-8000-000000000002",
    current_submission_id: "6c1e0000-0000-4000-8000-000000000001",
    contribution_kind: "contribution",
    confirmation_required: false,
    confirmation_state: "not_required",
    evidence_photos: 1,
    evidence_videos: 0,
    redaction_proof: "not_applicable",
    saved_at: "2026-11-18T14:02:11+00:00",
    observed_at: null,
    next_check_due: null,
    freshness_state: "unrated",
  }
}

const B03_DETAILS: [string, string][] = [
  ["stale", "qualified_answer"],
  ["not_confirmed", "policy_incomplete"],
  ["stale", "basis_missing"],
  ["stale", "expired"],
  ["stale", "schema_changed"],
  ["stale", "temporary_until_passed"],
  ["stale", "recheck_requested"],
]

const read = (raw: unknown) => {
  const row = parseResolverRow(raw)
  return row ? toAnswer(row, "internal") : null
}

describe("B03 details keep the v1 reasons", () => {
  it.each(B03_DETAILS)(
    "%s / %s reads unavailable, with no value or answer fields",
    (reason, detail) => {
      expect(read(withheld("onsite_parking", reason, detail))).toEqual({
        key: "onsite_parking",
        questionVersion: 2,
        status: "unavailable",
        value: null,
        summary: null,
        conditions: [],
        provenance: null,
        revision: 6,
        freshness: null,
        unavailable: { reason, detail },
      })
    }
  )

  it.each([
    ["policy_incomplete under stale", "stale", "policy_incomplete"],
    [
      "qualified_answer under not_confirmed",
      "not_confirmed",
      "qualified_answer",
    ],
    ["basis_missing under unknown", "unknown", "basis_missing"],
    ["schema_changed under withdrawn", "withdrawn", "schema_changed"],
    [
      "temporary_until_passed under disputed",
      "disputed",
      "temporary_until_passed",
    ],
    ["a recheck cause that is not a detail", "stale", "scope_changed"],
    ["another recheck cause", "stale", "schedule_ended"],
    ["a freshness state, not a detail", "stale", "due_soon"],
    ["an invented detail", "stale", "needs_a_look"],
    ["a new reason", "qualified", "qualified_answer"],
  ])("fails closed on %s", (_name, reason, detail) => {
    expect(read(withheld("onsite_parking", reason, detail))).toBeNull()
  })

  it("never lets a qualified row through as available", () => {
    // A wrapper bug that kept the value would still need a role confirmation
    // and an available status; the detail alone never makes it available.
    expect(
      read({ ...plainYes("onsite_parking"), detail: "qualified_answer" })
    ).toBeNull()
  })
})

describe("a response mixing B03 details with plain answers", () => {
  const registry = parseRegistry(
    JSON.stringify([
      {
        id: "b03-test",
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
  )!
  const deps = (rows: unknown[]): ReaderDeps => ({
    config: () => ({ ok: true, registry }),
    source: async () => ({ ok: true, rows }),
    limiter: new ConsumerLimiter({
      perMinute: 600,
      burst: 100,
      maxConcurrent: 4,
      now: () => NOW,
    }),
    now: () => NOW,
    requestId: () => "req-b03",
    sourceTimeoutMs: 50,
    log: () => {},
  })
  const get = () =>
    handleAnswersRequest(
      new Request(
        `https://lens.test/api/knowledge/v1/venues/${VENUE}/answers?keys=onsite_parking,step_free_entrance,guest_toilets&audience=internal&purpose=operations_lookup&schema=1.0`,
        { headers: { authorization: `Bearer ${CRED}` } }
      ),
      VENUE,
      deps(rows)
    )
  let rows: unknown[] = []

  it("answers 200, withholding the qualified and incomplete answers", async () => {
    rows = [
      withheld("onsite_parking", "not_confirmed", "policy_incomplete"),
      plainYes("step_free_entrance"),
      withheld("guest_toilets", "stale", "qualified_answer"),
    ]
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(
      body.answers.map((a: { unavailable: unknown }) => a.unavailable)
    ).toEqual([
      { reason: "not_confirmed", detail: "policy_incomplete" },
      null,
      { reason: "stale", detail: "qualified_answer" },
    ])
    expect(body.answers[1]).toMatchObject({
      status: "available",
      value: { type: "yes_no_na", answer: "yes" },
      summary: "TEST level door",
    })
    // The wrapper's dates on withheld rows never reach the consumer.
    expect(JSON.stringify(body)).not.toContain("2026-12-01")
  })

  it("still fails the whole response closed on a truly unknown detail", async () => {
    rows = [
      withheld("onsite_parking", "stale", "scope_changed"),
      plainYes("step_free_entrance"),
      withheld("guest_toilets", "stale", "qualified_answer"),
    ]
    const res = await get()
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe("internal_error")
  })
})
