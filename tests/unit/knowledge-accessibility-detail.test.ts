// B03 UI design §3.2, §3.3: the accessibility detail model.
import { describe, expect, it } from "vitest"

import {
  accessDetail,
  accessErrors,
  accessFieldErrors,
  accessFromDetail,
  emptyAccess,
  emptyMeasurement,
  scopeName,
  stepFreeLine,
  type AccessDraft,
} from "@/components/nabalens/knowledge/accessibility-detail"
import type { Place } from "@/lib/knowledge-client/contract"

const MAIN: Place = {
  subjectId: "5a000000-0000-4000-8000-000000000001",
  kind: "entrance",
  label: "⟨Main entrance⟩",
  active: true,
}
const SIDE: Place = {
  ...MAIN,
  subjectId: "5a000000-0000-4000-8000-000000000002",
  label: "⟨Side door⟩",
}
const TODAY = "2026-11-10"
const ctx = (over: Partial<Parameters<typeof accessErrors>[1]> = {}) => ({
  answer: "yes",
  stepFree: true,
  entrances: [MAIN, SIDE],
  venueName: "⟨Venue⟩",
  today: TODAY,
  ...over,
})
const draft = (over: Partial<AccessDraft> = {}): AccessDraft => ({
  ...emptyAccess(),
  ...over,
})

describe("step-free entrance", () => {
  it("Yes needs a step-free entrance from Places", () => {
    expect(accessErrors(draft(), ctx()).entrances).toBe(
      "To answer Yes, mark at least one entrance as step-free."
    )
    expect(
      accessErrors(draft({ entrances: { [MAIN.subjectId]: "yes" } }), ctx())
    ).toEqual({})
    expect(
      stepFreeLine(draft({ entrances: { [MAIN.subjectId]: "yes" } }), ctx())
    ).toBe(
      "Yes says ⟨Main entrance⟩ is step-free. It says nothing about the others."
    )
  })

  it("No needs every listed entrance with steps, and at least one listed", () => {
    expect(
      accessErrors(
        draft({ entrances: { [MAIN.subjectId]: "no" } }),
        ctx({ answer: "no" })
      ).entrances
    ).toBe(
      "To answer No, mark every listed entrance as having steps (2 listed). If you didn't check them all, answer Couldn't establish."
    )
    expect(
      accessErrors(
        draft({
          entrances: { [MAIN.subjectId]: "no", [SIDE.subjectId]: "no" },
        }),
        ctx({ answer: "no" })
      )
    ).toEqual({})
    expect(
      accessErrors(draft(), ctx({ answer: "no", entrances: [] })).entrances
    ).toBe(
      "No needs ⟨Venue⟩'s entrances to be listed first. Ask your manager to add them under Places, or send Couldn't establish."
    )
    expect(stepFreeLine(draft(), ctx({ answer: "no" }))).toBe(
      "No says every entrance listed for ⟨Venue⟩ has steps (2 listed)."
    )
  })

  it("Couldn't establish is always accepted", () => {
    expect(accessErrors(draft(), ctx({ answer: "unknown" }))).toEqual({})
  })

  it("sends every listed entrance, Not checked by default, and no scope (A34)", () => {
    expect(
      accessDetail(draft({ entrances: { [MAIN.subjectId]: "yes" } }), {
        stepFree: true,
        features: [],
        entrances: [MAIN, SIDE],
      })
    ).toEqual({
      entrances: [
        { subjectId: MAIN.subjectId, stepFree: "yes" },
        { subjectId: SIDE.subjectId, stepFree: "not_checked" },
      ],
    })
  })
})

describe("other accessibility questions", () => {
  const other = ctx({ stepFree: false, entrances: [] })

  it("needs what was checked unless it couldn't be established", () => {
    expect(accessErrors(draft(), other).scope).toBe(
      "Choose what you checked, or name it."
    )
    expect(accessErrors(draft(), { ...other, answer: "unknown" })).toEqual({})
    expect(accessErrors(draft({ scope: { label: "⟨Lift⟩" } }), other)).toEqual(
      {}
    )
    // "Somewhere else" chosen but not named yet is no scope.
    expect(accessErrors(draft({ scope: { label: "  " } }), other).scope).toBe(
      "Choose what you checked, or name it."
    )
    expect(
      accessDetail(draft({ scope: { label: " " } }), {
        stepFree: false,
        features: [],
        entrances: [],
      })
    ).toEqual({})
  })

  it("sends the scope, every version feature and measurements", () => {
    expect(
      accessDetail(
        draft({
          scope: { subjectId: MAIN.subjectId },
          features: { ramp: "yes" },
          measurements: [
            {
              feature: "ramp",
              value: "60",
              unit: "mm",
              measuredOn: "2026-11-09",
              method: "tape",
            },
          ],
        }),
        {
          stepFree: false,
          features: [
            { key: "ramp", label: "⟨Ramp⟩", measurable: true },
            { key: "handrail", label: "⟨Handrail⟩", measurable: false },
          ],
          entrances: [],
        }
      )
    ).toEqual({
      scope: { subjectId: MAIN.subjectId },
      features: { ramp: "yes", handrail: "not_checked" },
      measurements: [
        {
          feature: "ramp",
          value: 60,
          unit: "mm",
          measuredOn: "2026-11-09",
          method: "tape",
        },
      ],
    })
  })

  it("checks each measurement before sending", () => {
    const m = (over = {}) =>
      accessErrors(
        draft({
          scope: { label: "x" },
          measurements: [
            {
              ...emptyMeasurement("ramp"),
              value: "60",
              unit: "mm",
              measuredOn: "2026-11-09",
              method: "tape",
              ...over,
            },
          ],
        }),
        other
      ).measurements
    expect(m()).toBeUndefined()
    expect(m({ value: "a" })).toBe("Enter a number.")
    expect(m({ unit: "" })).toBe("Choose a unit.")
    expect(m({ measuredOn: "" })).toBe("Add the date you measured.")
    expect(m({ measuredOn: "2026-11-11" })).toBe(
      "Choose today or an earlier day."
    )
    expect(m({ method: "" })).toBe("Say how you measured it.")
  })
})

describe("reading back and server paths", () => {
  it("reads a stored detail defensively", () => {
    expect(
      accessFromDetail({
        scope: { label: "⟨Lift⟩" },
        features: { ramp: "no", bad: "maybe" },
        entrances: [
          { subjectId: MAIN.subjectId, stepFree: "yes" },
          { subjectId: 3 },
        ],
        measurements: [{ feature: "ramp", value: 5, unit: "cm" }],
      })
    ).toEqual({
      scope: { label: "⟨Lift⟩" },
      features: { ramp: "no" },
      entrances: { [MAIN.subjectId]: "yes" },
      measurements: [
        { feature: "ramp", value: "5", unit: "cm", measuredOn: "", method: "" },
      ],
    })
  })

  it("maps paths onto sections and names a scope", () => {
    expect(
      accessFieldErrors({
        "detail.entrances":
          "Add the venue's entrances under Places first, or send Couldn't establish.",
        "detail.measurements[0].unit": "Check this value.",
        "detail.fees": "x",
      })
    ).toEqual({
      entrances:
        "Add the venue's entrances under Places first, or send Couldn't establish.",
      measurements: "Check this value.",
    })
    expect(scopeName({ subjectId: MAIN.subjectId }, [MAIN])).toBe(
      "⟨Main entrance⟩"
    )
    expect(scopeName({ label: "⟨Lift⟩" }, [])).toBe("⟨Lift⟩")
  })
})
