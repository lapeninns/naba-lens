// B03 UI design §5: a service's own detail and a fixture showing.
import { describe, expect, it } from "vitest"

import { detailToSend } from "@/components/nabalens/knowledge/detail-form"
import {
  emptyEvent,
  eventDetail,
  eventErrors,
  eventFieldErrors,
} from "@/components/nabalens/knowledge/event-detail"
import { emptyFacility } from "@/components/nabalens/knowledge/facility-detail"
import { emptySchedule } from "@/components/nabalens/knowledge/schedule-detail"
import {
  emptyService,
  serviceErrors,
  serviceFieldErrors,
} from "@/components/nabalens/knowledge/service-detail"

const SKY = {
  code: "sky",
  label: "⟨Broadcaster A⟩",
  needsValue: false,
  valueKind: null,
}
const form = (over: Record<string, unknown> = {}) => ({
  schema: "service" as const,
  timezone: "Europe/London",
  channels: false,
  broadcasters: null,
  ...over,
})
const sunday = {
  ...emptySchedule(),
  effectiveFrom: "2026-11-15",
  days: ["sun" as const],
  windows: [{ start: "12:00", end: "15:00" }],
}

describe("service detail", () => {
  it("keeps When optional, but whole once started", () => {
    const ctx = { channels: false, broadcasters: null }
    expect(serviceErrors(emptyService(), ctx)).toEqual({})
    expect(
      serviceErrors(
        { ...emptyService(), schedule: { ...emptySchedule(), days: ["sun"] } },
        ctx
      )
    ).toMatchObject({ effectiveFrom: "Choose the day it starts." })
  })

  it("sends When with the fields a service shares, never places or how to ask", () => {
    const detail = detailToSend(
      form(),
      {
        service: { ...emptyService(), schedule: sunday },
        facility: {
          ...emptyFacility(),
          locations: [{ label: "⟨Bar⟩" }],
          howToRequest: "⟨Ask⟩",
          fees: { kind: "free", amount: "", unit: "" },
        },
      },
      "yes"
    )
    expect(detail).toEqual({
      schedule: {
        effectiveFrom: "2026-11-15",
        recurrence: { kind: "weekly", days: ["sun"] },
        windows: [{ start: "12:00", end: "15:00" }],
      },
      fees: { kind: "free" },
    })
    expect(
      detailToSend(
        form(),
        { service: { ...emptyService(), schedule: sunday } },
        "no"
      )
    ).toBeNull()
  })

  it("sends how guests order and the subscriptions held only where asked, from the list", () => {
    const parts = {
      service: {
        ...emptyService(),
        channels: [" ⟨phone⟩ ", ""],
        broadcasters: ["sky", "gone"],
      },
    }
    expect(detailToSend(form(), parts, "yes")).toBeNull()
    expect(
      detailToSend(form({ channels: true, broadcasters: [SKY] }), parts, "yes")
    ).toEqual({ channels: ["⟨phone⟩"], broadcasters: ["sky"] })
  })

  it("puts server paths on When and its own fields", () => {
    expect(
      serviceFieldErrors({
        "detail.schedule.windows[0].end": "⟨Time⟩",
        "detail.broadcasters[0]": "⟨List⟩",
      })
    ).toEqual({ windows: "⟨Time⟩", broadcasters: "⟨List⟩" })
  })
})

describe("a fixture showing", () => {
  it("needs the fixture and its date for Yes; times both or neither", () => {
    expect(eventErrors(emptyEvent(), "yes")).toEqual({
      title: "Name the fixture.",
      localDate: "Choose the date.",
    })
    expect(
      eventErrors(
        {
          title: "⟨Fixture⟩",
          localDate: "2026-11-21",
          start: "19:45",
          end: "",
        },
        "yes"
      ).window
    ).toBe("Enter the times, for example 19:45 to 22:00, or leave both empty.")
    expect(eventErrors(emptyEvent(), "no")).toEqual({})
  })

  it("sends one event, trimmed", () => {
    expect(
      eventDetail(
        {
          title: " ⟨Fixture⟩ ",
          localDate: "2026-11-21",
          start: "19:45",
          end: "22:00",
        },
        "yes"
      )
    ).toEqual({
      event: {
        title: "⟨Fixture⟩",
        localDate: "2026-11-21",
        start: "19:45",
        end: "22:00",
      },
    })
    expect(eventDetail(emptyEvent(), "no")).toBeNull()
    expect(eventFieldErrors({ "detail.event.window[0]": "⟨W⟩" })).toEqual({
      window: "⟨W⟩",
    })
  })
})
