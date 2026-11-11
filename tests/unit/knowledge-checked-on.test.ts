// B03 UI design §3.2: "Checked on" rules (default, chosen, the later-day
// reopen, range) and the line shown with an answer.
import { describe, expect, it } from "vitest"

import {
  checkedOnError,
  checkedOnLine,
  chooseCheckedOn,
  daysBefore,
  newCheckedOn,
  reopenCheckedOn,
} from "@/components/nabalens/knowledge/checked-on"

const TODAY = "2026-11-10"

describe("Checked on", () => {
  it("starts as today, left as the form's date", () => {
    expect(newCheckedOn(TODAY)).toEqual({
      date: TODAY,
      source: "form_default",
    })
  })

  it("is chosen once changed, even to today", () => {
    expect(chooseCheckedOn(TODAY)).toEqual({ date: TODAY, source: "chosen" })
    expect(chooseCheckedOn("")).toEqual({ date: null, source: "chosen" })
  })

  it("keeps a form's date reopened the same day, and a chosen date always", () => {
    expect(reopenCheckedOn(newCheckedOn(TODAY), TODAY)).toEqual({
      value: { date: TODAY, source: "form_default" },
      notice: null,
    })
    const chosen = chooseCheckedOn("2026-11-02")
    expect(reopenCheckedOn(chosen, TODAY)).toEqual({
      value: chosen,
      notice: null,
    })
  })

  it("clears a form's date reopened on a later day and asks for a choice", () => {
    const reopened = reopenCheckedOn(newCheckedOn("2026-11-07"), TODAY)
    expect(reopened).toEqual({
      value: { date: null, source: null },
      notice:
        "This draft was started on 7 Nov 2026. Choose the day you checked.",
    })
    expect(checkedOnError(reopened.value, TODAY)).toBe(
      "Choose the day you checked."
    )
  })

  it("allows today back to 30 days ago", () => {
    expect(daysBefore(TODAY, 30)).toBe("2026-10-11")
    expect(daysBefore("2026-03-01", 1)).toBe("2026-02-28")
    expect(checkedOnError(chooseCheckedOn("2026-10-11"), TODAY)).toBeNull()
    expect(checkedOnError(chooseCheckedOn("2026-10-10"), TODAY)).toBe(
      "This date is more than 30 days ago. Check again and choose the new date."
    )
    expect(checkedOnError(chooseCheckedOn("2026-11-11"), TODAY)).toBe(
      "Choose today or an earlier day."
    )
  })

  it("words the line for the sender and for managers", () => {
    const left = { date: "2026-11-03", source: "form_default" as const }
    expect(checkedOnLine(left, { kind: "own" })).toBe(
      "You checked on 3 Nov 2026."
    )
    expect(checkedOnLine(left, { kind: "manager", senderName: "⟨Name⟩" })).toBe(
      "Checked on 3 Nov 2026 by ⟨Name⟩ (the form's date, not changed)."
    )
    expect(
      checkedOnLine(
        { date: "2026-11-03", source: "chosen" },
        { kind: "manager", senderName: null }
      )
    ).toBe("Checked on 3 Nov 2026.")
    expect(checkedOnLine({ date: null, source: null }, { kind: "own" })).toBe(
      null
    )
  })
})
