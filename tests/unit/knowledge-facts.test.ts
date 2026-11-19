// S1-FACTS: the pure fact mappings mirror their SQL
// (supabase/migrations/20261118104000_facts_freshness.sql). The same
// fixtures run against the database in tests/security/facts-freshness.test.ts.
import { describe, expect, it, vi } from "vitest"

import { checkDateBasis } from "@/components/nabalens/knowledge/copy"
import {
  coverageWords,
  percentWords,
  FACT_VERIFICATION_LABEL,
  FACT_VERIFICATION_STATES,
  factHistoryVerification,
  factSourceType,
  factVerificationState,
  spacePhotoCounts,
} from "@/lib/knowledge/facts"

vi.mock("server-only", () => ({}))

describe("fact verification (spec §10)", () => {
  it.each([
    ["available", null, null, "confirmed"],
    ["unavailable", "stale", "qualified_answer", "confirmed"],
    ["unavailable", "stale", "expired", "check_due"],
    ["unavailable", "stale", "basis_missing", "check_due"],
    ["unavailable", "stale", "recheck_requested", "check_due"],
    ["unavailable", "stale", "evidence_lost", "check_due"],
    ["unavailable", "stale", "schema_changed", "check_due"],
    ["unavailable", "disputed", "conflict", "check_due"],
    ["unavailable", "withdrawn", "answer_withdrawn", "withdrawn"],
    ["unavailable", "withdrawn", "confirmation_revoked", "withdrawn"],
    ["unavailable", "not_confirmed", "pending", "unconfirmed"],
    ["unavailable", "not_confirmed", "policy_incomplete", "unconfirmed"],
    ["unavailable", "unknown", "not_checked", "unconfirmed"],
    ["unavailable", "unknown", "unable_to_establish", "unconfirmed"],
    ["unavailable", "unknown", "not_enabled", null],
  ] as const)("%s %s/%s reads %s", (status, reason, detail, expected) => {
    expect(factVerificationState(status, reason, detail)).toBe(expected)
  })

  it("names all five states in the spec's words, and maps history resolutions", () => {
    expect(
      FACT_VERIFICATION_STATES.map((s) => FACT_VERIFICATION_LABEL[s])
    ).toEqual([
      "Unconfirmed",
      "Confirmed",
      "Check due",
      "Superseded",
      "Withdrawn",
    ])
    expect(factHistoryVerification("superseded")).toBe("superseded")
    expect(factHistoryVerification("proposed")).toBe("unconfirmed")
    expect(factHistoryVerification("current")).toBe("confirmed")
    expect(factHistoryVerification("withdrawn")).toBe("withdrawn")
  })
})

describe("fact source types (spec §9.2)", () => {
  const base = {
    sourceOrigin: null,
    sourceBasis: null,
    valueSchema: "presence",
    detail: null,
    confirmationBasis: null,
  }
  it("derives the type from the policy authority, the import and the contributor", () => {
    expect(
      factSourceType({
        ...base,
        valueSchema: "policy",
        sourceBasis: "venue_manager",
        detail: { authority: { source: "written_policy" } },
      })
    ).toBe("operating_policy")
    expect(
      factSourceType({
        ...base,
        sourceOrigin: "external_source",
        sourceBasis: "admin",
      })
    ).toBe("business_record")
    expect(factSourceType({ ...base, sourceBasis: "venue_manager" })).toBe(
      "manager_inspection"
    )
    expect(
      factSourceType({
        ...base,
        sourceBasis: "staff",
        confirmationBasis: "venue_manager",
      })
    ).toBe("staff_observation_confirmed")
    expect(factSourceType({ ...base, sourceBasis: "staff" })).toBe(
      "staff_observation"
    )
    expect(factSourceType(base)).toBe("unrecorded")
  })
})

describe("coverage words and space photos", () => {
  it("shows n of N with the percentage as secondary text (FA-8, spec §18.2)", () => {
    expect(coverageWords(5, 6)).toEqual({ text: "5 of 6", percent: "83.3%" })
    expect(coverageWords(0, 0)).toEqual({ text: "0 of 0", percent: null })
  })

  it("uses one percentage rule: one decimal, never 100% or 0% early (S3-E2E-2 F5)", () => {
    expect(percentWords(1, 3)).toBe("33.3%")
    expect(percentWords(2, 3)).toBe("66.7%")
    expect(percentWords(1, 2)).toBe("50%")
    expect(percentWords(3, 3)).toBe("100%")
    expect(percentWords(0, 3)).toBe("0%")
    // Would round to 100.0% or 0.0%.
    expect(percentWords(1999, 2000)).toBe("99.9%")
    expect(percentWords(1, 2000)).toBe("0.1%")
    expect(percentWords(0, 0)).toBeNull()
    expect(percentWords(1, Number.NaN)).toBeNull()
    expect(coverageWords(1999, 2000).percent).toBe("99.9%")
  })

  it("counts only a current space photo (spec §9.3)", () => {
    expect(spacePhotoCounts("current")).toBe(true)
    for (const s of ["check_due", "needs_replacement", "expired"] as const)
      expect(spacePhotoCounts(s)).toBe(false)
  })

  it("says what a verified_on check date counts from", () => {
    expect(
      checkDateBasis({
        use: "internal",
        state: "current",
        nextCheckDue: "2027-02-16T00:00:00Z",
        basis: "verified_on",
        basisDate: "2026-11-18",
      })
    ).toMatch(/^Counted from the day it was last confirmed/)
  })
})

describe("reconfirm service input", () => {
  it("checks the shape before calling the database, and passes the dates through", async () => {
    const { reconfirmFact } = await import("@/lib/server/knowledge/facts")
    const rpc = vi.fn().mockResolvedValue({
      data: {
        checkId: "c",
        submissionId: "s",
        verification: "confirmed",
        verifiedOn: "2026-11-18",
        nextCheckDue: null,
        slotRevision: 4,
        rechecksClosed: [],
      },
      error: null,
    })
    const actor = { db: { rpc } } as never
    const id = "4b0c8d1e-2f3a-4b5c-8d6e-7f8091a2b3c4"
    expect(await reconfirmFact(actor, { checkId: "nope" })).toMatchObject({
      ok: false,
      code: "not_found",
    })
    expect(
      await reconfirmFact(actor, {
        checkId: id,
        slotRevision: 3,
        checkedOn: "2026-02-30",
      })
    ).toMatchObject({ ok: false, code: "invalid_input" })
    expect(
      await reconfirmFact(actor, {
        checkId: id,
        slotRevision: 3,
        reconfirm: false,
      })
    ).toMatchObject({ ok: false, code: "invalid_input" })
    expect(rpc).not.toHaveBeenCalled()
    expect(
      await reconfirmFact(actor, {
        checkId: id,
        slotRevision: 3,
        checkedOn: "2026-11-17",
        nextCheckOn: "2026-12-01",
      })
    ).toMatchObject({ ok: true, verification: "confirmed", slotRevision: 4 })
    expect(rpc).toHaveBeenCalledWith("knowledge_reconfirm", {
      p_check_id: id,
      p_slot_revision: 3,
      p_checked_on: "2026-11-17",
      p_next_check_on: "2026-12-01",
      p_note: null,
      p_reconfirm: true,
    })
  })
})
