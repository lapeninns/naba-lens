// B03 UI design §3.2: the facility detail model, what is sent, what comes
// back, and server field paths mapped onto the form.
import { describe, expect, it } from "vitest"

import {
  emptyFacility,
  facilityDetail,
  facilityErrors,
  facilityFieldErrors,
  facilityFromDetail,
  facilityTouched,
  type FacilityDraft,
} from "@/components/nabalens/knowledge/facility-detail"

const SUBJECT = "5a000000-0000-4000-8000-000000000001"
const draft = (over: Partial<FacilityDraft> = {}): FacilityDraft => ({
  ...emptyFacility(),
  ...over,
})

describe("facility detail", () => {
  it("sends nothing the person didn't give, and fees stay not recorded", () => {
    expect(facilityDetail(emptyFacility())).toBeNull()
    expect(facilityTouched(emptyFacility())).toBe(false)
    expect(
      facilityDetail(draft({ limitations: "   ", howToRequest: "" }))
    ).toBeNull()
  })

  it("sends what was given, trimmed, in the server's shape", () => {
    expect(
      facilityDetail(
        draft({
          locations: [{ subjectId: SUBJECT }, { label: "⟨Back bar⟩" }],
          availability: "on_request",
          fees: { kind: "charged", amount: " 1.5 ", unit: " ⟨game⟩ " },
          limitations: " ⟨Limitation⟩ ",
          howToRequest: "⟨How⟩",
        })
      )
    ).toEqual({
      locations: [{ subjectId: SUBJECT }, { label: "⟨Back bar⟩" }],
      availability: { state: "on_request" },
      fees: {
        kind: "charged",
        amount: { value: 1.5, currency: "GBP" },
        unit: "⟨game⟩",
      },
      limitations: "⟨Limitation⟩",
      howToRequest: "⟨How⟩",
    })
    expect(
      facilityDetail(draft({ fees: { kind: "free", amount: "3", unit: "x" } }))
    ).toEqual({ fees: { kind: "free" } })
    expect(
      facilityDetail(draft({ fees: { kind: "charged", amount: "", unit: "" } }))
    ).toEqual({ fees: { kind: "charged" } })
  })

  it("checks amounts and lengths before sending", () => {
    expect(
      facilityErrors(
        draft({ fees: { kind: "charged", amount: "lots", unit: "" } })
      )
    ).toEqual({ fees: "Enter the amount as a number, or leave it empty." })
    expect(
      facilityErrors(
        draft({ fees: { kind: "charged", amount: "100001", unit: "" } })
      ).fees
    ).toBeTruthy()
    expect(
      facilityErrors(draft({ howToRequest: "x".repeat(501) })).howToRequest
    ).toBe("Use up to 500 characters.")
    expect(facilityErrors(draft({ limitations: "x".repeat(2000) }))).toEqual({})
  })

  it("reads a stored detail back, ignoring what it can't read", () => {
    expect(
      facilityFromDetail({
        locations: [{ subjectId: SUBJECT }, { other: 1 }],
        availability: { state: "temporarily_unavailable" },
        fees: { kind: "charged", amount: { value: 2, currency: "GBP" } },
        limitations: "⟨L⟩",
      })
    ).toEqual(
      draft({
        locations: [{ subjectId: SUBJECT }],
        fees: { kind: "charged", amount: "2", unit: "" },
        limitations: "⟨L⟩",
      })
    )
    expect(facilityFromDetail(null)).toEqual(emptyFacility())
  })

  it("maps server field paths onto the form's fields", () => {
    expect(
      facilityFieldErrors({
        "detail.locations[1]": "Choose a place at this venue.",
        "detail.fees.amount": "This is out of range.",
        "detail.availability.state": "This isn't allowed here.",
        observedOn: "Choose a date in the last 30 days.",
      })
    ).toEqual({
      locations: "Choose a place at this venue.",
      fees: "This is out of range.",
      availability: "This isn't allowed here.",
    })
  })
})
