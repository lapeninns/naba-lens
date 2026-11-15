// @vitest-environment jsdom
// G-9: venue-area photos on Review (Accept, "Ask for another photo" with a
// required reason, no actions on the reviewer's own photo) and the staff
// copy, which never says that any photo counts.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
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
// A native select stands in for the Base UI one.
vi.mock("@/components/nabalens/option-select", () => ({
  OptionSelect: ({
    options,
    value,
    emptyLabel,
    onValueChange,
  }: {
    options: { id: string; name: string }[]
    value: string | null
    emptyLabel?: string
    onValueChange: (value: string | null) => void
  }) => (
    <select
      aria-label="Venue area"
      value={value ?? ""}
      onChange={(event) => onValueChange(event.currentTarget.value || null)}
    >
      <option value="">{emptyLabel}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  ),
}))

import { AreaLabelField } from "@/components/nabalens/area-photos/area-label-field"
import { waitFor } from "@testing-library/react"

const BAR = "33333333-3333-4333-8333-333333333333"
const A = "44444444-4444-4444-8444-444444444444"
const B = "55555555-5555-4555-8555-555555555555"
const C = "66666666-6666-4666-8666-666666666666"
const D = "77777777-7777-4777-8777-777777777777"
const GARDEN = "88888888-8888-4888-8888-888888888888"
const area = (assetId: string, subjectId: string, state: string) => ({
  assetId,
  labelId: `l-${assetId}`,
  subjectId,
  label: subjectId === BAR ? "Bar" : "Garden",
  state,
  reason: null,
})

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
      labels: [],
    })
    labelActions.setAreaLabelAction.mockResolvedValue({
      ok: true,
      subjectId: BAR,
    })
    const { rerender } = render(
      <AreaLabelField assetIds={[A]} waitingCount={1} />
    )
    const select = await screen.findByLabelText("Venue area")
    expect(labelActions.setAreaLabelAction).not.toHaveBeenCalled()
    fireEvent.change(select, { target: { value: BAR } })
    await waitFor(() =>
      expect(labelActions.setAreaLabelAction).toHaveBeenCalledWith(A, BAR)
    )
    rerender(<AreaLabelField assetIds={[A, B]} />)
    await waitFor(() =>
      expect(labelActions.setAreaLabelAction).toHaveBeenCalledWith(B, BAR)
    )
    expect(labelActions.setAreaLabelAction).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(AREA_COPY.saved)).toBeTruthy()
  })

  it("never changes any photo's area when a batch with different areas opens (B-1)", async () => {
    labelActions.loadAreaLabelsAction.mockResolvedValue({
      ok: true,
      offered: true,
      places: [
        { subjectId: BAR, kind: "area", label: "Bar" },
        { subjectId: GARDEN, kind: "area", label: "Garden" },
      ],
      labels: [
        area(A, BAR, "pending"),
        area(B, GARDEN, "accepted"),
        // C has no area.
      ],
    })
    const { rerender } = render(<AreaLabelField assetIds={[A, B, C]} />)
    const select = (await screen.findByLabelText(
      "Venue area"
    )) as HTMLSelectElement
    // Starts at No area with a note, never at the first photo's area.
    expect(select.value).toBe("")
    expect(screen.getByText(AREA_COPY.mixed)).toBeTruthy()
    // More photos arriving, and time passing, still save nothing.
    rerender(<AreaLabelField assetIds={[A, B, C, D]} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(labelActions.setAreaLabelAction).not.toHaveBeenCalled()
  })

  it("keeps a shared area selected without saving it again", async () => {
    labelActions.loadAreaLabelsAction.mockResolvedValue({
      ok: true,
      offered: true,
      places: [{ subjectId: BAR, kind: "area", label: "Bar" }],
      labels: [area(A, BAR, "accepted"), area(B, BAR, "pending")],
    })
    render(<AreaLabelField assetIds={[A, B]} />)
    const select = (await screen.findByLabelText(
      "Venue area"
    )) as HTMLSelectElement
    expect(select.value).toBe(BAR)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(labelActions.setAreaLabelAction).not.toHaveBeenCalled()
  })

  it("tells the host which photos were saved with the area, and when it is cleared (note 7)", async () => {
    labelActions.loadAreaLabelsAction.mockResolvedValue({
      ok: true,
      offered: true,
      places: [{ subjectId: BAR, kind: "area", label: "Bar" }],
      labels: [],
    })
    labelActions.setAreaLabelAction.mockResolvedValue({ ok: true })
    const onSaved = vi.fn()
    render(<AreaLabelField assetIds={[A, B]} onSaved={onSaved} />)
    const select = await screen.findByLabelText("Venue area")
    fireEvent.change(select, { target: { value: BAR } })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith([A, B], BAR))
    fireEvent.change(select, { target: { value: "" } })
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith([A, B], null))
  })

  it("Try again resends the same choice after a failed save (S-3)", async () => {
    labelActions.loadAreaLabelsAction.mockResolvedValue({
      ok: true,
      offered: true,
      places: [{ subjectId: BAR, kind: "area", label: "Bar" }],
      labels: [],
    })
    labelActions.setAreaLabelAction
      .mockResolvedValueOnce({ ok: false, code: "unavailable", message: "x" })
      .mockResolvedValue({ ok: true, subjectId: BAR })
    render(<AreaLabelField assetIds={[A]} />)
    fireEvent.change(await screen.findByLabelText("Venue area"), {
      target: { value: BAR },
    })
    const retry = await screen.findByRole("button", {
      name: AREA_COPY.retry,
    })
    fireEvent.click(retry)
    await waitFor(() =>
      expect(labelActions.setAreaLabelAction).toHaveBeenCalledTimes(2)
    )
    expect(labelActions.setAreaLabelAction).toHaveBeenLastCalledWith(A, BAR)
    expect(await screen.findByText(AREA_COPY.saved)).toBeTruthy()
  })
})
