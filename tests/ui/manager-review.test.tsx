// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/manager/review",
}))

const actions = vi.hoisted(() => ({
  decideMenuPhotoAction: vi.fn(),
  loadReviewPageAction: vi.fn(),
  loadMenuItemsPageAction: vi.fn(),
  loadItemEventsAction: vi.fn(),
}))
vi.mock("@/app/manager/actions", () => actions)

import {
  ReviewCountProvider,
  useReviewCount,
} from "@/components/nabalens/manager/review-count"
import {
  availableActions,
  type ListCard,
} from "@/components/nabalens/manager/review/card-model"
import type { ReviewView } from "@/components/nabalens/manager/review/links"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { ReviewScreen } from "@/components/nabalens/manager/review/review-screen"
import type {
  DecisionOutcome,
  ManagerMenuItem,
  QueueCard,
} from "@/lib/server/menu-photos/types"

afterEach(cleanup)
beforeEach(() => {
  window.sessionStorage.clear()
  vi.clearAllMocks()
})

const NOW = "2026-11-07T12:00:00.000Z"
const SOUP = "00000000-0000-4000-8000-0000000000c1"
const PIE = "00000000-0000-4000-8000-0000000000c2"
const STAFF = "00000000-0000-4000-8000-0000000000f1"
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`

function card(over: Partial<QueueCard> = {}): QueueCard {
  const assetId = over.asset?.assetId ?? id(0xa1)
  return {
    key: id(0x11),
    kind: "labelled",
    labelId: id(0x11),
    photoId: null,
    asset: {
      assetId,
      thumbnailUrl: `/api/menu-photos/${assetId}/thumb`,
      previewUrl: `/api/menu-photos/${assetId}/preview`,
      width: 320,
      height: 240,
    },
    uploadedAt: "2026-11-04T12:00:00.000Z",
    labelledAt: "2026-11-04T12:05:00.000Z",
    contributor: {
      id: STAFF,
      name: "TEST Sam Lee",
      status: "here",
      canFollowUp: true,
    },
    isSelf: false,
    item: {
      itemId: SOUP,
      name: "Soup",
      sectionId: id(0x5),
      sectionName: "Starters",
      variantId: null,
      variantName: null,
      covered: false,
    },
    staffLabels: [
      {
        itemId: SOUP,
        variantId: null,
        itemName: "Soup",
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

const VIEW: ReviewView = {
  status: "pending",
  sectionId: null,
  contributorId: null,
  itemId: null,
}

function renderScreen(
  cards: QueueCard[],
  props: Partial<React.ComponentProps<typeof ReviewScreen>> = {}
) {
  return render(
    <ReviewScreen
      scope={{ kind: "manager" }}
      view={VIEW}
      initial={{ items: cards, nextCursor: null }}
      sections={[{ id: id(0x5), name: "Starters" }]}
      contributors={[{ id: STAFF, name: "TEST Sam Lee" }]}
      showMine={false}
      venueName="The Railway"
      now={NOW}
      {...props}
    />
  )
}

const cardEl = (key: string) => {
  const el = document.querySelector<HTMLElement>(`[data-card-key="${key}"]`)
  if (!el) throw new Error(`no card ${key}`)
  return el
}

function outcome(over: Partial<DecisionOutcome> = {}) {
  return {
    ok: true as const,
    outcome: {
      action: "accept",
      itemId: SOUP,
      itemRevision: 4,
      replayed: false,
      itemCovered: true,
      preferredAssetId: id(0xa1),
      cards: [],
      ...over,
    } satisfies DecisionOutcome,
  }
}

function menuItem(over: Partial<ManagerMenuItem> = {}): ManagerMenuItem {
  return {
    itemId: PIE,
    name: "Pie",
    description: null,
    section: { id: id(0x6), name: "Mains", kind: "food", position: 2 },
    entryPosition: 1,
    variants: [],
    status: "needs_photo",
    hasPendingReplacement: false,
    needsRecheck: false,
    ownWaiting: 0,
    othersWaiting: 0,
    acceptedCount: 0,
    candidateCount: 0,
    preferred: null,
    itemRevision: 9,
    ...over,
  }
}

describe("availableActions (the §4.5 button matrix)", () => {
  const acts = (over: Partial<ListCard>) => availableActions(card(over))

  it("a waiting labelled photo: accept, relink, ask", () => {
    expect(acts({})).toEqual(["accept", "relink", "ask_another"])
  })

  it("adds Accept and set as menu photo when the item is covered", () => {
    expect(acts({ item: { ...card().item!, covered: true } })).toEqual([
      "accept",
      "accept_preferred",
      "relink",
      "ask_another",
    ])
  })

  it("an accepted card never offers Ask for another photo", () => {
    const a = acts({
      state: "accepted",
      photoId: id(0x21),
      kind: "decided",
      basis: "staff_label",
    })
    expect(a).toEqual(["set_preferred", "withdraw"])
    expect(a).not.toContain("ask_another")
  })

  it("the menu photo offers only withdraw", () => {
    expect(
      acts({
        state: "accepted",
        photoId: id(0x21),
        kind: "decided",
        basis: "staff_label",
        isEffectivePrimary: true,
      })
    ).toEqual(["withdraw"])
  })

  it("a variant_removed recheck offers only withdraw", () => {
    expect(
      acts({
        state: "needs_recheck",
        photoId: id(0x21),
        recheckKind: "variant_removed",
        basis: "staff_label",
      })
    ).toEqual(["withdraw"])
  })

  it("a staff-label recheck: accept again, ask, withdraw", () => {
    expect(
      acts({
        state: "needs_recheck",
        photoId: id(0x21),
        recheckKind: "name_changed",
        basis: "staff_label",
      })
    ).toEqual(["reaccept", "ask_another", "withdraw"])
  })

  it("a reviewer-basis recheck: accept again and withdraw, never ask", () => {
    const a = acts({
      kind: "decided",
      labelId: null,
      state: "needs_recheck",
      photoId: id(0x21),
      recheckKind: "name_changed",
      basis: "reviewer",
      correctsItemId: PIE,
    })
    expect(a).toEqual(["reaccept", "withdraw"])
  })

  it("asked for another: accept again from the label, and withdraw", () => {
    expect(
      acts({
        kind: "decided",
        state: "better_photo_requested",
        photoId: id(0x21),
        basis: "staff_label",
      })
    ).toEqual(["accept", "withdraw"])
  })

  it("stale and unlabelled cards offer Choose a menu item", () => {
    expect(acts({ kind: "stale", item: null, itemRevision: 0 })).toEqual([
      "assign_stale",
    ])
    expect(
      acts({ kind: "unlabelled", item: null, staffLabels: [], itemRevision: 0 })
    ).toEqual(["assign_unlabelled"])
  })

  it("an accepted unlabelled match can also be used for another item", () => {
    expect(
      acts({
        kind: "decided",
        state: "accepted",
        photoId: id(0x21),
        basis: "reviewer",
        staffLabels: [],
        isEffectivePrimary: true,
      })
    ).toEqual(["withdraw", "also_assign"])
  })

  it("own photos and settled cards offer nothing", () => {
    expect(acts({ isSelf: true })).toEqual([])
    expect(availableActions({ ...card(), settled: true })).toEqual([])
  })
})

describe("ReviewScreen", () => {
  it("shows a stale card's old label and its Choose a menu item button", () => {
    const stale = card({
      key: id(0xa1),
      kind: "stale",
      labelId: null,
      item: null,
      itemRevision: 0,
      staffLabels: [
        {
          itemId: id(0xd1),
          variantId: null,
          itemName: "Old pie",
          variantName: null,
          onMenu: false,
        },
      ],
    })
    renderScreen([stale], { view: { ...VIEW, status: "stale_label" } })
    const el = cardEl(stale.key)
    expect(
      within(el).getByText("Labelled for Old pie, no longer on the menu")
    ).toBeTruthy()
    expect(
      within(el).getByRole("button", { name: REVIEW_COPY.chooseItem })
    ).toBeTruthy()
    expect(
      within(el).queryByRole("button", { name: REVIEW_COPY.askAnother })
    ).toBeNull()
  })

  it("an own photo shows the note and no actions", () => {
    renderScreen([card({ isSelf: true })])
    const el = cardEl(card().key)
    expect(within(el).getByText(REVIEW_COPY.ownPhoto)).toBeTruthy()
    expect(
      within(el).queryByRole("button", { name: REVIEW_COPY.accept })
    ).toBeNull()
  })

  it("count strings use plural", () => {
    expect(REVIEW_COPY.groupHeading("Soup", 1)).toBe("Soup · 1 photo")
    expect(REVIEW_COPY.groupHeading("Soup", 3)).toBe("Soup · 3 photos")
    expect(REVIEW_COPY.moreOfItem(1, "Soup")).toBe("+1 more photo of Soup")
    expect(REVIEW_COPY.tallies(1, 1, 1)).toBe(
      "1 labelled photo · 1 item accepted · 1 open request"
    )
    expect(REVIEW_COPY.moreLoaded(2)).toBe("2 more photos loaded")
    renderScreen([card({ groupCount: 2 })])
    expect(
      screen.getByRole("heading", { name: "Soup · 3 photos" })
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "+2 more photos of Soup" })
    ).toBeTruthy()
  })

  it.each([
    ["moved", REVIEW_COPY.followUp.moved("TEST Sam Lee")],
    ["left", REVIEW_COPY.followUp.left("TEST Sam Lee")],
    ["manager", REVIEW_COPY.followUp.manager("TEST Sam Lee")],
  ] as const)(
    "warns that a %s contributor can't follow up",
    async (status, text) => {
      const user = userEvent.setup()
      renderScreen([
        card({
          contributor: {
            ...card().contributor,
            status,
            canFollowUp: false,
          },
        }),
      ])
      await user.click(
        screen.getByRole("button", { name: REVIEW_COPY.askAnother })
      )
      expect(within(screen.getByRole("dialog")).getByText(text)).toBeTruthy()
    }
  )

  it("requires a reason to ask for another photo", async () => {
    const user = userEvent.setup()
    renderScreen([card()])
    await user.click(
      screen.getByRole("button", { name: REVIEW_COPY.askAnother })
    )
    const dialog = screen.getByRole("dialog")
    await user.click(
      within(dialog).getByRole("button", { name: REVIEW_COPY.askAnother })
    )
    expect(within(dialog).getByText(REVIEW_COPY.askEmpty)).toBeTruthy()
    expect(actions.decideMenuPhotoAction).not.toHaveBeenCalled()
    await user.type(
      within(dialog).getByLabelText(REVIEW_COPY.askLabel),
      "Show the whole bowl"
    )
    actions.decideMenuPhotoAction.mockResolvedValue(
      outcome({ action: "ask_another", itemCovered: false })
    )
    await user.click(
      within(dialog).getByRole("button", { name: REVIEW_COPY.askAnother })
    )
    await waitFor(() =>
      expect(actions.decideMenuPhotoAction).toHaveBeenCalledTimes(1)
    )
    expect(actions.decideMenuPhotoAction.mock.calls[0][0]).toMatchObject({
      action: "ask_another",
      reason: "Show the whole bowl",
      itemId: SOUP,
      expectedRevision: 3,
    })
    expect(
      await screen.findByText("Asked TEST for another photo of Soup.")
    ).toBeTruthy()
  })

  it("requires a reason to withdraw", async () => {
    const user = userEvent.setup()
    renderScreen([
      card({
        kind: "decided",
        state: "better_photo_requested",
        photoId: id(0x21),
        basis: "staff_label",
      }),
    ])
    await user.click(
      screen.getByRole("button", { name: REVIEW_COPY.moreActions })
    )
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.withdraw }))
    const dialog = screen.getByRole("dialog")
    await user.click(
      within(dialog).getByRole("button", { name: REVIEW_COPY.withdraw })
    )
    expect(within(dialog).getByText(REVIEW_COPY.withdrawEmpty)).toBeTruthy()
    expect(actions.decideMenuPhotoAction).not.toHaveBeenCalled()
  })

  it("relink requires a reason and sends the picked item's revision", async () => {
    const user = userEvent.setup()
    actions.loadMenuItemsPageAction.mockResolvedValue({
      ok: true,
      items: [menuItem()],
      nextCursor: null,
    })
    actions.decideMenuPhotoAction.mockResolvedValue(
      outcome({ action: "relink", itemId: PIE, itemRevision: 10 })
    )
    renderScreen([card()])
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.relink }))
    const dialog = screen.getByRole("dialog")
    await user.click(await within(dialog).findByRole("radio", { name: /Pie/ }))
    await user.click(
      within(dialog).getByRole("button", {
        name: REVIEW_COPY.confirmFor("Pie"),
      })
    )
    expect(within(dialog).getByText(REVIEW_COPY.relinkEmpty)).toBeTruthy()
    expect(actions.decideMenuPhotoAction).not.toHaveBeenCalled()
    await user.type(
      within(dialog).getByLabelText(REVIEW_COPY.relinkLabel),
      "This is the pie"
    )
    await user.click(
      within(dialog).getByRole("button", {
        name: REVIEW_COPY.confirmFor("Pie"),
      })
    )
    await waitFor(() =>
      expect(actions.decideMenuPhotoAction).toHaveBeenCalledTimes(1)
    )
    expect(actions.decideMenuPhotoAction.mock.calls[0][0]).toMatchObject({
      action: "relink",
      itemId: PIE,
      expectedRevision: 9,
      correctsItemId: SOUP,
      correctsVariantId: null,
      reason: "This is the pie",
    })
    expect(await screen.findByText("Moved to Pie and accepted.")).toBeTruthy()
  })

  it("stale assign sends the picked item's revision and the old label", async () => {
    const user = userEvent.setup()
    actions.loadMenuItemsPageAction.mockResolvedValue({
      ok: true,
      items: [menuItem()],
      nextCursor: null,
    })
    actions.decideMenuPhotoAction.mockResolvedValue(
      outcome({ action: "assign_stale", itemId: PIE })
    )
    const stale = card({
      key: id(0xa1),
      kind: "stale",
      labelId: null,
      item: null,
      itemRevision: 0,
      staffLabels: [
        {
          itemId: id(0xd1),
          variantId: null,
          itemName: "Old pie",
          variantName: null,
          onMenu: false,
        },
      ],
    })
    renderScreen([stale], { view: { ...VIEW, status: "stale_label" } })
    await user.click(
      screen.getByRole("button", { name: REVIEW_COPY.chooseItem })
    )
    const dialog = screen.getByRole("dialog")
    await user.click(await within(dialog).findByRole("radio", { name: /Pie/ }))
    await user.click(
      within(dialog).getByRole("button", {
        name: REVIEW_COPY.confirmFor("Pie"),
      })
    )
    await waitFor(() =>
      expect(actions.decideMenuPhotoAction).toHaveBeenCalledTimes(1)
    )
    const [input, view] = actions.decideMenuPhotoAction.mock.calls[0]
    expect(input).toMatchObject({
      action: "assign_stale",
      itemId: PIE,
      expectedRevision: 9,
      correctsItemId: id(0xd1),
    })
    expect(input.reason).toBeUndefined()
    expect(view).toEqual({ status: "stale_label" })
  })

  it("reviewer-row reaccept sends the stored correction", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockResolvedValue(
      outcome({ action: "reaccept" })
    )
    renderScreen(
      [
        card({
          key: id(0x21),
          kind: "decided",
          labelId: null,
          photoId: id(0x21),
          state: "needs_recheck",
          recheckKind: "name_changed",
          basis: "reviewer",
          correctsItemId: PIE,
          correctsVariantId: id(0xe1),
          correctsItemName: "Pie",
        }),
      ],
      { view: { ...VIEW, status: "recheck" } }
    )
    expect(screen.getByText("Moved from Pie")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.reaccept }))
    await waitFor(() =>
      expect(actions.decideMenuPhotoAction).toHaveBeenCalledTimes(1)
    )
    expect(actions.decideMenuPhotoAction.mock.calls[0][0]).toMatchObject({
      action: "reaccept",
      basis: "reviewer",
      itemId: SOUP,
      correctsItemId: PIE,
      correctsVariantId: id(0xe1),
    })
  })

  it("a decision updates the card in place, keeps page 2, announces and moves focus", async () => {
    const user = userEvent.setup()
    const first = card()
    const second = card({
      key: id(0x12),
      labelId: id(0x12),
      asset: { ...card().asset, assetId: id(0xa2) },
      item: { ...card().item!, itemId: PIE, name: "Pie" },
      itemRevision: 7,
    })
    const third = card({
      key: id(0x13),
      labelId: id(0x13),
      asset: { ...card().asset, assetId: id(0xa3) },
      item: { ...card().item!, itemId: id(0xc9), name: "Tart" },
    })
    actions.loadReviewPageAction.mockResolvedValue({
      ok: true,
      items: [third],
      nextCursor: null,
    })
    renderScreen([first, second], {
      initial: { items: [first, second], nextCursor: "next" },
    })
    await user.click(screen.getByRole("button", { name: "Load more" }))
    await waitFor(() => expect(cardEl(third.key)).toBeTruthy())
    expect(actions.loadReviewPageAction.mock.calls[0][0]).toMatchObject({
      status: "pending",
      cursor: "next",
    })

    actions.decideMenuPhotoAction.mockResolvedValue(outcome({ cards: [] }))
    await user.click(
      within(cardEl(first.key)).getByRole("button", {
        name: REVIEW_COPY.accept,
      })
    )
    expect(
      await screen.findByText("Accepted for Soup. Soup now has a photo.")
    ).toBeTruthy()
    // The decided card stays, collapsed with its new state.
    const decided = cardEl(first.key)
    expect(within(decided).getByText(REVIEW_COPY.state.menuPhoto)).toBeTruthy()
    expect(within(decided).getByText(REVIEW_COPY.settled)).toBeTruthy()
    // The other cards, page 2 included, are untouched.
    expect(cardEl(second.key)).toBeTruthy()
    expect(cardEl(third.key)).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(cardEl(second.key)).getByRole("button", {
          name: REVIEW_COPY.accept,
        })
      )
    )
    expect(nav.refresh).not.toHaveBeenCalled()
  })

  it("replaces the item's cards with the fresh ones", async () => {
    const user = userEvent.setup()
    const first = card({ item: { ...card().item!, covered: false } })
    const sibling = card({
      key: id(0x12),
      labelId: id(0x12),
      asset: { ...card().asset, assetId: id(0xa2) },
    })
    actions.decideMenuPhotoAction.mockResolvedValue(
      outcome({
        cards: [
          {
            ...sibling,
            itemRevision: 4,
            item: { ...sibling.item!, covered: true },
          },
        ],
      })
    )
    renderScreen([first, sibling])
    await user.click(
      within(cardEl(first.key)).getByRole("button", {
        name: REVIEW_COPY.accept,
      })
    )
    await screen.findByText("Accepted for Soup. Soup now has a photo.")
    // The sibling now carries the new revision and offers the covered action.
    expect(
      within(cardEl(sibling.key)).getByRole("button", {
        name: REVIEW_COPY.acceptPreferred,
      })
    ).toBeTruthy()
    actions.decideMenuPhotoAction.mockResolvedValue(outcome({ cards: [] }))
    await user.click(
      within(cardEl(sibling.key)).getByRole("button", {
        name: REVIEW_COPY.accept,
      })
    )
    await waitFor(() =>
      expect(actions.decideMenuPhotoAction).toHaveBeenCalledTimes(2)
    )
    expect(
      actions.decideMenuPhotoAction.mock.calls[1][0].expectedRevision
    ).toBe(4)
  })

  it("a revision conflict applies the current cards and warns", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockResolvedValue({
      ok: false,
      code: "revision_conflict",
      message: "stale",
      current: [
        card({
          kind: "decided",
          state: "accepted",
          photoId: id(0x21),
          basis: "staff_label",
          itemRevision: 5,
          isEffectivePrimary: true,
        }),
      ],
    })
    renderScreen([card()])
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.accept }))
    expect(await screen.findByText(REVIEW_COPY.conflict("Soup"))).toBeTruthy()
    const el = cardEl(card().key)
    expect(within(el).getByText(REVIEW_COPY.state.menuPhoto)).toBeTruthy()
    expect(
      within(el).queryByRole("button", { name: REVIEW_COPY.accept })
    ).toBeNull()
  })

  it("a state conflict says so on the card with Refresh", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockResolvedValue({
      ok: false,
      code: "state_conflict",
      message: "This photo was already decided. Reload to see the decision.",
      needsRefresh: true,
    })
    renderScreen([card()])
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.accept }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("already decided")
    await user.click(within(alert).getByRole("button", { name: "Refresh" }))
    expect(nav.refresh).toHaveBeenCalled()
  })

  it("a network failure keeps the request id for the retry", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockRejectedValueOnce(new Error("offline"))
    renderScreen([card()])
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.accept }))
    expect(await screen.findByText(REVIEW_COPY.network)).toBeTruthy()
    actions.decideMenuPhotoAction.mockResolvedValueOnce(outcome())
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.accept }))
    await waitFor(() =>
      expect(actions.decideMenuPhotoAction).toHaveBeenCalledTimes(2)
    )
    const [a, b] = actions.decideMenuPhotoAction.mock.calls
    expect(a[0].requestId).toBeTruthy()
    expect(b[0].requestId).toBe(a[0].requestId)
  })

  it("A1: names a variant as Name (Variant) on the card and in the preview", async () => {
    const user = userEvent.setup()
    const variantId = id(0x7)
    renderScreen([
      card({
        item: { ...card().item!, variantId, variantName: "Chicken" },
        staffLabels: [
          {
            itemId: SOUP,
            variantId,
            itemName: "Soup",
            variantName: "Chicken",
            onMenu: true,
          },
        ],
      }),
    ])
    expect(screen.getByText("Labelled: Soup (Chicken)")).toBeTruthy()
    expect(
      screen.getByRole("heading", { level: 3, name: "Soup (Chicken)" })
    ).toBeTruthy()
    expect(document.body.textContent).not.toContain("· Chicken")
    expect(document.body.textContent).not.toMatch(/Soup ?· ?Chicken/)
    await user.click(
      screen.getByRole("button", {
        name: REVIEW_COPY.openPreview("TEST Sam Lee"),
      })
    )
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/^Soup \(Chicken\) · /)).toBeTruthy()
  })

  it("A2b: a dish with variants labelled without one reads Name (Not specified)", () => {
    renderScreen([
      card({
        staffLabels: [
          {
            itemId: SOUP,
            variantId: null,
            itemName: "Soup",
            variantName: null,
            onMenu: true,
            unspecified: true,
          },
        ],
      }),
    ])
    expect(screen.getByText("Labelled: Soup (Not specified)")).toBeTruthy()
  })

  it("the preview moves with the arrow keys and Esc returns focus", async () => {
    const user = userEvent.setup()
    const second = card({
      key: id(0x12),
      labelId: id(0x12),
      asset: { ...card().asset, assetId: id(0xa2) },
      contributor: { ...card().contributor, name: "TEST Ana Diaz" },
    })
    renderScreen([card(), second])
    const trigger = screen.getByRole("button", {
      name: REVIEW_COPY.openPreview("TEST Sam Lee"),
    })
    await user.click(trigger)
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByRole("heading", { name: "Photo by TEST Sam Lee" })
    ).toBeTruthy()
    expect(
      within(dialog).getByRole("button", { name: REVIEW_COPY.accept })
    ).toBeTruthy()
    await user.keyboard("{ArrowRight}")
    expect(
      within(dialog).getByRole("heading", { name: "Photo by TEST Ana Diaz" })
    ).toBeTruthy()
    await user.keyboard("{ArrowLeft}")
    expect(
      within(dialog).getByRole("heading", { name: "Photo by TEST Sam Lee" })
    ).toBeTruthy()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("the preview takes arrow keys before focus has moved into it", async () => {
    const user = userEvent.setup()
    const second = card({
      key: id(0x12),
      labelId: id(0x12),
      asset: { ...card().asset, assetId: id(0xa2) },
      contributor: { ...card().contributor, name: "TEST Ana Diaz" },
    })
    renderScreen([card(), second])
    await user.click(
      screen.getByRole("button", {
        name: REVIEW_COPY.openPreview("TEST Sam Lee"),
      })
    )
    const dialog = await screen.findByRole("dialog")
    // A key pressed outside the popup (focus still on the opening thumbnail,
    // or on the page) moves the preview all the same.
    fireEvent.keyDown(document.body, { key: "ArrowRight" })
    expect(
      within(dialog).getByRole("heading", { name: "Photo by TEST Ana Diaz" })
    ).toBeTruthy()
    // A field keeps its own arrow keys.
    const field = document.createElement("input")
    document.body.append(field)
    fireEvent.keyDown(field, { key: "ArrowLeft" })
    field.remove()
    expect(
      within(dialog).getByRole("heading", { name: "Photo by TEST Ana Diaz" })
    ).toBeTruthy()
    // Another dialog over the preview owns its keys.
    const other = document.createElement("div")
    other.setAttribute("role", "dialog")
    const inner = document.createElement("button")
    other.append(inner)
    document.body.append(other)
    fireEvent.keyDown(inner, { key: "ArrowLeft" })
    other.remove()
    expect(
      within(dialog).getByRole("heading", { name: "Photo by TEST Ana Diaz" })
    ).toBeTruthy()
  })

  it("filters replace the URL without scrolling", async () => {
    const user = userEvent.setup()
    renderScreen([card()], { showMine: true })
    await user.click(screen.getByRole("button", { name: "Needs a recheck" }))
    expect(nav.replace).toHaveBeenCalledWith("/manager/review?status=recheck", {
      scroll: false,
    })
    expect(screen.getByRole("button", { name: "Your photos" })).toBeTruthy()
  })

  it("hides Your photos without earlier photos waiting, and removes the item chip", async () => {
    const user = userEvent.setup()
    renderScreen([card()], {
      view: { ...VIEW, itemId: SOUP },
      itemName: "Soup",
    })
    expect(screen.queryByRole("button", { name: "Your photos" })).toBeNull()
    await user.click(
      screen.getByRole("button", { name: REVIEW_COPY.removeItemFilter("Soup") })
    )
    expect(nav.replace).toHaveBeenCalledWith("/manager/review", {
      scroll: false,
    })
  })

  it("the badge count settles by one after a decision leaves the queue", async () => {
    const user = userEvent.setup()
    function Badge() {
      return <output aria-label="badge">{useReviewCount().count}</output>
    }
    actions.decideMenuPhotoAction.mockResolvedValue(outcome())
    render(
      <ReviewCountProvider count={2}>
        <Badge />
        <ReviewScreen
          scope={{ kind: "manager" }}
          view={VIEW}
          initial={{ items: [card()], nextCursor: null }}
          sections={[]}
          showMine={false}
          venueName="The Railway"
          now={NOW}
        />
      </ReviewCountProvider>
    )
    expect(screen.getByLabelText("badge").textContent).toBe("2")
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.accept }))
    await waitFor(() =>
      expect(screen.getByLabelText("badge").textContent).toBe("1")
    )
  })

  it("shows the empty state for each status", () => {
    const { rerender } = renderScreen([])
    expect(screen.getByText(REVIEW_COPY.empty.pending)).toBeTruthy()
    expect(
      screen.getByRole("link", { name: REVIEW_COPY.empty.pendingGap })
    ).toBeTruthy()
    const again = (status: ReviewView["status"]) =>
      act(() =>
        rerender(
          <ReviewScreen
            scope={{ kind: "manager" }}
            view={{ ...VIEW, status }}
            initial={{ items: [], nextCursor: null }}
            sections={[]}
            showMine={false}
            venueName="The Railway"
            now={NOW}
          />
        )
      )
    again("recheck")
    expect(screen.getByText(REVIEW_COPY.empty.recheck)).toBeTruthy()
    again("unlabelled")
    expect(
      screen.getByText(REVIEW_COPY.empty.unlabelled("The Railway"))
    ).toBeTruthy()
    again("mine")
    expect(screen.getByText(REVIEW_COPY.empty.mine)).toBeTruthy()
  })
})
