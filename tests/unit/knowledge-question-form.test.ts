// B03 UI design §2.1: which capture form a question gets from its registry
// version. Only forms this build implements are rendered; anything newer is
// a notice, never a guessed form.
import { describe, expect, it } from "vitest"

import { questionForm } from "@/components/nabalens/knowledge/question-form"
import type { RegistryQuestion } from "@/lib/knowledge-client/contract"

function question(over: Partial<RegistryQuestion> = {}): RegistryQuestion {
  return {
    key: "onsite_parking",
    family: "presence",
    subjectType: "venue",
    ownerRole: "venue_manager",
    version: 1,
    latestVersion: 1,
    catalogueVersion: 1,
    ruleVersion: null,
    valueSchema: { name: "presence", version: 1 },
    guidance: {
      question: "⟨Question⟩",
      captureBrief: "⟨Brief⟩",
      staffHelp: null,
      publicLabel: null,
    },
    evidenceRule: "photo",
    confirmation: "none",
    selfConfirmationAllowed: false,
    sensitivity: "ordinary",
    freshness: { internal: null, public: null },
    publishableFields: [],
    materialFields: ["headline"],
    requiresZones: false,
    lifecycle: "supported",
    supersededBy: null,
    effectiveFrom: null,
    changeKind: "initial",
    changeNote: null,
    ...over,
  }
}

describe("questionForm", () => {
  it("keeps today's form with no registry", () => {
    expect(questionForm(null)).toEqual({ kind: "b01" })
  })

  it("keeps today's form for the version 1 schemas", () => {
    expect(questionForm(question())).toEqual({ kind: "b01" })
    expect(
      questionForm(
        question({
          family: "connectivity",
          valueSchema: { name: "connectivity.wifi", version: 1 },
        })
      )
    ).toEqual({ kind: "b01" })
    expect(questionForm(question({ lifecycle: "presence_only" })).kind).toBe(
      "b01"
    )
  })

  it("gives facility version 1 its detail form", () => {
    expect(
      questionForm(
        question({
          family: "facility",
          valueSchema: { name: "facility", version: 1 },
        })
      )
    ).toEqual({ kind: "facility" })
  })

  it("gives accessibility version 1 its detail form, with the version's features", () => {
    const features = [
      { key: "grab_rails", label: "⟨Grab rails⟩", measurable: false },
    ]
    expect(
      questionForm(
        question({
          family: "accessibility",
          valueSchema: { name: "accessibility", version: 1 },
          features,
        })
      )
    ).toEqual({ kind: "accessibility", features })
    expect(
      questionForm(
        question({
          family: "accessibility",
          valueSchema: { name: "accessibility", version: 1 },
        })
      )
    ).toEqual({ kind: "accessibility", features: [] })
  })

  it("gives policy version 1 its editor, with whether areas are required", () => {
    expect(
      questionForm(
        question({
          family: "policy",
          valueSchema: { name: "policy", version: 1 },
          requiresZones: true,
        })
      )
    ).toEqual({ kind: "policy", requiresZones: true })
  })

  it("gives service and dated event version 1 their forms", () => {
    expect(
      questionForm(
        question({
          family: "service",
          valueSchema: { name: "service", version: 1 },
        })
      )
    ).toEqual({ kind: "service" })
    expect(
      questionForm(
        question({
          family: "schedule_event",
          valueSchema: { name: "schedule_event", version: 1 },
        })
      )
    ).toEqual({ kind: "schedule_event" })
  })

  it("never renders a form for a schema or version it doesn't know", () => {
    expect(
      questionForm(
        question({
          family: "policy",
          valueSchema: { name: "policy", version: 2 },
        })
      )
    ).toEqual({ kind: "unknown", schema: "policy", version: 2 })
    expect(
      questionForm(question({ valueSchema: { name: "presence", version: 2 } }))
    ).toEqual({ kind: "unknown", schema: "presence", version: 2 })
  })

  it("says a question isn't asked when its lifecycle ended", () => {
    for (const lifecycle of ["unsupported", "superseded", "retired"] as const)
      expect(questionForm(question({ lifecycle })).kind).toBe("not_asked")
    expect(
      questionForm(
        question({ lifecycle: "superseded", supersededBy: ["sports_screens"] })
      )
    ).toEqual({
      kind: "not_asked",
      lifecycle: "superseded",
      supersededBy: ["sports_screens"],
    })
  })
})
