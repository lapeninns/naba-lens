// B03 UI design §4: the policy model. Saving an incomplete policy is allowed
// (D-B3-5): only malformed rows stop a send; what's missing is a guide.
import { describe, expect, it } from "vitest"

import {
  emptyPolicy,
  listLabel,
  policyDetail,
  policyErrors,
  policyFieldErrors,
  policyFromDetail,
  policyFacts,
  policyNeeds,
  policyTouched,
  stanceAnswer,
  type PolicyDraft,
} from "@/components/nabalens/knowledge/policy-detail"

const BAR = "5a000000-0000-4000-8000-000000000001"
const LEAD = {
  code: "on_lead",
  label: "⟨On a lead⟩",
  needsValue: false,
  valueKind: null,
} as const
const UNTIL = {
  code: "until_time",
  label: "⟨Until⟩",
  needsValue: true,
  valueKind: "time",
} as const
const MAX = {
  code: "max_count",
  label: "⟨Up to⟩",
  needsValue: true,
  valueKind: "number",
} as const
const lists = { conditionTypes: [LEAD, UNTIL, MAX], exceptionTypes: [] }
const today = "2026-11-10"
const draft = (over: Partial<PolicyDraft> = {}): PolicyDraft => ({
  ...emptyPolicy(),
  ...over,
})

describe("policy model", () => {
  it("stores each rule under its headline; Allowed with conditions is a Yes", () => {
    expect(stanceAnswer("allowed")).toBe("yes")
    expect(stanceAnswer("conditional")).toBe("yes")
    expect(stanceAnswer("not_allowed")).toBe("no")
    expect(stanceAnswer("not_applicable")).toBe("not_applicable")
    expect(stanceAnswer("unknown")).toBe("unknown")
  })

  it("starts with one empty area when the version requires areas", () => {
    expect(emptyPolicy().zones).toEqual([])
    expect(emptyPolicy({ requiresZones: true }).zones).toEqual([
      { place: null, stance: "" },
    ])
    expect(policyTouched(emptyPolicy({ requiresZones: true }))).toBe(false)
  })

  it("guides with what's missing in the server's order", () => {
    expect(policyNeeds(draft(), { requiresZones: true })).toEqual([
      "stance",
      "zones",
      "authority",
      "stated_on",
    ])
    expect(policyNeeds(draft({ stance: "conditional" }))).toEqual([
      "conditions",
      "authority",
      "stated_on",
    ])
    expect(
      policyNeeds(
        draft({
          stance: "allowed",
          source: "in_person",
          statedOn: today,
        })
      )
    ).toEqual([])
    expect(policyNeeds(draft({ stance: "unknown" }))[0]).toBe("stance")
  })

  it("stops a send only for a malformed row or date, never for what's missing", () => {
    expect(
      policyErrors(draft({ stance: "allowed" }), { ...lists, today })
    ).toEqual({})
    expect(policyErrors(draft(), { ...lists, today })).toEqual({
      stance: "Choose the rule.",
    })
    const bad = policyErrors(
      draft({
        stance: "conditional",
        zones: [{ place: { label: "  " }, stance: "allowed" }],
        conditions: [{ type: "until_time", value: "6pm", note: "" }],
        exceptions: [{ type: "", note: "⟨Note⟩" }],
        statedOn: "2026-11-11",
      }),
      { ...lists, today }
    )
    expect(bad).toEqual({
      zones: "Choose the area, or name it.",
      conditions: "Enter a time, such as 18:00.",
      exceptions: "Choose an exception.",
      statedOn: "Choose today or an earlier day.",
    })
    expect(
      policyErrors(
        draft({
          stance: "conditional",
          conditions: [{ type: "max_count", value: "", note: "" }],
        }),
        { ...lists, today }
      ).conditions
    ).toBe("Add the value.")
  })

  it("sends a statement with its basis from the account, and drops empty rows", () => {
    const detail = policyDetail(
      draft({
        stance: "conditional",
        zones: [
          { place: { subjectId: BAR }, stance: "allowed" },
          { place: null, stance: "" },
        ],
        conditions: [
          { type: "on_lead", value: "", note: " ⟨Note⟩ " },
          { type: "max_count", value: "2", note: "" },
        ],
        source: "written_policy",
        statedOn: today,
        reference: " ⟨Reference⟩ ",
      }),
      { basis: "venue_manager", ...lists }
    )
    expect(detail).toEqual({
      stance: "conditional",
      zones: [{ subjectId: BAR, stance: "allowed" }],
      conditions: [
        { type: "on_lead", note: "⟨Note⟩" },
        { type: "max_count", value: 2 },
      ],
      policyScope: "venue",
      authority: {
        basis: "venue_manager",
        statedOn: today,
        source: "written_policy",
        reference: "⟨Reference⟩",
      },
    })
  })

  it("never sends conditions unless the rule has them, nor authority for staff", () => {
    const base = draft({
      stance: "allowed",
      conditions: [{ type: "on_lead", value: "", note: "" }],
      source: "in_person",
    })
    expect(policyDetail(base, { basis: "admin", ...lists })).not.toHaveProperty(
      "conditions"
    )
    const staff = policyDetail(
      { ...base, zones: [{ place: { label: "⟨Garden⟩" }, stance: "allowed" }] },
      { basis: null, ...lists }
    )
    expect(staff).toEqual({
      stance: "allowed",
      zones: [{ label: "⟨Garden⟩", stance: "allowed" }],
    })
  })

  it("reads a stored detail back, defensively", () => {
    const back = policyFromDetail({
      stance: "conditional",
      zones: [{ subjectId: BAR, stance: "not_allowed" }, "junk"],
      conditions: [{ type: "max_count", value: 2 }],
      exceptions: [{ type: "assistance_dogs", note: "⟨Note⟩" }],
      policyScope: "organisation",
      authority: { basis: "admin", statedOn: today, source: "in_person" },
    })
    expect(back).toMatchObject({
      stance: "conditional",
      zones: [{ place: { subjectId: BAR }, stance: "not_allowed" }],
      conditions: [{ type: "max_count", value: "2", note: "" }],
      exceptions: [{ type: "assistance_dogs", note: "⟨Note⟩" }],
      policyScope: "organisation",
      statedOn: today,
      source: "in_person",
    })
    expect(policyFromDetail("junk")).toEqual(emptyPolicy())
    expect(policyFromDetail({ stance: "maybe" }).stance).toBeNull()
  })

  it("puts server paths on their sections", () => {
    expect(
      policyFieldErrors({
        "detail.zones[0].stance": "⟨Zone⟩",
        "detail.conditions[1].type": "⟨Condition⟩",
        "detail.authority.statedOn": "⟨Date⟩",
        "detail.authority.basis": "⟨Basis⟩",
        observedOn: "⟨Other⟩",
      })
    ).toEqual({
      zones: "⟨Zone⟩",
      conditions: "⟨Condition⟩",
      statedOn: "⟨Date⟩",
      source: "⟨Basis⟩",
    })
  })

  it("names a retired list item instead of dropping it", () => {
    expect(listLabel("on_lead", [LEAD])).toBe("⟨On a lead⟩")
    expect(listLabel("old_code", [LEAD])).toBe("old_code (no longer offered)")
  })
})

describe("a policy finding's rows on a To confirm card (§4.4)", () => {
  it("reads each row in order, naming places and list items", () => {
    expect(
      policyFacts(
        {
          stance: "conditional",
          zones: [
            { subjectId: BAR, stance: "allowed" },
            { label: "⟨Garden⟩", stance: "not_allowed" },
          ],
          conditions: [{ type: "max_count", value: 2 }, { type: "gone_code" }],
          exceptions: [{ type: "assist" }],
          policyScope: "venue",
          authority: {
            basis: "venue_manager",
            statedOn: "2026-11-02",
            source: "in_person",
            reference: "⟨Reference⟩",
          },
        },
        {
          places: [
            { subjectId: BAR, kind: "area", label: "⟨Back bar⟩", active: true },
          ],
          conditionTypes: [MAX],
          exceptionTypes: [
            {
              code: "assist",
              label: "⟨Assistance dogs⟩",
              needsValue: false,
              valueKind: null,
            },
          ],
        }
      )
    ).toEqual([
      { term: "Rule", value: "Allowed with conditions" },
      { term: "Areas", value: "⟨Back bar⟩: Allowed; ⟨Garden⟩: Not allowed" },
      {
        term: "Conditions",
        value: "⟨Up to⟩: 2; gone_code (no longer offered)",
      },
      { term: "Exceptions", value: "⟨Assistance dogs⟩" },
      { term: "Applies to", value: "This venue" },
      { term: "Stated on", value: "2 Nov 2026" },
      { term: "Where", value: "In person" },
      { term: "Reference", value: "⟨Reference⟩" },
    ])
  })

  it("says only what a staff observation has", () => {
    expect(
      policyFacts(
        { stance: "allowed" },
        { places: [], conditionTypes: [], exceptionTypes: [] }
      )
    ).toEqual([{ term: "Rule", value: "Allowed" }])
  })
})

describe("retired list items (A38)", () => {
  it("names a retired item by its label, and an unknown code as it is", () => {
    const retired = [
      {
        code: "old",
        label: "⟨Old condition⟩",
        needsValue: false,
        valueKind: null,
      },
    ]
    expect(listLabel("old", [LEAD], retired)).toBe(
      "⟨Old condition⟩ (no longer offered)"
    )
    expect(listLabel("gone", [LEAD], retired)).toBe("gone (no longer offered)")
  })
})
