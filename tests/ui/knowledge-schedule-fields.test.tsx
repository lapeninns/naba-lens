// @vitest-environment jsdom
// B03 UI design §5.1, §5.6: the When editor and the server's next dates.
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  emptySchedule,
  scheduleErrors,
  scheduleShape,
  type ScheduleDraft,
} from "@/components/nabalens/knowledge/schedule-detail"
import {
  ScheduleFields,
  SchedulePreview,
} from "@/components/nabalens/knowledge/schedule-fields"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Editor({ onDraft }: { onDraft?: (d: ScheduleDraft) => void }) {
  const [value, setValue] = React.useState(emptySchedule())
  return (
    <ScheduleFields
      id="s"
      value={value}
      onChange={(next) => {
        setValue(next)
        onDraft?.(next)
      }}
      errors={scheduleErrors(value)}
      timezone="Europe/London"
    />
  )
}

describe("When", () => {
  it("names the zone, full day names and past-midnight times", async () => {
    const user = userEvent.setup()
    render(<Editor />)
    expect(screen.getByText("Times are UK time.")).toBeTruthy()
    const days = screen.getByRole("group", { name: "Which days?" })
    expect(within(days).getByRole("checkbox", { name: "Sunday" })).toBeTruthy()
    await user.type(screen.getByLabelText("From"), "22:00")
    await user.type(screen.getByLabelText("To"), "01:00")
    const to = screen.getByLabelText("To")
    const why = document.getElementById(to.getAttribute("aria-describedby")!)
    expect(why?.textContent).toBe("Ends the next day.")
  })

  it("offers a monthly week and day, and dated rows", async () => {
    const user = userEvent.setup()
    const onDraft = vi.fn<(d: ScheduleDraft) => void>()
    render(<Editor onDraft={onDraft} />)
    await user.click(screen.getByRole("radio", { name: "Every month on the" }))
    await user.selectOptions(screen.getByLabelText("Which week"), "Last")
    await user.selectOptions(screen.getByLabelText("Which day"), "Thursday")
    expect(onDraft.mock.lastCall?.[0]).toMatchObject({
      repeats: "monthly",
      nth: -1,
      monthDay: "thu",
    })
    await user.click(screen.getByRole("radio", { name: "Only on these dates" }))
    await user.click(screen.getByRole("button", { name: "Add a date" }))
    expect(screen.getByLabelText("Date 1")).toBeTruthy()
  })
})

describe("next dates preview", () => {
  const schedule = scheduleShape({
    ...emptySchedule(),
    effectiveFrom: "2026-11-15",
    days: ["sun"],
    windows: [{ start: "12:00", end: "15:00" }],
  })!

  it("shows the server's rows exactly, after the last change, and announces the count", async () => {
    vi.useFakeTimers()
    const preview = vi.fn(async () => ({
      ok: true as const,
      occurrences: [
        {
          localDate: "2026-11-15",
          startsAt: "2026-11-15T12:00:00.000Z",
          endsAt: "2026-11-15T15:00:00.000Z",
          state: "scheduled" as const,
        },
        {
          localDate: "2026-11-22",
          startsAt: "2026-11-22T12:00:00.000Z",
          endsAt: "2026-11-22T15:00:00.000Z",
          state: "cancelled" as const,
        },
      ],
    }))
    render(
      <SchedulePreview
        id="p"
        schedule={schedule}
        timezone="Europe/London"
        today="2026-11-10"
        preview={preview}
      />
    )
    expect(preview).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(preview).toHaveBeenCalledTimes(1)
    expect(preview.mock.calls[0]).toEqual([
      {
        schedule,
        timezone: "Europe/London",
        from: "2026-11-15",
        to: "2027-02-14",
      },
    ])
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      ["Sunday 15 Nov 2026, 12:00 to 15:00", "Sunday 22 Nov 2026: cancelled"]
    )
    expect(screen.getByRole("status").textContent).toBe("2 dates shown.")
  })

  it("asks to fix the times while invalid, without a read", () => {
    const preview = vi.fn()
    render(
      <SchedulePreview
        id="p"
        schedule={null}
        timezone="Europe/London"
        today="2026-11-10"
        preview={preview}
      />
    )
    expect(
      screen.getByText("Fix the highlighted times to see the dates.")
    ).toBeTruthy()
    expect(preview).not.toHaveBeenCalled()
  })

  it("says a failed read never stops sending", async () => {
    vi.useFakeTimers()
    render(
      <SchedulePreview
        id="p"
        schedule={schedule}
        timezone="Europe/London"
        today="2026-11-10"
        preview={async () => ({
          ok: false as const,
          code: "unavailable" as const,
          status: 503 as const,
          message: "down",
        })}
      />
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(
      screen.getByText("The dates couldn't be shown. You can still send.")
    ).toBeTruthy()
  })
})
