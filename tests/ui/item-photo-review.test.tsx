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

import {
  ITEM_REVIEW_COPY,
  ItemPhotoReview,
  ItemPhotoSelfReviewList,
  type ItemPhotoHandlers,
} from "@/components/nabalens/menu-photos"
import type { ItemPhotoCandidate } from "@/lib/server/coverage/types"

afterEach(cleanup)
// Pending request ids persist per tab; each test starts with none.
beforeEach(() => window.sessionStorage.clear())

const NOW = "2026-11-07T12:00:00.000Z"
const SOUP = "00000000-0000-4000-8000-0000000000c1"
const PIE = "00000000-0000-4000-8000-0000000000c3"

function candidate(over: Partial<ItemPhotoCandidate> = {}): ItemPhotoCandidate {
  const assetId = over.asset?.id ?? "00000000-0000-4000-8000-0000000000a1"
  return {
    labelId: "00000000-0000-4000-8000-000000000011",
    asset: {
      id: assetId,
      thumbnailUrl: `/api/menu-photos/${assetId}/thumb`,
      previewUrl: `/api/menu-photos/${assetId}/preview`,
      width: 320,
      height: 240,
      available: true,
    },
    uploadedAt: "2026-11-04T12:00:00.000Z",
    labelledAt: "2026-11-04T12:05:00.000Z",
    item: { id: SOUP, name: "Soup", sectionName: "Starters" },
    variant: null,
    variantRemoved: false,
    uploader: { id: "staff-1", displayName: "TEST Sam Lee", active: true },
    self: false,
    photo: null,
    itemRevision: 3,
    ...over,
  }
}

const page = (items: ItemPhotoCandidate[] = [candidate()]) => ({
  items,
  nextCursor: null,
})

function handlers(over: Partial<ItemPhotoHandlers> = {}): ItemPhotoHandlers {
  return {
    review: vi.fn(async (input) => ({
      ok: true as const,
      replayed: false,
      photo: {
        photoId: "00000000-0000-4000-8000-000000000021",
        itemId: input.itemId,
        state:
          input.decision === "accept"
            ? ("accepted" as const)
            : ("better_photo_requested" as const),
        isPrimary: input.makePrimary === true,
        itemRevision: input.expectedRevision + 1,
        selfReview: false,
      },
    })),
    withdraw: vi.fn(async (input) => ({
      ok: true as const,
      replayed: false,
      photo: {
        photoId: input.photoId,
        state: "withdrawn" as const,
        itemRevision: input.expectedRevision + 1,
        newPrimaryPhotoId: null,
      },
    })),
    setPrimary: vi.fn(async (input) => ({
      ok: true as const,
      replayed: false,
      photo: {
        photoId: input.photoId,
        itemRevision: input.expectedRevision + 1,
      },
    })),
    ...over,
  }
}

function renderReview(
  props: Partial<React.ComponentProps<typeof ItemPhotoReview>> = {}
) {
  return render(
    <ItemPhotoReview
      initial={page()}
      venueName="The Railway"
      now={NOW}
      handlers={handlers()}
      {...props}
    />
  )
}

const card = (name = "Soup: photo by TEST Sam Lee") =>
  screen.getByRole("article", { name })

describe("ItemPhotoReview", () => {
  it("shows the dish, variant, upload venue, contributor and waiting age", () => {
    renderReview({
      initial: page([
        candidate({
          variant: {
            variantId: "00000000-0000-4000-8000-0000000000e1",
            name: "Large",
          },
        }),
      ]),
    })
    const c = card()
    expect(within(c).getByText("Soup")).toBeTruthy()
    expect(within(c).getByText("Large")).toBeTruthy()
    expect(within(c).getByText("The Railway")).toBeTruthy()
    expect(within(c).getByText("TEST Sam Lee")).toBeTruthy()
    expect(within(c).getByText(/waiting 3 days$/)).toBeTruthy()
    expect(within(c).getByText(ITEM_REVIEW_COPY.waiting)).toBeTruthy()
    expect(c.querySelector("img")?.getAttribute("src")).toContain(
      "/api/menu-photos/"
    )
  })

  it("offers only Undo for a recheck whose variant left the menu", async () => {
    const user = userEvent.setup()
    const h = handlers()
    renderReview({
      handlers: h,
      initial: page([
        candidate({
          variantRemoved: true,
          photo: {
            id: "00000000-0000-4000-8000-000000000031",
            state: "needs_recheck",
            isPrimary: false,
          },
        }),
      ]),
    })
    const c = card()
    expect(within(c).getByText(ITEM_REVIEW_COPY.variantGone)).toBeTruthy()
    expect(within(c).getByText(ITEM_REVIEW_COPY.variantRemoved)).toBeTruthy()
    expect(
      within(c).queryByRole("button", { name: ITEM_REVIEW_COPY.accept })
    ).toBeNull()
    expect(
      within(c).queryByRole("button", { name: ITEM_REVIEW_COPY.askBetter })
    ).toBeNull()
    await user.click(
      within(c).getByRole("button", { name: ITEM_REVIEW_COPY.undo })
    )
    const dialog = screen.getByRole("dialog")
    await user.type(within(dialog).getByLabelText("Reason"), "No longer served")
    await user.click(
      within(dialog).getByRole("button", { name: ITEM_REVIEW_COPY.undo })
    )
    await waitFor(() => expect(h.withdraw).toHaveBeenCalledTimes(1))
    expect(h.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({
        photoId: "00000000-0000-4000-8000-000000000031",
        expectedRevision: 3,
        reason: "No longer served",
      })
    )
    expect(h.review).not.toHaveBeenCalled()
  })

  it("accepts for the dish with the item revision and a request key", async () => {
    const user = userEvent.setup()
    const h = handlers()
    renderReview({ handlers: h })
    await user.click(
      within(card()).getByRole("checkbox", {
        name: ITEM_REVIEW_COPY.makePrimaryOnAccept,
      })
    )
    await user.click(
      within(card()).getByRole("button", { name: ITEM_REVIEW_COPY.accept })
    )
    expect(h.review).toHaveBeenCalledTimes(1)
    const input = vi.mocked(h.review).mock.calls[0][0]
    expect(input).toMatchObject({
      assetId: candidate().asset.id,
      itemId: SOUP,
      variantId: null,
      decision: "accept",
      expectedRevision: 3,
      makePrimary: true,
    })
    expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(
      await screen.findByText("Accepted for Soup. It's the main photo.")
    ).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("status"))
    )
    expect(within(card()).getByText(ITEM_REVIEW_COPY.accepted)).toBeTruthy()
    expect(within(card()).getByText(ITEM_REVIEW_COPY.primary)).toBeTruthy()
    // Accepted: no second accept; undo is offered instead.
    expect(
      within(card()).queryByRole("button", { name: ITEM_REVIEW_COPY.accept })
    ).toBeNull()
    expect(
      within(card()).getByRole("button", { name: ITEM_REVIEW_COPY.undo })
    ).toBeTruthy()
  })

  it("moves every photo of the dish to the new revision after a decision", async () => {
    const user = userEvent.setup()
    const h = handlers()
    const second = candidate({
      labelId: "00000000-0000-4000-8000-000000000012",
      asset: {
        ...candidate().asset,
        id: "00000000-0000-4000-8000-0000000000a2",
      },
      uploader: { id: "staff-2", displayName: "TEST Priya", active: true },
    })
    renderReview({ handlers: h, initial: page([candidate(), second]) })
    const region = screen.getByRole("region", { name: "Soup" })
    expect(within(region).getAllByRole("article")).toHaveLength(2)
    await user.click(
      within(card()).getByRole("button", { name: ITEM_REVIEW_COPY.accept })
    )
    await screen.findByText("Accepted for Soup.")
    await user.click(
      within(card("Soup: photo by TEST Priya")).getByRole("button", {
        name: ITEM_REVIEW_COPY.accept,
      })
    )
    expect(vi.mocked(h.review).mock.calls[1][0].expectedRevision).toBe(4)
  })

  it("disables every decision while one is saving, so repeated clicks send once", async () => {
    const user = userEvent.setup()
    let resolve!: () => void
    const h = handlers()
    const review = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<ItemPhotoHandlers["review"]>>>(
          (done) => {
            resolve = () =>
              done({
                ok: true,
                replayed: false,
                photo: {
                  photoId: "00000000-0000-4000-8000-000000000021",
                  itemId: SOUP,
                  state: "accepted",
                  isPrimary: false,
                  itemRevision: 4,
                  selfReview: false,
                },
              })
          }
        )
    )
    renderReview({ handlers: { ...h, review } })
    const accept = within(card()).getByRole("button", {
      name: ITEM_REVIEW_COPY.accept,
    })
    await user.click(accept)
    expect(
      within(card()).getByRole("button", { name: "Saving…" })
    ).toHaveProperty("disabled", true)
    expect(
      within(card()).getByRole("button", { name: ITEM_REVIEW_COPY.askBetter })
    ).toHaveProperty("disabled", true)
    await user.click(within(card()).getByRole("button", { name: "Saving…" }))
    expect(review).toHaveBeenCalledTimes(1)
    resolve()
    expect(await screen.findByText("Accepted for Soup.")).toBeTruthy()
  })

  it("reuses the request key when a network failure is retried", async () => {
    const user = userEvent.setup()
    const h = handlers()
    const review = vi
      .fn<ItemPhotoHandlers["review"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(h.review)
    renderReview({ handlers: { ...h, review } })
    const accept = () =>
      within(card()).getByRole("button", { name: ITEM_REVIEW_COPY.accept })
    await user.click(accept())
    // A lost reply: the decision may be saved, so it says it can't confirm.
    expect((await within(card()).findByRole("alert")).textContent).toBe(
      "We couldn't confirm the decision was saved. Check your connection, then try again or refresh to see if it was. The photo won't be reviewed twice."
    )
    await user.click(accept())
    expect(review).toHaveBeenCalledTimes(2)
    expect(review.mock.calls[1][0].requestId).toBe(
      review.mock.calls[0][0].requestId
    )
  })

  it("a refusal shows the server's reason on the card", async () => {
    const user = userEvent.setup()
    const h = handlers()
    renderReview({
      handlers: {
        ...h,
        review: async () => ({
          ok: false,
          code: "invalid_input",
          status: 400,
          message: "This photo can't be accepted for Soup.",
        }),
      },
    })
    await user.click(
      within(card()).getByRole("button", { name: ITEM_REVIEW_COPY.accept })
    )
    expect((await within(card()).findByRole("alert")).textContent).toBe(
      "This photo can't be accepted for Soup."
    )
  })

  it("requires a reason before asking for a better photo", async () => {
    const user = userEvent.setup()
    const h = handlers()
    renderReview({ handlers: h })
    await user.click(
      within(card()).getByRole("button", { name: ITEM_REVIEW_COPY.askBetter })
    )
    const dialog = await screen.findByRole("dialog", {
      name: ITEM_REVIEW_COPY.askBetter,
    })
    await user.click(
      within(dialog).getByRole("button", { name: ITEM_REVIEW_COPY.askBetter })
    )
    expect(
      within(dialog).getByText("Add a reason. Say what a better photo needs.")
    ).toBeTruthy()
    expect(within(dialog).getByLabelText("Reason")).toHaveProperty(
      "ariaInvalid",
      "true"
    )
    expect(h.review).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText("Reason"), "Too dark")
    await user.click(
      within(dialog).getByRole("button", { name: ITEM_REVIEW_COPY.askBetter })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(vi.mocked(h.review).mock.calls[0][0]).toMatchObject({
      decision: "better_photo",
      reason: "Too dark",
      expectedRevision: 3,
    })
    expect(
      await screen.findByText("Asked TEST for a better photo of Soup.")
    ).toBeTruthy()
    expect(
      within(card()).getByText(ITEM_REVIEW_COPY.betterRequested)
    ).toBeTruthy()
  })

  it("requires a reason to undo an acceptance and hands the main photo on", async () => {
    const user = userEvent.setup()
    const primaryId = "00000000-0000-4000-8000-000000000031"
    const otherId = "00000000-0000-4000-8000-000000000032"
    const accepted = candidate({
      photo: { id: primaryId, state: "accepted", isPrimary: true },
    })
    const other = candidate({
      labelId: "00000000-0000-4000-8000-000000000013",
      asset: {
        ...candidate().asset,
        id: "00000000-0000-4000-8000-0000000000a3",
      },
      uploader: { id: "staff-2", displayName: "TEST Priya", active: true },
      photo: { id: otherId, state: "accepted", isPrimary: false },
    })
    const h = handlers({
      withdraw: vi.fn(async (input) => ({
        ok: true as const,
        replayed: false,
        photo: {
          photoId: input.photoId,
          state: "withdrawn" as const,
          itemRevision: 4,
          newPrimaryPhotoId: otherId,
        },
      })),
    })
    renderReview({ handlers: h, initial: page([accepted, other]) })
    // Accepted photos show the milestone words, with no accept button.
    expect(within(card()).getByText("Accepted for menu use")).toBeTruthy()
    await user.click(
      within(card()).getByRole("button", { name: ITEM_REVIEW_COPY.undo })
    )
    const dialog = await screen.findByRole("dialog", {
      name: ITEM_REVIEW_COPY.undo,
    })
    await user.click(
      within(dialog).getByRole("button", { name: ITEM_REVIEW_COPY.undo })
    )
    expect(
      within(dialog).getByText("Add a reason for undoing the acceptance.")
    ).toBeTruthy()
    expect(h.withdraw).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText("Reason"), "Wrong dish")
    await user.click(
      within(dialog).getByRole("button", { name: ITEM_REVIEW_COPY.undo })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(vi.mocked(h.withdraw).mock.calls[0][0]).toMatchObject({
      photoId: primaryId,
      expectedRevision: 3,
      reason: "Wrong dish",
    })
    // Back to waiting; the other accepted photo is the main photo now.
    expect(within(card()).getByText(ITEM_REVIEW_COPY.waiting)).toBeTruthy()
    expect(
      within(card("Soup: photo by TEST Priya")).getByText(
        ITEM_REVIEW_COPY.primary
      )
    ).toBeTruthy()
  })

  it("makes an accepted photo the main photo", async () => {
    const user = userEvent.setup()
    const id = "00000000-0000-4000-8000-000000000041"
    const h = handlers()
    renderReview({
      handlers: h,
      initial: page([
        candidate({ photo: { id, state: "accepted", isPrimary: false } }),
      ]),
    })
    await user.click(
      within(card()).getByRole("button", { name: ITEM_REVIEW_COPY.makePrimary })
    )
    expect(vi.mocked(h.setPrimary).mock.calls[0][0]).toMatchObject({
      photoId: id,
      expectedRevision: 3,
    })
    expect(
      await screen.findByText("This is now the main photo of Soup.")
    ).toBeTruthy()
    expect(
      within(card()).queryByRole("button", {
        name: ITEM_REVIEW_COPY.makePrimary,
      })
    ).toBeNull()
  })

  it("shows the stale-decision message and re-reads after a revision conflict", async () => {
    const user = userEvent.setup()
    const onStale = vi.fn()
    const h = handlers({
      review: vi.fn(async () => ({
        ok: false as const,
        code: "revision_conflict" as const,
        status: 409 as const,
        message: "Changed.",
        currentRevision: 5,
      })),
    })
    renderReview({ handlers: h, onStale })
    await user.click(
      within(card()).getByRole("button", { name: ITEM_REVIEW_COPY.accept })
    )
    expect(
      await screen.findByText(
        "Someone else changed the photos of Soup a moment ago. The latest decisions are shown; check them and try again if you still need to."
      )
    ).toBeTruthy()
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("shows the server's message when a decision no longer applies", async () => {
    const user = userEvent.setup()
    const onStale = vi.fn()
    const message =
      "This photo is not labelled with this menu item. Label it first, then review it."
    const h = handlers({
      review: vi.fn(async () => ({
        ok: false as const,
        code: "state_conflict" as const,
        status: 409 as const,
        message,
      })),
    })
    renderReview({ handlers: h, onStale })
    await user.click(
      within(card()).getByRole("button", { name: ITEM_REVIEW_COPY.askBetter })
    )
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Reason"), "Blurred")
    await user.click(
      within(dialog).getByRole("button", { name: ITEM_REVIEW_COPY.askBetter })
    )
    // The page notice says what happened; the dialog closes.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getByRole("status").textContent).toContain(message)
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("marks the reviewer's own photo as a self-review", async () => {
    const user = userEvent.setup()
    const h = handlers({
      review: vi.fn(async (input) => ({
        ok: true as const,
        replayed: false,
        photo: {
          photoId: "00000000-0000-4000-8000-000000000051",
          itemId: input.itemId,
          state: "accepted" as const,
          isPrimary: false,
          itemRevision: 4,
          selfReview: true,
        },
      })),
    })
    renderReview({
      handlers: h,
      initial: page([
        candidate({
          self: true,
          uploader: { id: "me", displayName: "TEST Manager", active: true },
        }),
      ]),
    })
    const own = card("Soup: photo by TEST Manager")
    expect(within(own).getByText(ITEM_REVIEW_COPY.selfNote)).toBeTruthy()
    await user.click(
      within(own).getByRole("button", { name: ITEM_REVIEW_COPY.accept })
    )
    expect(
      await screen.findByText("Accepted for Soup. Recorded as a self-review.")
    ).toBeTruthy()
  })

  it("groups photos by dish and links each dish to all its photos", () => {
    renderReview({
      initial: page([
        candidate(),
        candidate({
          labelId: "00000000-0000-4000-8000-000000000014",
          item: { id: PIE, name: "Pie", sectionName: "Mains" },
        }),
      ]),
      itemHref: (id) => `/staff/manage/menu/items?item=${id}`,
    })
    const pie = screen.getByRole("region", { name: "Pie" })
    expect(
      within(pie)
        .getByRole("link", { name: ITEM_REVIEW_COPY.allPhotosOfDish })
        .getAttribute("href")
    ).toBe(`/staff/manage/menu/items?item=${PIE}`)
  })

  it("is read-only without handlers and says when nothing waits", () => {
    renderReview({ handlers: undefined })
    expect(
      screen.queryByRole("button", { name: ITEM_REVIEW_COPY.accept })
    ).toBeNull()
    cleanup()
    renderReview({ initial: page([]) })
    expect(screen.getByText(ITEM_REVIEW_COPY.emptyQueue)).toBeTruthy()
  })

  it("says unlabelled photos need labelling by their uploader first", () => {
    expect(ITEM_REVIEW_COPY.labellingNote).toMatch(
      /Unlabelled photos need labelling by their uploader first/
    )
  })
})

describe("ItemPhotoSelfReviewList", () => {
  it("lists item-photo self-reviews with the dish and reason", () => {
    render(
      <ItemPhotoSelfReviewList
        initial={{
          items: [
            {
              eventId: "7",
              photoId: "00000000-0000-4000-8000-000000000061",
              venue: { id: "v", name: "The Railway" },
              author: { id: "m", displayName: "TEST Manager" },
              item: { id: SOUP, name: "Soup", variantName: "Large" },
              decision: "better_photo",
              reason: "Too dark",
              decidedAt: "2026-11-06T10:00:00.000Z",
              asset: candidate().asset,
            },
          ],
          nextCursor: null,
        }}
      />
    )
    const list = screen.getByRole("list", { name: "Our menu self-reviews" })
    expect(within(list).getByText("Self-review")).toBeTruthy()
    expect(
      within(list).getByText(
        /Asked for a better photo of Soup \(Large\) with their own photo at The Railway/
      )
    ).toBeTruthy()
    expect(within(list).getByText("Reason: Too dark")).toBeTruthy()
  })
})
