// @vitest-environment jsdom
// G-9: venue-area photos on Review (Accept, "Ask for another photo" with a
// required reason, no actions on the reviewer's own photo) and the staff
// copy, which never says that any photo counts.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({ decideAreaPhotoAction: vi.fn() }))
vi.mock("@/app/manager/area-actions", () => actions)

import { AREA_COPY } from "@/components/nabalens/area-photos/copy"
import { AreaReviewList } from "@/components/nabalens/area-photos/area-review-list"
import type { AreaPhotoCard } from "@/lib/server/area-photos"

const card = (over: Partial<AreaPhotoCard> = {}): AreaPhotoCard => ({
  labelId: "11111111-1111-4111-8111-111111111111",
  assetId: "22222222-2222-4222-8222-222222222222",
  authorName: "Priya",
  area: "Garden",
  uploadedAt: "2026-11-14T12:00:00Z",
  labelledAt: "2026-11-14T12:01:00Z",
  creditMonth: "2026-11-01",
  state: "pending",
  reason: null,
  decidedAt: null,
  canDecide: true,
  thumbnailUrl: null,
  previewUrl: null,
  ...over,
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("AreaReviewList", () => {
  it("shows the area, who took it and the month it counts for", () => {
    render(<AreaReviewList initial={[card()]} />)
    const item = screen.getByRole("listitem")
    expect(within(item).getByRole("heading", { name: "Garden" })).toBeTruthy()
    expect(within(item).getByText(/By Priya/)).toBeTruthy()
    expect(within(item).getByText("Counts for November 2026")).toBeTruthy()
    expect(within(item).getByText("Waiting for review")).toBeTruthy()
  })

  it("accepts and shows the new state", async () => {
    actions.decideAreaPhotoAction.mockResolvedValue({
      ok: true,
      state: "accepted",
    })
    render(<AreaReviewList venueId="v" initial={[card()]} />)
    await userEvent.click(screen.getByRole("button", { name: "Accept" }))
    expect(actions.decideAreaPhotoAction).toHaveBeenCalledWith({
      venueId: "v",
      labelId: card().labelId,
      decision: "accepted",
      reason: null,
    })
    expect(await screen.findByText("Accepted")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeTruthy()
  })

  it("asks for another photo only with a reason", async () => {
    actions.decideAreaPhotoAction.mockResolvedValue({
      ok: true,
      state: "needs_another_photo",
    })
    render(<AreaReviewList initial={[card()]} />)
    await userEvent.click(
      screen.getByRole("button", { name: "Ask for another photo" })
    )
    const send = screen.getByRole("button", { name: "Send" })
    expect((send as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(
      screen.getByLabelText("What should the next photo show?"),
      "The whole bar, in daylight"
    )
    await userEvent.click(send)
    expect(actions.decideAreaPhotoAction).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "needs_another_photo",
        reason: "The whole bar, in daylight",
      })
    )
    expect(await screen.findByText("Needs another photo")).toBeTruthy()
    expect(screen.getByText("The whole bar, in daylight")).toBeTruthy()
  })

  it("has no actions on the reviewer's own photo", () => {
    render(<AreaReviewList initial={[card({ canDecide: false })]} />)
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull()
    expect(screen.getByText(AREA_COPY.review.own)).toBeTruthy()
  })

  it("says so when nothing is waiting", () => {
    render(<AreaReviewList initial={[]} />)
    expect(screen.getByText(AREA_COPY.review.empty)).toBeTruthy()
  })
})

describe("area copy", () => {
  it("names what counts, and never says any photo counts", () => {
    expect(AREA_COPY.monthCounts).toBe(
      "Accepted photos you labelled — dishes, drinks and venue areas — and photos you sent to the month, count"
    )
    const all = JSON.stringify(AREA_COPY).toLowerCase()
    expect(all).not.toMatch(/any photo counts|\btask|\bdue\b|overdue/)
  })
})

const labelActions = vi.hoisted(() => ({
  loadAreaLabelsAction: vi.fn(),
  setAreaLabelAction: vi.fn(),
}))
vi.mock("@/app/_labels/area-actions", () => labelActions)

import { AreaLabelField } from "@/components/nabalens/area-photos/area-label-field"
import { waitFor } from "@testing-library/react"

const BAR = "33333333-3333-4333-8333-333333333333"
const A = "44444444-4444-4444-8444-444444444444"
const B = "55555555-5555-4555-8555-555555555555"

describe("AreaLabelField", () => {
  it("offers nothing to an account that earns no month", async () => {
    labelActions.loadAreaLabelsAction.mockResolvedValue({
      ok: true,
      offered: false,
      places: [],
      labels: [],
    })
    const { container } = render(<AreaLabelField assetIds={[A]} />)
    await waitFor(() =>
      expect(labelActions.loadAreaLabelsAction).toHaveBeenCalled()
    )
    expect(container.textContent).toBe("")
  })

  it("says when the venue has no areas listed", async () => {
    labelActions.loadAreaLabelsAction.mockResolvedValue({
      ok: true,
      offered: true,
      places: [],
      labels: [],
    })
    render(<AreaLabelField assetIds={[A]} />)
    expect(await screen.findByText(AREA_COPY.noPlaces)).toBeTruthy()
  })

  it("puts the chosen area on a photo that arrives later in the sheet", async () => {
    labelActions.loadAreaLabelsAction.mockResolvedValue({
      ok: true,
      offered: true,
      places: [{ subjectId: BAR, kind: "area", label: "Bar" }],
      labels: [
        {
          assetId: A,
          labelId: "l",
          subjectId: BAR,
          label: "Bar",
          state: "pending",
          reason: null,
        },
      ],
    })
    labelActions.setAreaLabelAction.mockResolvedValue({
      ok: true,
      subjectId: BAR,
    })
    const { rerender } = render(
      <AreaLabelField assetIds={[A]} waitingCount={1} />
    )
    expect(await screen.findByText(AREA_COPY.fieldLabel)).toBeTruthy()
    expect(labelActions.setAreaLabelAction).not.toHaveBeenCalled()
    rerender(<AreaLabelField assetIds={[A, B]} />)
    await waitFor(() =>
      expect(labelActions.setAreaLabelAction).toHaveBeenCalledWith(B, BAR)
    )
    expect(labelActions.setAreaLabelAction).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(AREA_COPY.saved)).toBeTruthy()
  })
})
