// B03 UI design §8.4, §8.5: history lines and the answer on a date, in words.
import { describe, expect, it } from "vitest"

import {
  atDateLines,
  eventLine,
  londonInstant,
  selectionRuleWords,
} from "@/components/nabalens/knowledge/corrections-copy"
import type { SlotEventView } from "@/lib/knowledge-client/contract"

const event = (over: Partial<SlotEventView> = {}): SlotEventView => ({
  eventId: 1,
  at: "2026-11-09T10:00:00.000Z",
  kind: "correction",
  actor: { id: "m1", name: "⟨Name⟩", basis: "venue_manager" },
  answer: null,
  before: null,
  after: null,
  material: null,
  selectionRule: null,
  reason: null,
  ...over,
})

describe("history lines (§8.4)", () => {
  it("words a correction with before, after, whether it needs confirming and why", () => {
    expect(
      eventLine(
        event({
          before: { headline: "yes", detail: null },
          after: { headline: "no", detail: null },
          material: true,
          reason: "⟨Reason⟩",
        })
      )
    ).toBe(
      "Corrected by ⟨Name⟩ (venue manager): Yes → No. Needs confirming again. Why: ⟨Reason⟩"
    )
    expect(
      eventLine(
        event({
          before: { headline: "yes", detail: null },
          after: { headline: "yes", detail: { fees: { kind: "free" } } },
          material: false,
        })
      )
    ).toBe(
      "Corrected by ⟨Name⟩ (venue manager): details changed. Confirmation kept."
    )
  })

  it("words a withdrawal, the other decisions and an upgrade", () => {
    expect(
      eventLine(
        event({
          kind: "withdrawal",
          actor: { id: "a1", name: "⟨Admin⟩", basis: "admin" },
          reason: "⟨R⟩",
        })
      )
    ).toBe("Withdrawn by ⟨Admin⟩ (admin). Why: ⟨R⟩")
    expect(
      eventLine(
        event({
          kind: "contribution",
          answer: "yes",
          actor: { id: "s1", name: "⟨Sam⟩", basis: "staff" },
        })
      )
    ).toBe("Finding sent by ⟨Sam⟩ (staff): Yes.")
    expect(
      eventLine(event({ kind: "adoption", selectionRule: "adopted" }))
    ).toBe("In use. Used automatically (no confirmation needed)")
    expect(eventLine(event({ kind: "upgrade", actor: null }))).toBe(
      "Upgraded to the new form: details not recorded."
    )
    expect(eventLine(event({ kind: "something_new" }))).toBe(
      "Changed by ⟨Name⟩ (venue manager)."
    )
  })

  it("says why an answer was selected", () => {
    expect(selectionRuleWords("confirmation", "⟨Name⟩")).toBe(
      "Confirmed by ⟨Name⟩"
    )
    expect(selectionRuleWords("conflict_choice", "⟨Name⟩")).toBe(
      "Chosen by ⟨Name⟩ from findings that disagreed"
    )
    expect(selectionRuleWords("withdrawal")).toBe("Withdrawn")
  })
})

describe("the answer on a date (§8.5)", () => {
  it("words the server's snapshot, or that none was in use", () => {
    expect(
      atDateLines(
        {
          checkId: "c1",
          at: "2026-11-09T23:59:59.000Z",
          answerInUse: {
            submissionId: "s1",
            answer: "yes",
            sentAt: "2026-11-01T10:00:00.000Z",
            confirmationState: "confirmed",
            withdrawn: false,
            detail: null,
            questionVersion: 1,
            selectionRule: "confirmation",
          },
        },
        "9 Nov 2026"
      )
    ).toEqual([
      "On 9 Nov 2026 the answer in use was Yes.",
      "Confirmed",
      "Recorded under version 1 of this question",
      "Selected because: confirmed",
    ])
    expect(
      atDateLines({ checkId: "c1", at: "x", answerInUse: null }, "9 Nov 2026")
    ).toEqual(["No answer was in use on 9 Nov 2026."])
  })

  it("reads a UK date and time as an instant, in summer and winter", () => {
    expect(londonInstant("2026-07-01", "12:00")).toBe(
      "2026-07-01T11:00:00.000Z"
    )
    expect(londonInstant("2026-11-09", "12:00")).toBe(
      "2026-11-09T12:00:00.000Z"
    )
    expect(londonInstant("2026-11-09", null)).toBe("2026-11-09T23:59:59.000Z")
  })
})
