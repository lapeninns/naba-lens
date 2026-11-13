// B03 UI design §5.1, §5.3: the When editor's model, and occurrence words.
// Dates come from the server; these only check, shape and word them.
import { describe, expect, it } from "vitest"

import {
  emptySchedule,
  endsNextDay,
  occurrenceLine,
  scheduleErrors,
  scheduleFieldErrors,
  scheduleFromDetail,
  scheduleShape,
  zoneLabel,
  type ScheduleDraft,
} from "@/components/nabalens/knowledge/schedule-detail"

const draft = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  ...emptySchedule(),
  effectiveFrom: "2026-11-15",
  days: ["sun"],
  windows: [{ start: "12:00", end: "15:00" }],
  ...over,
})

describe("schedule model", () => {
  it("needs a start, a day or date, and a time; a last day not before the start", () => {
    expect(scheduleErrors(emptySchedule())).toEqual({
      effectiveFrom: "Choose the day it starts.",
      recurrence: "Choose at least one day.",
      windows: "Enter the times, for example 12:00 to 15:00.",
    })
    expect(scheduleErrors(draft({ effectiveTo: "2026-11-14" }))).toEqual({
      effectiveTo: "Choose a last day on or after the day it starts.",
    })
    expect(
      scheduleErrors(draft({ repeats: "monthly", nth: 1, monthDay: "" }))
        .recurrence
    ).toBe("Choose which week and which day.")
    expect(
      scheduleErrors(
        draft({ repeats: "dated", dates: ["2026-12-01", "2026-12-01"] })
      ).recurrence
    ).toBe("Each date only once.")
    expect(
      scheduleErrors(draft({ windows: [{ start: "12:00", end: "12:00" }] }))
        .windows
    ).toBe("Enter the times, for example 12:00 to 15:00.")
  })

  it("shapes the inline schedule the server checks, with days in week order", () => {
    expect(
      scheduleShape(
        draft({
          days: ["sun", "fri"],
          effectiveTo: "2027-03-28",
          windows: [{ start: "22:00", end: "01:00" }],
        })
      )
    ).toEqual({
      effectiveFrom: "2026-11-15",
      effectiveTo: "2027-03-28",
      recurrence: { kind: "weekly", days: ["fri", "sun"] },
      windows: [{ start: "22:00", end: "01:00" }],
    })
    expect(
      scheduleShape(draft({ repeats: "monthly", nth: -1, monthDay: "thu" }))
        ?.recurrence
    ).toEqual({ kind: "monthly", nth: -1, day: "thu" })
    expect(scheduleShape(emptySchedule())).toBeNull()
  })

  it("says a window at or before its start ends the next day", () => {
    expect(endsNextDay({ start: "22:00", end: "01:00" })).toBe(true)
    expect(endsNextDay({ start: "12:00", end: "15:00" })).toBe(false)
  })

  it("starts a change from the schedule in use, from the chosen day", () => {
    const back = scheduleFromDetail(
      {
        effectiveFrom: "2026-01-04",
        effectiveTo: "2027-06-27",
        recurrence: { kind: "weekly", days: ["sun"] },
        windows: [{ start: "12:00", end: "16:00" }],
      },
      { changeFrom: "2026-11-11" }
    )
    expect(back).toMatchObject({
      effectiveFrom: "2026-11-11",
      effectiveTo: "2027-06-27",
      repeats: "weekly",
      days: ["sun"],
      windows: [{ start: "12:00", end: "16:00" }],
    })
    expect(scheduleFromDetail("junk")).toEqual(emptySchedule())
  })

  it("puts server paths on their part", () => {
    expect(
      scheduleFieldErrors({
        "detail.schedule.windows[1].end": "⟨Time⟩",
        "detail.schedule.recurrence.days": "⟨Days⟩",
        "detail.schedule": "⟨Whole⟩",
        "detail.fees": "⟨Other⟩",
      })
    ).toEqual({ windows: "⟨Time⟩", recurrence: "⟨Days⟩" })
  })
})

describe("occurrence words (§5.3)", () => {
  const zone = "Europe/London"
  it("words a date with its times in the venue's time, and its exception", () => {
    expect(zoneLabel(zone)).toBe("UK time")
    expect(
      occurrenceLine(
        {
          localDate: "2026-11-15",
          startsAt: "2026-11-15T12:00:00.000Z",
          endsAt: "2026-11-15T15:00:00.000Z",
          state: "scheduled",
        },
        zone
      )
    ).toBe("Sunday 15 Nov 2026, 12:00 to 15:00")
    expect(
      occurrenceLine(
        {
          localDate: "2026-11-22",
          startsAt: "2026-11-22T12:00:00.000Z",
          endsAt: "2026-11-22T15:00:00.000Z",
          state: "cancelled",
        },
        zone
      )
    ).toBe("Sunday 22 Nov 2026: cancelled")
    expect(
      occurrenceLine(
        {
          localDate: "2026-11-29",
          startsAt: "2026-11-29T13:00:00.000Z",
          endsAt: "2026-11-29T16:00:00.000Z",
          state: "changed",
        },
        zone
      )
    ).toBe("Sunday 29 Nov 2026, 13:00 to 16:00 (different times)")
  })

  it("says past midnight, and keeps local times across the October change", () => {
    expect(
      occurrenceLine(
        {
          localDate: "2026-10-24",
          startsAt: "2026-10-24T21:00:00.000Z",
          endsAt: "2026-10-25T01:00:00.000Z",
          state: "scheduled",
        },
        zone
      )
    ).toBe("Saturday 24 Oct 2026, 22:00 to 01:00 (ends the next day)")
  })
})
