// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ReviewQueue, type ReviewHandler } from "@/components/nabalens/coverage"

import { MANAGER_ID, STAFF_ID, submission } from "./coverage-fixtures"

afterEach(cleanup)
// Pending request ids persist per tab; each test starts with none.
beforeEach(() => window.sessionStorage.clear())

const page = (items = [submission()]) => ({ items, nextCursor: null })

function reviewed(
  state: "accepted" | "needs_another_photo",
  selfReview = false
) {
  return {
    ok: true as const,
    replayed: false,
    submission: {
      submissionId: submission().id,
      state,
      revision: 2,
      selfReview,
    },
  }
}

describe("ReviewQueue", () => {
  it("accepts with the revision the reviewer saw and a request id", async () => {
    const user = userEvent.setup()
    const onReview = vi.fn<ReviewHandler>(async () => reviewed("accepted"))
    const onStale = vi.fn()
    render(
      <ReviewQueue
        initial={page()}
        viewerId={MANAGER_ID}
        onReview={onReview}
        onStale={onStale}
      />
    )
    const card = screen.getByRole("article", {
      name: "Bar area: photo by TEST Sam",
    })
    expect(within(card).getByText("Submitted")).toBeTruthy()
    expect(
      within(card).getByText(/Counts toward the photographer’s monthly target/)
    ).toBeTruthy()

    await user.click(within(card).getByRole("button", { name: "Accept" }))

    expect(onReview).toHaveBeenCalledTimes(1)
    const input = onReview.mock.calls[0][0]
    expect(input).toMatchObject({
      submissionId: submission().id,
      expectedRevision: 1,
      decision: "accept",
    })
    expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(input).not.toHaveProperty("reason")
    expect(await screen.findByText("Accepted TEST Sam’s photo.")).toBeTruthy()
    // The Accept button is gone, so focus moves to the success notice.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("status"))
    )
    expect(within(card).getByText("Accepted")).toBeTruthy()
    expect(within(card).queryByRole("button", { name: "Accept" })).toBeNull()
    // The action response re-renders the page; no second read on success.
    expect(onStale).not.toHaveBeenCalled()
  })

  it("marks the reviewer's own photo as self-review and allows accepting it", async () => {
    const user = userEvent.setup()
    const own = submission({
      author: { id: MANAGER_ID, displayName: "TEST Manager", active: true },
      submittedById: MANAGER_ID,
    })
    const onReview = vi.fn<ReviewHandler>(async () =>
      reviewed("accepted", true)
    )
    render(
      <ReviewQueue
        initial={page([own])}
        viewerId={MANAGER_ID}
        onReview={onReview}
      />
    )
    expect(
      screen.getByText(/You took this photo. You can review it/)
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(
      await screen.findByText("Accepted your photo (recorded as self-review).")
    ).toBeTruthy()
    expect(screen.getByText("Self-review")).toBeTruthy()
  })

  it("requires a reason before asking for another photo", async () => {
    const user = userEvent.setup()
    const onReview = vi.fn<ReviewHandler>(async () =>
      reviewed("needs_another_photo")
    )
    render(
      <ReviewQueue initial={page()} viewerId={MANAGER_ID} onReview={onReview} />
    )
    await user.click(
      screen.getByRole("button", { name: "Needs another photo" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Ask for another photo",
    })
    await user.click(
      within(dialog).getByRole("button", { name: "Ask for another photo" })
    )
    expect(within(dialog).getByText("Give a reason.")).toBeTruthy()
    expect(onReview).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText("Reason"), "  Too dark  ")
    await user.click(
      within(dialog).getByRole("button", { name: "Ask for another photo" })
    )
    expect(onReview).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "needs_another_photo",
        reason: "Too dark",
        expectedRevision: 1,
      })
    )
    expect(
      await screen.findByText("Asked TEST Sam for another photo.")
    ).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("status"))
    )
  })

  it("reports a stale revision, refreshes and does not overwrite", async () => {
    const user = userEvent.setup()
    const onStale = vi.fn()
    const onReview = vi.fn<ReviewHandler>(async () => ({
      ok: false,
      code: "revision_conflict",
      status: 409,
      message: "This changed while you were looking at it.",
      currentRevision: 2,
    }))
    render(
      <ReviewQueue
        initial={page()}
        viewerId={MANAGER_ID}
        onReview={onReview}
        onStale={onStale}
      />
    )
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(
      await screen.findByText(/Someone else changed this a moment ago/)
    ).toBeTruthy()
    expect(onStale).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("status"))
    )
    // Still undecided here: the refreshed list shows the other decision.
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy()
  })

  it("closes the reason dialog on a conflict and moves focus to the page notice", async () => {
    const user = userEvent.setup()
    const onStale = vi.fn()
    const onReview = vi.fn<ReviewHandler>(async () => ({
      ok: false,
      code: "revision_conflict",
      status: 409,
      message: "This changed while you were looking at it.",
      currentRevision: 2,
    }))
    render(
      <ReviewQueue
        initial={page()}
        viewerId={MANAGER_ID}
        onReview={onReview}
        onStale={onStale}
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Needs another photo" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Ask for another photo",
    })
    await user.type(within(dialog).getByLabelText("Reason"), "Too dark")
    await user.click(
      within(dialog).getByRole("button", { name: "Ask for another photo" })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(onStale).toHaveBeenCalledTimes(1)
    const notice = screen.getByRole("status")
    expect(notice.textContent).toMatch(/Someone else changed this a moment ago/)
    expect(
      screen.getAllByText(/Someone else changed this a moment ago/)
    ).toHaveLength(1)
    expect(screen.queryByRole("alert")).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(notice))

    // Reopening starts clean: no reason or error left from the closed attempt.
    await user.click(
      screen.getByRole("button", { name: "Needs another photo" })
    )
    const reopened = await screen.findByRole("dialog")
    expect(
      (within(reopened).getByLabelText("Reason") as HTMLTextAreaElement).value
    ).toBe("")
    expect(within(reopened).queryByRole("alert")).toBeNull()
  })

  it("keeps the reason dialog open with its error for validation, unavailable and network failures", async () => {
    const user = userEvent.setup()
    const onStale = vi.fn()
    const onReview = vi
      .fn<ReviewHandler>()
      .mockResolvedValueOnce({
        ok: false,
        code: "invalid_input",
        status: 400,
        message: "Check the reason.",
        fieldErrors: { reason: "Use up to 500 characters." },
      })
      .mockResolvedValueOnce({
        ok: false,
        code: "unavailable",
        status: 503,
        message: "Try again shortly.",
      })
      .mockRejectedValueOnce(new Error("offline"))
    render(
      <ReviewQueue
        initial={page()}
        viewerId={MANAGER_ID}
        onReview={onReview}
        onStale={onStale}
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Needs another photo" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Ask for another photo",
    })
    await user.type(within(dialog).getByLabelText("Reason"), "Too dark")
    const confirm = () =>
      within(dialog).getByRole("button", { name: "Ask for another photo" })

    await user.click(confirm())
    expect(
      await within(dialog).findByText("Use up to 500 characters.")
    ).toBeTruthy()
    await user.click(confirm())
    expect(await within(dialog).findByText("Try again shortly.")).toBeTruthy()
    await user.click(confirm())
    expect(
      await within(dialog).findByText(/Could not reach the server/)
    ).toBeTruthy()

    expect(screen.getByRole("dialog")).toBe(dialog)
    expect((confirm() as HTMLButtonElement).disabled).toBe(false)
    expect(onStale).not.toHaveBeenCalled()
  })

  it("retries a failed send with the same request id, and a new intent with a new one", async () => {
    const user = userEvent.setup()
    const onReview = vi
      .fn<ReviewHandler>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: false,
        code: "unavailable",
        status: 503,
        message: "Try again shortly.",
      })
      .mockResolvedValueOnce(reviewed("accepted"))
    render(
      <ReviewQueue initial={page()} viewerId={MANAGER_ID} onReview={onReview} />
    )
    const accept = () => screen.getByRole("button", { name: "Accept" })
    await user.click(accept())
    expect(await screen.findByText(/Could not reach the server/)).toBeTruthy()
    await user.click(accept())
    await user.click(await screen.findByRole("button", { name: "Accept" }))
    const ids = onReview.mock.calls.map(([input]) => input.requestId)
    expect(new Set(ids).size).toBe(1)

    // A different decision on the same photo is a different intent.
    const second = vi.fn<ReviewHandler>(async () => reviewed("accepted"))
    cleanup()
    render(
      <ReviewQueue initial={page()} viewerId={MANAGER_ID} onReview={second} />
    )
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(second.mock.calls[0][0].requestId).not.toBe(ids[0])
  })

  it("is read-only without a review handler and shows decisions with reasons", () => {
    const decided = submission({
      state: "needs_another_photo",
      decision: {
        decision: "needs_another_photo",
        reason: "Too dark",
        decidedAt: "2026-11-03T09:00:00.000Z",
        decidedBy: { id: MANAGER_ID, displayName: "TEST Manager" },
        selfReview: false,
        lateAcceptance: false,
      },
    })
    render(<ReviewQueue initial={page([decided])} viewerId={STAFF_ID} />)
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull()
    expect(screen.getByText("Reason: Too dark")).toBeTruthy()
    expect(screen.getByText(/Needs another photo by TEST Manager/)).toBeTruthy()
  })

  it("never offers a decision on a photo that was deleted", () => {
    const removed = submission({
      asset: { ...submission().asset, available: false },
    })
    render(
      <ReviewQueue
        initial={page([removed])}
        viewerId={MANAGER_ID}
        onReview={vi.fn()}
      />
    )
    expect(screen.getByText("Photo removed")).toBeTruthy()
    expect(screen.getByText("Preview unavailable")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Needs another photo" })
    ).toBeTruthy()
  })

  it("shows coverage-only photos as such", () => {
    render(
      <ReviewQueue
        initial={page([
          submission({ countsTowardMonthly: false, uploadedPeriod: "2026-09" }),
          submission({
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            origin: "attached",
            countsTowardMonthly: false,
            submittedById: MANAGER_ID,
          }),
        ])}
        viewerId={MANAGER_ID}
      />
    )
    expect(
      screen.getByText("Venue coverage only (uploaded in an earlier month)")
    ).toBeTruthy()
    expect(
      screen.getByText("Attached by a manager: venue coverage only")
    ).toBeTruthy()
  })
})
