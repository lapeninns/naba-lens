import { describe, expect, it } from "vitest"

import { dueView, neededByView } from "@/lib/server/coverage/time"

// v0.5 rule 24 and decision 1: "needed by" orders Still needed and is shown,
// but it never becomes Overdue. After the day it reads just "Needed".
describe("needed by", () => {
  const nov = new Date("2026-11-15T10:00:00Z")

  it("reads Needed by and the day, without the year in the same year", () => {
    expect(neededByView("2026-11-30", nov)).toEqual({
      neededBy: "2026-11-30",
      label: "Needed by 30 Nov",
    })
  })

  it("adds the year for a date in another year", () => {
    expect(neededByView("2027-01-08", nov)?.label).toBe("Needed by 8 Jan 2027")
  })

  it("still says Needed by on the day itself", () => {
    expect(neededByView("2026-11-15", nov)?.label).toBe("Needed by 15 Nov")
  })

  it("says Needed once the day has passed, with no overdue state", () => {
    const view = neededByView("2026-11-14", nov)
    expect(view).toEqual({ neededBy: "2026-11-14", label: "Needed" })
    // The view has no flag a screen could draw as late.
    expect(Object.keys(view!).sort()).toEqual(["label", "neededBy"])
  })

  it("uses the London day, not UTC (BST)", () => {
    // 23:30 UTC on 31 Jul is 00:30 on 1 Aug in London.
    expect(
      neededByView("2026-07-31", new Date("2026-07-31T22:59:00Z"))?.label
    ).toBe("Needed by 31 Jul")
    expect(
      neededByView("2026-07-31", new Date("2026-07-31T23:30:00Z"))?.label
    ).toBe("Needed")
  })

  it("returns null without a valid calendar day", () => {
    expect(neededByView(null, nov)).toBeNull()
    expect(neededByView(undefined, nov)).toBeNull()
    expect(neededByView("2026-02-30", nov)).toBeNull()
    expect(neededByView("30 Nov", nov)).toBeNull()
  })

  it("never uses the due-date words", () => {
    for (const day of [
      "2026-11-01",
      "2026-11-15",
      "2026-12-25",
      "2027-03-01",
    ]) {
      expect(neededByView(day, nov)?.label).not.toMatch(/\b(due|overdue)\b/i)
    }
    // And it stays separate from dueView, which non-menu work still uses.
    expect(dueView("2026-11-30", false).label).toBe("Due 30 Nov 2026")
  })
})
