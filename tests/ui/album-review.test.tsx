// @vitest-environment jsdom
// Album AL-3: Review in a thumb (DESIGN.md §6.5). One waiting photo on the
// stage, Accept or Ask again with a reason chip, then the next; the existing
// decision actions do the deciding, and nobody reviews their own photo.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/manager/review",
}))

const actions = vi.hoisted(() => ({
  decideMenuPhotoAction: vi.fn(),
  loadReviewPageAction: vi.fn(),
  loadMenuItemsPageAction: vi.fn(),
  loadItemEventsAction: vi.fn(),
}))
vi.mock("@/app/manager/actions", () => actions)
const areaActions = vi.hoisted(() => ({
  decideAreaPhotoAction: vi.fn(),
  loadAreaReviewAction: vi.fn(),
}))
vi.mock("@/app/manager/area-actions", () => areaActions)

import { ALBUM_REVIEW_COPY as C } from "@/components/nabalens/album/review/copy"
import {
  ThumbReview,
  type ThumbReviewProps,
} from "@/components/nabalens/album/review/thumb-review"
import type { AreaPhotoCard } from "@/lib/server/area-photos"
import type { QueueCard } from "@/lib/server/menu-photos/types"

afterEach(cleanup)
beforeEach(() => {
  window.sessionStorage.clear()
  vi.clearAllMocks()
})

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const SOUP = id(0xc1)
const PIE = id(0xc2)
const STARTERS = id(0x5)
const GARDEN_LABEL = id(0x71)

function dish(
  n: number,
  over: Partial<QueueCard> = {},
  item: { itemId: string; name: string } = { itemId: SOUP, name: "Soup" }
): QueueCard {
  const assetId = id(0xa00 + n)
  return {
    key: id(0x100 + n),
    kind: "labelled",
    labelId: id(0x100 + n),
    photoId: null,
    asset: {
      assetId,
      thumbnailUrl: `/api/menu-photos/${assetId}/thumb`,
      previewUrl: `/api/menu-photos/${assetId}/preview`,
      width: 320,
      height: 240,
    },
    uploadedAt: `2026-11-04T1${n}:00:00.000Z`,
    labelledAt: `2026-11-04T1${n}:05:00.000Z`,
    contributor: {
      id: id(0xf1),
      name: "TEST Sam Lee",
      status: "here",
      canFollowUp: true,
    },
    isSelf: false,
    item: {
      itemId: item.itemId,
      name: item.name,
      sectionId: STARTERS,
      sectionName: "Starters",
      variantId: null,
      variantName: null,
      covered: false,
    },
    staffLabels: [
      {
        itemId: item.itemId,
        variantId: null,
        itemName: item.name,
        variantName: null,
        onMenu: true,
      },
    ],
    state: null,
    isPrimary: false,
    isEffectivePrimary: false,
    basis: null,
    reason: null,
    recheckKind: null,
    correctsItemId: null,
    correctsVariantId: null,
    correctsItemName: null,
    itemRevision: 3,
    groupCount: 0,
    ...over,
  }
}

function area(over: Partial<AreaPhotoCard> = {}): AreaPhotoCard {
  return {
    labelId: GARDEN_LABEL,
    assetId: id(0xb1),
    authorName: "TEST Ana Park",
    area: "Beer garden",
    uploadedAt: "2026-11-04T18:00:00.000Z",
    labelledAt: "2026-11-04T18:01:00.000Z",
    creditMonth: "2026-11-01",
    state: "pending",
    reason: null,
    decidedAt: null,
    canDecide: true,
    thumbnailUrl: `/api/area-photos/${id(0xb1)}/thumb`,
    previewUrl: `/api/area-photos/${id(0xb1)}/preview`,
    ...over,
  }
}

function renderReview(over: Partial<ThumbReviewProps> = {}) {
  const props: ThumbReviewProps = {
    venueName: "The Railway",
    menuCards: [dish(1)],
    menuCursor: null,
    areaCards: [],
    total: 1,
    context: {
      sectionPlace: { [STARTERS]: "Kitchen pass" },
      sectionBrief: {},
      itemBrief: { [SOUP]: "The bowl from above, steam showing" },
    },
    listHref: "/manager/review?view=list",
    ...over,
  }
  return render(<ThumbReview {...props} />)
}

const accepted = (itemId = SOUP, itemRevision = 4) => ({
  ok: true as const,
  outcome: {
    action: "accept",
    itemId,
    itemRevision,
    replayed: false,
    itemCovered: true,
    preferredAssetId: null,
    cards: [],
  },
})

describe("Review in a thumb", () => {
  it("titles the page with the queue count and shows one photo with its slot, brief, author, time and place", () => {
    renderReview({
      menuCards: [dish(1), dish(2, {}, { itemId: PIE, name: "Pie" })],
      total: 2,
    })
    expect(
      screen.getByRole("heading", { level: 1, name: "2 photos to review" })
    ).toBeTruthy()
    expect(screen.getByText("The Railway")).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: "Soup" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Pie" })).toBeNull()
    expect(screen.getByText("The bowl from above, steam showing")).toBeTruthy()
    expect(
      screen.getByText("By TEST Sam Lee · 4 Nov, 11:05 · Kitchen pass")
    ).toBeTruthy()
    expect(
      screen.getByRole("img", { name: "Soup, photo by TEST Sam Lee" })
    ).toBeTruthy()
    // Ask again (secondary) and Accept (main), in that order.
    const buttons = screen
      .getAllByRole("button")
      .map((b) => b.textContent?.trim())
    expect(buttons).toEqual(["Ask again", "Accept"])
    expect(screen.getByRole("button", { name: "Accept" }).dataset.variant).toBe(
      "primary"
    )
  })

  it("Accept sends the existing accept decision and brings up the next photo", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockResolvedValue(accepted(SOUP, 4))
    renderReview({ menuCards: [dish(1), dish(2)], total: 2 })
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(actions.decideMenuPhotoAction).toHaveBeenCalledTimes(1)
    const [payload, view] = actions.decideMenuPhotoAction.mock.calls[0]!
    expect(payload).toMatchObject({
      action: "accept",
      assetId: id(0xa01),
      itemId: SOUP,
      variantId: null,
      expectedRevision: 3,
    })
    expect(payload.requestId).toEqual(expect.any(String))
    expect(view).toEqual({ status: "pending" })
    expect(
      screen.getByRole("heading", { level: 1, name: "1 photo to review" })
    ).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe("Soup is in the album.")
    // The second photo of the same dish now carries the dish's new revision.
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(actions.decideMenuPhotoAction.mock.calls[1]![0]).toMatchObject({
      assetId: id(0xa02),
      expectedRevision: 4,
    })
    expect(
      screen.getByRole("heading", { level: 1, name: "Nothing to review" })
    ).toBeTruthy()
  })

  it("Ask again shows the reason chips; choosing one sends the decision with that reason", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockResolvedValue({
      ...accepted(),
      outcome: { ...accepted().outcome, action: "ask_another" },
    })
    renderReview({
      menuCards: [dish(1), dish(2, {}, { itemId: PIE, name: "Pie" })],
      total: 2,
    })
    await user.click(screen.getByRole("button", { name: "Ask again" }))
    const group = screen.getByRole("group", { name: C.reasonsHeading })
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual([
      "Too dark",
      "Out of focus",
      "Wrong item",
      "Show more of it",
      "Messy background",
      "Other",
      "Cancel",
    ])
    await user.click(within(group).getByRole("button", { name: "Too dark" }))
    expect(actions.decideMenuPhotoAction.mock.calls[0]![0]).toMatchObject({
      action: "ask_another",
      assetId: id(0xa01),
      itemId: SOUP,
      reason: "Too dark",
    })
    expect(screen.getByRole("heading", { level: 2, name: "Pie" })).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe(
      "Asked again for Soup: Too dark."
    )
    // The bar is back for the next photo.
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy()
  })

  it("Other asks for words and sends them as the reason", async () => {
    const user = userEvent.setup()
    areaActions.decideAreaPhotoAction.mockResolvedValue({
      ok: true,
      state: "needs_another_photo",
    })
    renderReview({ menuCards: [], areaCards: [area()], total: 1 })
    expect(
      screen.getByRole("heading", { level: 2, name: "Beer garden" })
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Ask again" }))
    await user.click(screen.getByRole("button", { name: "Other" }))
    const field = screen.getByRole("textbox", { name: C.otherLabel })
    // Empty words are not sent.
    await user.click(screen.getByRole("button", { name: C.otherSend }))
    expect(areaActions.decideAreaPhotoAction).not.toHaveBeenCalled()
    expect(screen.getByText(C.otherEmpty)).toBeTruthy()
    await user.type(field, "  Show the   heaters too ")
    await user.click(screen.getByRole("button", { name: C.otherSend }))
    expect(areaActions.decideAreaPhotoAction).toHaveBeenCalledWith({
      labelId: GARDEN_LABEL,
      decision: "needs_another_photo",
      reason: "Show the heaters too",
    })
    expect(
      screen.getByRole("heading", { level: 1, name: "Nothing to review" })
    ).toBeTruthy()
  })

  it("Accept on an area photo sends the area decision", async () => {
    const user = userEvent.setup()
    areaActions.decideAreaPhotoAction.mockResolvedValue({
      ok: true,
      state: "accepted",
    })
    renderReview({ menuCards: [], areaCards: [area()], total: 1 })
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(areaActions.decideAreaPhotoAction).toHaveBeenCalledWith({
      labelId: GARDEN_LABEL,
      decision: "accepted",
      reason: null,
    })
    expect(screen.getByRole("status").textContent).toBe(
      "Beer garden is in the album."
    )
  })

  it("never puts the reviewer's own photo on the stage", () => {
    renderReview({
      menuCards: [dish(1, { isSelf: true })],
      areaCards: [area({ canDecide: false })],
      total: 0,
    })
    expect(
      screen.getByRole("heading", { level: 1, name: "Nothing to review" })
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull()
    expect(screen.getByText(C.own(2))).toBeTruthy()
  })

  it("a refusal for the reviewer's own photo is written beside it, with no decision left to make", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockResolvedValue({
      ok: false,
      code: "not_permitted",
      status: 403,
      message: "This is your photo. Another reviewer decides on it.",
    })
    renderReview({
      menuCards: [dish(1), dish(2, {}, { itemId: PIE, name: "Pie" })],
      total: 2,
    })
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(screen.getByRole("alert").textContent).toContain(
      "This is your photo. Another reviewer decides on it."
    )
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Ask again" })).toBeNull()
    await user.click(screen.getByRole("button", { name: C.next }))
    expect(screen.getByRole("heading", { level: 2, name: "Pie" })).toBeTruthy()
    expect(screen.getByText(C.own(1))).toBeTruthy()
  })

  it("an empty queue says so and links to the full list", () => {
    renderReview({ menuCards: [], areaCards: [], total: 0 })
    expect(
      screen.getByRole("heading", { level: 1, name: "Nothing to review" })
    ).toBeTruthy()
    expect(screen.getByText(C.emptyTitle)).toBeTruthy()
    expect(
      screen.getByRole("link", { name: C.allPhotos }).getAttribute("href")
    ).toBe("/manager/review?view=list")
  })

  it("loads the next menu page as the stage runs low", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockResolvedValue(accepted())
    actions.loadReviewPageAction.mockResolvedValue({
      ok: true,
      items: [dish(3, {}, { itemId: PIE, name: "Pie" })],
      nextCursor: null,
    })
    renderReview({ menuCards: [dish(1)], menuCursor: "next", total: 2 })
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(actions.loadReviewPageAction).toHaveBeenCalledWith({
      status: "pending",
      cursor: "next",
    })
    expect(
      await screen.findByRole("heading", { level: 2, name: "Pie" })
    ).toBeTruthy()
  })

  it("with a full area page, re-reads the area queue as the stage runs low and brings only unseen photos", async () => {
    const user = userEvent.setup()
    areaActions.decideAreaPhotoAction.mockResolvedValue({
      ok: true,
      state: "accepted",
    })
    const bar = area({
      labelId: id(0x72),
      assetId: id(0xb2),
      area: "Bar",
      labelledAt: "2026-11-04T19:00:00.000Z",
    })
    // The re-read still holds the first photo (another tab, a slow write);
    // it is not shown twice.
    areaActions.loadAreaReviewAction.mockResolvedValue({
      ok: true,
      cards: [area(), bar],
      more: false,
    })
    renderReview({
      menuCards: [],
      areaCards: [area()],
      areaMore: true,
      total: 1,
    })
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(areaActions.loadAreaReviewAction).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByRole("heading", { level: 2, name: "Bar" })
    ).toBeTruthy()
    // The title counts the photo the re-read brought.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      C.title(1)
    )
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(await screen.findByText(C.emptyTitle)).toBeTruthy()
    expect(areaActions.loadAreaReviewAction).toHaveBeenCalledTimes(1)
  })

  it("without a full area page, never re-reads the area queue", async () => {
    const user = userEvent.setup()
    areaActions.decideAreaPhotoAction.mockResolvedValue({
      ok: true,
      state: "accepted",
    })
    renderReview({ menuCards: [], areaCards: [area()], total: 1 })
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(screen.getByText(C.emptyTitle)).toBeTruthy()
    expect(areaActions.loadAreaReviewAction).not.toHaveBeenCalled()
  })

  it("a lost reply keeps the photo and its choice on the stage", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockRejectedValue(new Error("offline"))
    renderReview()
    await user.click(screen.getByRole("button", { name: "Accept" }))
    expect(screen.getByRole("alert").textContent).toContain(
      "That decision wasn't sent"
    )
    expect(screen.getByRole("heading", { level: 2, name: "Soup" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy()
  })

  it("uses Album's words: Accept and Ask again, never approve or reject", () => {
    renderReview({ areaCards: [area()], total: 2 })
    const text = document.body.textContent ?? ""
    expect(text).not.toMatch(/approve|reject|pending|upload/i)
    for (const word of Object.values(C))
      if (typeof word === "string")
        expect(word).not.toMatch(/approve|reject|pending|upload|!/i)
  })
})
