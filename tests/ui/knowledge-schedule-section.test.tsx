// @vitest-environment jsdom
// B03 UI design §5.2, §5.3: Upcoming and a change for one date.
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: nav.refresh }),
}))

import {
  DateChangeControl,
  UpcomingSection,
} from "@/components/nabalens/knowledge/schedule-section"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.sessionStorage.clear()
})

const CHECK = "8a000000-0000-4000-8000-000000000101"
const SCHEDULE = "5c000000-0000-4000-8000-000000000001"

describe("Upcoming", () => {
  it("lists the server's dates in the venue's time, with the zone once", () => {
    render(
      <UpcomingSection
        read={{
          ok: true,
          occurrences: [
            {
              localDate: "2026-11-15",
              startsAt: "2026-11-15T12:00:00.000Z",
              endsAt: "2026-11-15T15:00:00.000Z",
              state: "scheduled",
            },
            {
              localDate: "2026-11-22",
              startsAt: "2026-11-22T12:00:00.000Z",
              endsAt: "2026-11-22T15:00:00.000Z",
              state: "cancelled",
            },
          ],
        }}
        timezone="Europe/London"
        lastDay={null}
        today="2026-11-10"
      />
    )
    expect(screen.getByText("Times are UK time.")).toBeTruthy()
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      ["Sunday 15 Nov 2026, 12:00 to 15:00", "Sunday 22 Nov 2026: cancelled"]
    )
  })

  it("says when there are no dates, or when the last day offered has passed", () => {
    const { rerender } = render(
      <UpcomingSection
        read={{ ok: true, occurrences: [] }}
        timezone="Europe/London"
        lastDay={null}
        today="2026-11-10"
      />
    )
    expect(screen.getByText("No dates in the next 13 weeks.")).toBeTruthy()
    rerender(
      <UpcomingSection
        read={{ ok: true, occurrences: [] }}
        timezone="Europe/London"
        lastDay="2026-11-01"
        today="2026-11-10"
      />
    )
    expect(
      screen.getByText("The last day offered was Sunday 1 Nov 2026.")
    ).toBeTruthy()
  })

  it("offers Try again only when the read may work again", async () => {
    const { rerender } = render(
      <UpcomingSection
        read={{ ok: false, retry: true }}
        timezone="Europe/London"
        lastDay={null}
        today="2026-11-10"
      />
    )
    expect(screen.getByText("Upcoming dates couldn't be loaded.")).toBeTruthy()
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }))
    expect(nav.refresh).toHaveBeenCalled()
    rerender(
      <UpcomingSection
        read={{ ok: false, retry: false }}
        timezone="Europe/London"
        lastDay={null}
        today="2026-11-10"
      />
    )
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })
})

describe("a change for one date", () => {
  const ok = {
    ok: true as const,
    exceptionId: "e1",
    slotRevision: 13,
    replayed: false,
  }

  async function openAndFill(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      screen.getByRole("button", { name: "Add a change for one date" })
    )
    await user.type(screen.getByLabelText("Date"), "2026-11-22")
    await user.click(screen.getByRole("radio", { name: "Different times" }))
    await user.type(screen.getByLabelText("From"), "13:00")
    await user.type(screen.getByLabelText("To"), "16:00")
  }

  it("needs a date and what happens, and sends the schedule in use with a key", async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn(async () => ok)
    render(
      <DateChangeControl
        checkId={CHECK}
        slotRevision={12}
        scheduleId={SCHEDULE}
        onAdd={onAdd}
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Add a change for one date" })
    )
    await user.click(screen.getByRole("button", { name: "Add change" }))
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByText("Choose the date.")).toBeTruthy()
    expect(screen.getByText("Choose what happens on that date.")).toBeTruthy()
    await user.type(screen.getByLabelText("Date"), "2026-11-22")
    await user.click(screen.getByRole("radio", { name: "Different times" }))
    await user.type(screen.getByLabelText("From"), "13:00")
    await user.type(screen.getByLabelText("To"), "16:00")
    await user.click(screen.getByRole("button", { name: "Add change" }))
    expect(onAdd).toHaveBeenCalledWith({
      checkId: CHECK,
      slotRevision: 12,
      scheduleId: SCHEDULE,
      localDate: "2026-11-22",
      kind: "changed_window",
      windows: [{ start: "13:00", end: "16:00" }],
      note: null,
      idempotencyKey: expect.any(String),
    })
    expect(
      await screen.findByText("Sunday 22 Nov 2026: times changed.")
    ).toBeTruthy()
    expect(nav.refresh).toHaveBeenCalled()
  })

  it("keeps the same key after a lost reply, so it's never added twice", async () => {
    const user = userEvent.setup()
    const onAdd = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(ok)
    render(
      <DateChangeControl
        checkId={CHECK}
        slotRevision={12}
        scheduleId={SCHEDULE}
        onAdd={onAdd}
      />
    )
    await openAndFill(user)
    await user.click(screen.getByRole("button", { name: "Add change" }))
    expect(
      await screen.findByText(
        "We couldn't confirm the change was saved. Try again; it won't be added twice."
      )
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Add change" }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2))
    expect(onAdd.mock.calls[1][0].idempotencyKey).toBe(
      onAdd.mock.calls[0][0].idempotencyKey
    )
  })

  it("says the question changed, and offers Reload", async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn(async () => ({
      ok: false as const,
      code: "revision_conflict" as const,
      status: 409 as const,
      message: "conflict",
    }))
    render(
      <DateChangeControl
        checkId={CHECK}
        slotRevision={12}
        scheduleId={SCHEDULE}
        onAdd={onAdd}
      />
    )
    await openAndFill(user)
    await user.click(screen.getByRole("button", { name: "Add change" }))
    expect(
      await screen.findByText(
        "This question changed since you opened it. Nothing was changed. Reload to see the latest."
      )
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy()
  })
})
