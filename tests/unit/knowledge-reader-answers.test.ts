import { describe, expect, it } from "vitest"

import {
  etagMatches,
  notPermittedAnswer,
  parseResolverRow,
  snapshotEtag,
  toAnswer,
} from "@/app/api/knowledge/_reader/answers"

const SUB = "6c1e0000-0000-4000-8000-000000000001"
const CONTRIB = "7d2f0000-0000-4000-8000-000000000002"

/** A wrapper row, with extra columns the reader must never copy. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    venue_id: "0f8f6b2e-1111-4111-8111-111111111111",
    question_key: "onsite_parking",
    check_id: "8e3a0000-0000-4000-8000-000000000003",
    in_scope: true,
    status: "available",
    reason: null,
    detail: null,
    revision: 7,
    question_version: 1,
    value: "yes",
    current_submission_id: SUB,
    current_contribution_id: CONTRIB,
    contribution_kind: "contribution",
    source_basis: "staff",
    finding: "Car park behind the pub, 20 spaces.",
    limitations: "Gravel surface.",
    reason_text: null,
    confirmation_required: false,
    confirmation_state: "not_required",
    confirmation_basis: null,
    confirmation_self: null,
    confirmation_saved_at: null,
    evidence_photos: 2,
    evidence_videos: 1,
    evidence_state: "complete",
    redaction_proof: "not_applicable",
    saved_at: "2026-11-18T14:02:11Z",
    observed_at: null,
    next_check_due: null,
    freshness_state: "unrated",
    pending_count: 3,
    rule_version: 1,
    // Never in output, even if a wrapper bug returned them:
    submitted_by: "11111111-0000-4000-8000-000000000009",
    submitted_by_name: "Asha Rai",
    internal_metadata: { testSpot: "bar", downloadMbps: 50 },
    notes: "Manager note",
    ...overrides,
  }
}
const answer = (overrides: Record<string, unknown> = {}) =>
  toAnswer(parseResolverRow(row(overrides))!, "internal")

const ANSWER_FIELDS = [
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
]

describe("answer allowlist", () => {
  it("returns exactly the documented fields for an available answer", () => {
    const a = answer()!
    expect(Object.keys(a).sort()).toEqual(ANSWER_FIELDS)
    expect(a).toEqual({
      key: "onsite_parking",
      questionVersion: 1,
      status: "available",
      value: { type: "yes_no_na", answer: "yes" },
      summary: "Car park behind the pub, 20 spaces.",
      conditions: [{ kind: "limitation", text: "Gravel surface." }],
      provenance: {
        sourceKind: "staff_observation",
        contributionId: CONTRIB,
        idKind: "contribution",
        confirmation: null,
        redactionProof: null,
        evidence: { photos: 2, videos: 1 },
      },
      revision: 7,
      freshness: {
        savedAt: "2026-11-18T14:02:11.000Z",
        observedAt: null,
        nextCheckDue: null,
        state: "unrated",
      },
      unavailable: null,
    })
    const json = JSON.stringify(a)
    for (const leak of [
      "Asha",
      "11111111-",
      "testSpot",
      "Manager note",
      "pending",
      "evidence_state",
      "rule_version",
    ]) {
      expect(json, leak).not.toContain(leak)
    }
  })

  it("never returns guest_wifi staff text, even if the resolver did", () => {
    const a = answer({
      question_key: "guest_wifi",
      finding: "Password is Crown2026!",
      limitations: "Password Crown2026! on the bar",
      reason_text: "Crown2026!",
      redaction_proof: "not_recorded",
    })!
    expect(a.summary).toBeNull()
    expect(a.conditions).toEqual([])
    expect(a.provenance?.redactionProof).toBe("not_recorded")
    expect(JSON.stringify(a)).not.toContain("Crown2026")
  })

  it("requires a redaction proof state for guest_wifi (fails closed)", () => {
    expect(
      answer({ question_key: "guest_wifi", redaction_proof: "not_applicable" })
    ).toBeNull()
  })

  it.each([
    ["staff", "staff_observation"],
    ["venue_manager", "manager_observation"],
    ["admin", "admin_observation"],
    [null, "observation"],
  ])("maps source_basis %s to sourceKind %s", (basis, kind) => {
    expect(answer({ source_basis: basis })?.provenance?.sourceKind).toBe(kind)
  })

  it("names a submission ID as a submission when there is no contribution (before B01)", () => {
    const provenance = answer({
      current_contribution_id: null,
      contribution_kind: "submission",
    })?.provenance
    expect(provenance?.contributionId).toBe(SUB)
    expect(provenance?.idKind).toBe("submission")
  })

  it("returns the ID that matches the stated kind, never the other one", () => {
    expect(
      answer({ contribution_kind: "submission" })?.provenance
    ).toMatchObject({ contributionId: SUB, idKind: "submission" })
    expect(
      answer({ contribution_kind: "contribution" })?.provenance
    ).toMatchObject({ contributionId: CONTRIB, idKind: "contribution" })
  })

  it("exposes a confirmation as a role, a self-confirmed flag and a save time", () => {
    const confirmed = {
      question_key: "step_free_entrance",
      confirmation_required: true,
      confirmation_state: "confirmed",
      confirmation_basis: "venue_manager",
      confirmation_saved_at: "2026-11-19T09:40:00Z",
    }
    expect(
      answer({ ...confirmed, confirmation_self: true })?.provenance
        ?.confirmation
    ).toEqual({
      authority: "venue_manager",
      selfConfirmed: true,
      savedAt: "2026-11-19T09:40:00.000Z",
    })
    expect(
      answer({ ...confirmed, confirmation_self: false })?.provenance
        ?.confirmation?.selfConfirmed
    ).toBe(false)
    // Available but unconfirmed breaks the resolver contract.
    expect(answer({ ...confirmed, confirmation_state: "pending" })).toBeNull()
  })

  it("returns unavailable answers with no value, text or provenance, keeping the revision", () => {
    const a = answer({
      status: "unavailable",
      reason: "withdrawn",
      detail: "answer_withdrawn",
      value: null,
      revision: 9,
    })!
    expect(a).toEqual({
      key: "onsite_parking",
      questionVersion: 1,
      status: "unavailable",
      value: null,
      summary: null,
      conditions: [],
      provenance: null,
      revision: 9,
      freshness: null,
      unavailable: { reason: "withdrawn", detail: "answer_withdrawn" },
    })
  })

  it("withholds a value type schema 1.0 cannot represent", () => {
    expect(answer({ value: "monday_to_friday" })?.unavailable).toEqual({
      reason: "unsupported_version",
      detail: null,
    })
  })

  it("hides everything, including the revision, for a key the credential may not read", () => {
    expect(notPermittedAnswer("guest_wifi")).toMatchObject({
      revision: null,
      questionVersion: null,
      unavailable: { reason: "not_permitted", detail: null },
    })
  })

  it.each<[string, Record<string, unknown>]>([
    ["an unknown status", { status: "maybe" }],
    [
      "an unknown reason",
      { status: "unavailable", reason: "not_permitted", detail: null },
    ],
    [
      "a detail from another reason",
      { status: "unavailable", reason: "stale", detail: "conflict" },
    ],
    ["a reason on an available answer", { reason: "stale", detail: "expired" }],
    ["a negative revision", { revision: -1 }],
    ["a fractional revision", { revision: 1.5 }],
    ["a non-UUID contribution", { current_contribution_id: "Asha" }],
    ["no contribution kind", { contribution_kind: null }],
    ["an unknown contribution kind", { contribution_kind: "legacy" }],
    [
      "a contribution kind without its ID",
      { contribution_kind: "contribution", current_contribution_id: null },
    ],
    [
      "a submission kind without its ID",
      { contribution_kind: "submission", current_submission_id: null },
    ],
    ["an invalid save time", { saved_at: "yesterday" }],
    ["no save time", { saved_at: null }],
    ["no value", { value: null }],
    ["text in the place of a count", { evidence_photos: "two" }],
  ])("fails closed on %s", (_name, overrides) => {
    const parsed = parseResolverRow(row(overrides))
    expect(parsed === null || toAnswer(parsed, "internal") === null).toBe(true)
  })

  it("accepts a bigint revision sent as a string", () => {
    expect(answer({ revision: "12" })?.revision).toBe(12)
  })
})

describe("snapshot ETag", () => {
  const base = { venueId: "v", audience: "internal", schema: "1.0" }
  it("changes with a revision and matches If-None-Match lists", () => {
    const a = snapshotEtag({ ...base, answers: [answer()!] })
    const b = snapshotEtag({ ...base, answers: [answer({ revision: 8 })!] })
    expect(a).not.toBe(b)
    expect(a).toMatch(/^"k1-[0-9a-f]{32}"$/)
    expect(etagMatches(`W/${a}, "other"`, a)).toBe(true)
    expect(etagMatches(b, a)).toBe(false)
    expect(etagMatches(null, a)).toBe(false)
  })
})
