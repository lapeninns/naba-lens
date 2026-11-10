// @vitest-environment jsdom
// B03 UI design §8.2, §8.4, §8.5: withdraw, history paging, answer on a date.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: nav.refresh }),
}))

import {
  AnswerOnDate,
  HistorySection,
  WithdrawControl,
} from "@/components/nabalens/knowledge/corrections"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.sessionStorage.clear()
})

const CHECK = "8a000000-0000-4000-8000-000000000101"

describe("Withdraw the answer", () => {
  it("says what readers lose, needs a reason and sends it keyed", async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn(async () => ({
      ok: true as const,
      decisionId: "d1",
      slotRevision: 13,
      replayed: false,
    }))
    render(
      <>
        <h2 id="status-title">Where it stands</h2>
        <WithdrawControl
          checkId={CHECK}
          slotRevision={12}
          value="Yes"
          onWithdraw={onWithdraw}
          focusId="status-title"
        />
      </>
    )
    await user.click(
      screen.getByRole("button", { name: "Withdraw the answer" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Withdraw this answer?",
    })
    expect(
      within(dialog).getByText(
        "Readers stop getting “Yes” straight away. It stays in the history, and a new finding can become the answer later."
      )
    ).toBeTruthy()
    expect(
      within(dialog).getByText(
        "The person who sent this answer sees your reason."
      )
    ).toBeTruthy()
    await user.type(within(dialog).getByLabelText(/Why\?/), "⟨Reason⟩")
    await user.click(
      within(dialog).getByRole("button", { name: "Withdraw answer" })
    )
    await waitFor(() =>
      expect(onWithdraw).toHaveBeenCalledWith({
        checkId: CHECK,
        slotRevision: 12,
        reason: "⟨Reason⟩",
        idempotencyKey: expect.any(String),
      })
    )
    expect(
      await screen.findByText("Withdrawn. No answer is in use.")
    ).toBeTruthy()
  })

  it("says only a manager account or an admin can withdraw", async () => {
    const user = userEvent.setup()
    render(
      <WithdrawControl
        checkId={CHECK}
        slotRevision={12}
        value="Yes"
        onWithdraw={async () => ({
          ok: false as const,
          code: "not_permitted" as const,
          status: 403 as const,
          message: "no",
        })}
        focusId="x"
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Withdraw the answer" })
    )
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText(/Why\?/), "⟨Reason⟩")
    await user.click(
      within(dialog).getByRole("button", { name: "Withdraw answer" })
    )
    expect(
      await within(dialog).findByText(
        "Only a manager account or an admin can withdraw answers. Nothing was changed."
      )
    ).toBeTruthy()
  })
})

describe("History", () => {
  const line = (eventId: number, kind = "confirmation") => ({
    eventId,
    at: "2026-11-09T10:00:00.000Z",
    kind,
    actor: { id: "m1", name: "⟨Name⟩", basis: "venue_manager" },
    answer: null,
    before: null,
    after: null,
    material: null,
    selectionRule: null,
    reason: null,
  })

  it("lists newest first, notes check dates, and moves focus to the first older line", async () => {
    const user = userEvent.setup()
    const loadOlder = vi.fn(async () => ({
      ok: true as const,
      items: [line(1, "seen")],
      nextCursor: null,
    }))
    render(
      <HistorySection
        checkId={CHECK}
        first={{
          items: [line(2)],
          nextCursor: "2026-11-09T10:00:00.000000Z|2",
        }}
        loadOlder={loadOlder}
        checkDatesApply
      />
    )
    expect(
      screen.getByText(
        "Check dates aren't listed here. Use “See the answer on a date” to see when it was past its check date."
      )
    ).toBeTruthy()
    expect(
      screen.getByText("Confirmed by ⟨Name⟩ (venue manager).")
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Show older" }))
    expect(loadOlder).toHaveBeenCalledWith({
      checkId: CHECK,
      cursor: "2026-11-09T10:00:00.000000Z|2",
    })
    const older = await screen.findByText(
      "Marked as seen by ⟨Name⟩ (venue manager)."
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(older.closest("li"))
    )
    expect(screen.queryByRole("button", { name: "Show older" })).toBeNull()
  })
})

describe("See the answer on a date", () => {
  it("needs a date not in the future, then words the server's snapshot", async () => {
    const user = userEvent.setup()
    const load = vi.fn(async () => ({
      ok: true as const,
      history: { checkId: CHECK, at: "x", answerInUse: null },
    }))
    render(<AnswerOnDate checkId={CHECK} today="2026-11-10" load={load} />)
    await user.click(screen.getByRole("button", { name: "Show" }))
    expect(screen.getByText("Choose the date.")).toBeTruthy()
    await user.type(screen.getByLabelText("Date"), "2026-11-09")
    await user.click(screen.getByRole("button", { name: "Show" }))
    expect(load).toHaveBeenCalledWith({
      checkId: CHECK,
      at: "2026-11-09T23:59:59.000Z",
    })
    expect(
      await screen.findByText("No answer was in use on 9 Nov 2026.")
    ).toBeTruthy()
  })

  it("offers Try again only when the read may work again", async () => {
    const user = userEvent.setup()
    render(
      <AnswerOnDate
        checkId={CHECK}
        today="2026-11-10"
        load={async () => ({
          ok: false as const,
          code: "unavailable" as const,
          status: 503 as const,
          message: "down",
        })}
      />
    )
    await user.type(screen.getByLabelText("Date"), "2026-11-09")
    await user.click(screen.getByRole("button", { name: "Show" }))
    expect(
      await screen.findByText("We couldn't load the answer for that date.")
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })
})
