// @vitest-environment jsdom
// S3-R5 (K3): Venue › Reported changes. Each staff report names what it is
// about, why and who sent it, links to where it is changed, and is dealt
// with or dismissed in place with an optional note.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/app/manager/venue/actions", () => ({
  decideSlotReportAction: vi.fn(),
}))

import { SlotReportsList } from "@/components/nabalens/manager/venue/slot-reports-list"
import type { SlotReport } from "@/lib/staff/slot-reports"

afterEach(cleanup)

const report = (over: Partial<SlotReport>): SlotReport => ({
  id: "r1",
  venueId: "v",
  reporterId: "s1",
  reporterName: "Ana Lee",
  subjectKind: "dish",
  subjectId: "item-1",
  subjectName: "Steak pie",
  reason: "no_longer_served",
  note: null,
  state: "open",
  createdAt: "2026-11-17T10:00:00Z",
  decidedAt: null,
  decisionNote: null,
  ...over,
})

const REPORTS = [
  report({}),
  report({
    id: "r2",
    subjectKind: "photo",
    subjectId: "asset-9",
    subjectName: "Garden",
    reason: "wrong_date",
    note: "Taken last summer",
    reporterName: null,
  }),
]

describe("SlotReportsList", () => {
  it("says what each report is about and links to where it is changed", () => {
    render(
      <SlotReportsList
        label="Reported changes"
        empty="Nothing reported."
        reports={REPORTS}
        onDecide={vi.fn()}
      />
    )
    const list = screen.getByRole("list", { name: "Reported changes" })
    const [pie, garden] = within(list).getAllByRole("listitem")
    expect(pie!.textContent).toContain("Steak pie")
    expect(pie!.textContent).toContain("Dish · It's no longer served")
    expect(pie!.textContent).toContain("Reported by Ana Lee on 17 Nov")
    expect(
      within(pie!)
        .getByRole("link", { name: "Open dish: Steak pie" })
        .getAttribute("href")
    ).toBe("/manager/menu/item-1")
    expect(garden!.textContent).toContain(
      "Photo · The date it was taken is wrong"
    )
    expect(garden!.textContent).toContain("“Taken last summer”")
    expect(garden!.textContent).toContain("Reported by a team member")
    expect(
      within(garden!)
        .getByRole("link", { name: "Open photo: Garden" })
        .getAttribute("href")
    ).toBe("/manager/review/photo/asset-9")
  })

  it("deals with a report in place with its note, and keeps the outcome on screen", async () => {
    const user = userEvent.setup()
    const onDecide = vi.fn(async () => ({ ok: true as const }))
    render(
      <SlotReportsList
        label="Reported changes"
        empty="Nothing reported."
        reports={REPORTS}
        onDecide={onDecide}
      />
    )
    const pie = screen.getAllByRole("listitem")[0]!
    // Dealt with opens the optional note; the confirm button decides.
    expect(within(pie).queryByLabelText(/Note/)).toBeNull()
    await user.click(
      within(pie).getByRole("button", { name: "Dealt with: Steak pie" })
    )
    expect(onDecide).not.toHaveBeenCalled()
    await user.type(within(pie).getByLabelText(/Note/), "  Taken off the menu ")
    await user.click(
      within(pie).getByRole("button", { name: "Mark dealt with: Steak pie" })
    )
    expect(onDecide).toHaveBeenCalledWith({
      reportId: "r1",
      action: "resolved",
      note: "Taken off the menu",
    })
    expect((await within(pie).findByRole("status")).textContent).toBe(
      "Marked as dealt with."
    )
    expect(within(pie).queryByRole("button")).toBeNull()

    const garden = screen.getAllByRole("listitem")[1]!
    await user.click(
      within(garden).getByRole("button", { name: "Dismiss: Garden" })
    )
    await user.click(
      within(garden).getByRole("button", { name: "Dismiss report: Garden" })
    )
    expect(onDecide).toHaveBeenLastCalledWith({
      reportId: "r2",
      action: "dismissed",
      note: undefined,
    })
    expect((await within(garden).findByRole("status")).textContent).toBe(
      "Dismissed. Nothing was changed."
    )
  })

  it("keeps a decided row when the page refreshes without it, and says when nothing was reported", () => {
    const { rerender } = render(
      <SlotReportsList
        label="Reported changes"
        empty="Nothing reported."
        reports={REPORTS}
        onDecide={vi.fn()}
      />
    )
    rerender(
      <SlotReportsList
        label="Reported changes"
        empty="Nothing reported."
        reports={[]}
        onDecide={vi.fn()}
      />
    )
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    cleanup()
    render(
      <SlotReportsList
        label="Reported changes"
        empty="Nothing reported."
        reports={[]}
        onDecide={vi.fn()}
      />
    )
    expect(screen.getByText("Nothing reported.")).toBeTruthy()
    expect(screen.queryByRole("list")).toBeNull()
  })

  it("keeps the buttons and says what went wrong", async () => {
    const user = userEvent.setup()
    render(
      <SlotReportsList
        label="Reported changes"
        empty="Nothing reported."
        reports={[REPORTS[0]!]}
        onDecide={async () => ({
          ok: false,
          message:
            "Someone has already dealt with this report. Reload the page.",
        })}
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Dealt with: Steak pie" })
    )
    await user.click(
      screen.getByRole("button", { name: "Mark dealt with: Steak pie" })
    )
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /already dealt with/
    )
    expect(
      screen.getByRole("button", { name: "Mark dealt with: Steak pie" })
    ).toBeTruthy()
  })
})
