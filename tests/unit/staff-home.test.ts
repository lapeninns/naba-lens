import { describe, expect, it } from "vitest"

import { addReminder, HOME_COPY, londonDay } from "@/lib/staff/home"
import type { MyUpload } from "@/lib/staff/my-uploads"

const NOW = new Date("2026-11-18T12:00:00Z")
const upload = (uploadedAt: string, venueId = "v1") =>
  ({ assetId: uploadedAt, venueId, uploadedAt }) as MyUpload

describe("addReminder (DESIGN.md §5c step 6)", () => {
  it("asks for first photos when the person has none here", () => {
    const r = addReminder([upload("2026-11-18T09:00:00Z", "v2")], "v1", NOW)
    expect(r).toEqual({ kind: "first" })
    expect(HOME_COPY.reminderTitle(r)).toBe("Add your first photos")
  })

  it("counts today's photos in the venue's day", () => {
    const r = addReminder(
      [
        upload("2026-11-18T09:00:00Z"),
        upload("2026-11-18T00:30:00Z"),
        upload("2026-11-17T23:30:00Z"),
      ],
      "v1",
      NOW
    )
    expect(r).toEqual({ kind: "today", count: 2, atLeast: false })
    expect(HOME_COPY.reminderLine(r)).toBe("You've added 2 photos today.")
  })

  it("says 'or more' when every photo read was today's and more exist", () => {
    const r = addReminder(
      [upload("2026-11-18T09:00:00Z"), upload("2026-11-18T08:00:00Z")],
      "v1",
      NOW,
      true
    )
    expect(HOME_COPY.reminderLine(r)).toBe(
      "You've added 2 or more photos today."
    )
  })

  it("says how long since the last photos", () => {
    const yesterday = addReminder([upload("2026-11-17T20:00:00Z")], "v1", NOW)
    expect(HOME_COPY.reminderLine(yesterday)).toBe(
      "Your last photos were yesterday."
    )
    const days = addReminder([upload("2026-11-15T20:00:00Z")], "v1", NOW)
    expect(days).toEqual({ kind: "since", days: 3 })
    expect(HOME_COPY.reminderLine(days)).toBe(
      "Your last photos were 3 days ago."
    )
  })

  it("says nothing it can't know when the read failed", () => {
    const r = addReminder(null, "v1", NOW)
    expect(HOME_COPY.reminderTitle(r)).toBe("Got photos from today?")
    expect(HOME_COPY.reminderLine(r)).toBeNull()
  })

  it("never names a slot", () => {
    for (const r of [
      addReminder([], "v1", NOW),
      addReminder([upload("2026-11-18T09:00:00Z")], "v1", NOW),
      addReminder([upload("2026-11-10T09:00:00Z")], "v1", NOW),
    ])
      expect(
        `${HOME_COPY.reminderTitle(r)} ${HOME_COPY.reminderLine(r)}`
      ).not.toMatch(/slot/i)
  })

  it("uses London's calendar day across midnight UTC in summer", () => {
    expect(londonDay(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02")
  })
})
