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

import { ItemWaitingReview } from "@/components/nabalens/manager/menu/item-waiting-review"
import {
  applyCurrent,
  availableActions,
  mergeOutcome,
  ownPhotoBlocked,
  type ListCard,
} from "@/components/nabalens/manager/review/card-model"
import type {
  ReviewScope,
  ReviewView,
} from "@/components/nabalens/manager/review/links"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { ReviewList } from "@/components/nabalens/manager/review/review-list"
import type {
  DecisionOutcome,
  ManagerMenuItem,
  QueueCard,
} from "@/lib/server/menu-photos/types"

afterEach(cleanup)
beforeEach(() => {
  window.sessionStorage.clear()
  vi.clearAllMocks()
  actions.loadMenuItemsPageAction.mockResolvedValue({
    ok: true,
    items: [menuItem()],
    nextCursor: null,
  })
})

const NOW = "2026-11-07T12:00:00.000Z"
const SOUP = "00000000-0000-4000-8000-0000000000c1"
const PIE = "00000000-0000-4000-8000-0000000000c2"
const STAFF = "00000000-0000-4000-8000-0000000000f1"
const VENUE = "00000000-0000-4000-8000-0000000000e1"
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

/** A card of Pie (the relink target). */
function pieCard(n: number, over: Partial<QueueCard> = {}): QueueCard {
  const base = card()
  return card({
    key: id(n),
    labelId: id(n),
    asset: { ...base.asset, assetId: id(n + 0x100) },
    item: { ...base.item!, itemId: PIE, name: "Pie", sectionId: id(0x6) },
    staffLabels: [{ ...base.staffLabels[0], itemId: PIE, itemName: "Pie" }],
    itemRevision: 9,
    ...over,
  })
}

function decision(over: Partial<DecisionOutcome> = {}): DecisionOutcome {
  return {
    action: "accept",
    itemId: SOUP,
    itemRevision: 4,
    replayed: false,
    itemCovered: true,
    preferredAssetId: null,
    cards: [],
    ...over,
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

const VIEW: ReviewView = {
  status: "pending",
  sectionId: null,
  contributorId: null,
  itemId: null,
}

function renderList(
  cards: QueueCard[],
  props: Partial<React.ComponentProps<typeof ReviewList>> = {}
) {
  return render(
    <ReviewList
      initial={{ items: cards, nextCursor: null }}
      view={VIEW}
      scope={{ kind: "manager" }}
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
const hasCard = (key: string) =>
  document.querySelector(`[data-card-key="${key}"]`) !== null

async function relinkToPie(user: ReturnType<typeof userEvent.setup>) {
  const dialog = screen.getByRole("dialog")
  await user.click(await within(dialog).findByRole("radio", { name: /Pie/ }))
  await user.type(
    within(dialog).getByLabelText(REVIEW_COPY.relinkLabel),
    "This is the pie"
  )
  await user.click(
    within(dialog).getByRole("button", { name: REVIEW_COPY.confirmFor("Pie") })
  )
}

describe("mergeOutcome: the corrected item's head", () => {
  it("moves the source item's other loaded cards to its new revision", () => {
    const decided = card()
    const sibling = card({
      key: id(0x12),
      labelId: id(0x12),
      asset: { ...card().asset, assetId: id(0xa2) },
    })
    const pie = pieCard(0x21)
    const next = mergeOutcome(
      [decided, sibling, pie],
      decided,
      "relink",
      decision({
        action: "relink",
        itemId: PIE,
        itemRevision: 10,
        correctsItem: { itemId: SOUP, itemRevision: 4 },
      }),
      () => true,
      "Pie"
    )
    expect(next.map((c) => c.key)).toEqual([decided.key, sibling.key, pie.key])
    expect(next[0].settled).toBe(true)
    // The decided card keeps its old revision; it offers nothing now.
    expect(next[1].itemRevision).toBe(4)
    expect(next[2].itemRevision).toBe(10)
  })

  it("leaves settled cards of the source item alone", () => {
    const decided = card()
    const done: ListCard = {
      ...card({ key: id(0x13), labelId: id(0x13) }),
      settled: true,
    }
    const next = mergeOutcome(
      [decided, done],
      decided,
      "relink",
      decision({
        action: "relink",
        itemId: PIE,
        itemRevision: 10,
        correctsItem: { itemId: SOUP, itemRevision: 4 },
      })
    )
    expect(next[1]).toBe(done)
  })

  it("without a corrected item, other items' cards are untouched", () => {
    const decided = card()
    const pie = pieCard(0x21)
    const next = mergeOutcome(
      [decided, pie],
      decided,
      "accept",
      decision({ correctsItem: null })
    )
    expect(next[1]).toBe(pie)
  })
})

describe("applyCurrent: a revision conflict's re-read", () => {
  // 48 loaded cards of Soup; the re-read's first page holds 24 of them.
  const loaded = Array.from({ length: 48 }, (_, n) =>
    card({
      key: id(0x1000 + n),
      labelId: id(0x1000 + n),
      asset: { ...card().asset, assetId: id(0x2000 + n) },
    })
  )
  const firstPage = loaded.slice(0, 24).map((c) => ({ ...c, itemRevision: 7 }))

  it("keeps the cards beyond a partial page, at the item's new revision", () => {
    const next = applyCurrent(loaded, SOUP, firstPage, () => true, false)
    expect(next.map((c) => c.key)).toEqual(loaded.map((c) => c.key))
    expect(next.some((c) => c.settled)).toBe(false)
    expect(next.slice(0, 24)).toEqual(firstPage)
    for (const c of next.slice(24)) expect(c.itemRevision).toBe(7)
  })

  it("a complete re-read settles the loaded cards it no longer holds", () => {
    const next = applyCurrent(loaded, SOUP, firstPage, () => true, true)
    expect(next.map((c) => c.key)).toEqual(loaded.map((c) => c.key))
    expect(next.slice(0, 24).every((c) => !c.settled)).toBe(true)
    expect(next.slice(24).every((c) => c.settled)).toBe(true)
  })

  it("a failed re-read (nothing back, not complete) leaves the cards as they were", () => {
    const next = applyCurrent(loaded, SOUP, [], () => true, false)
    expect(next).toEqual(loaded)
  })
})

describe("ReviewList: a conflict with more cards than one page", () => {
  it("leaves the cards beyond the returned page undecided", async () => {
    const user = userEvent.setup()
    const loaded = Array.from({ length: 48 }, (_, n) =>
      card({
        key: id(0x1000 + n),
        labelId: id(0x1000 + n),
        asset: { ...card().asset, assetId: id(0x2000 + n) },
      })
    )
    actions.decideMenuPhotoAction.mockResolvedValue({
      ok: false,
      code: "revision_conflict",
      message: "stale",
      current: loaded.slice(0, 24).map((c) => ({ ...c, itemRevision: 7 })),
      currentComplete: false,
    })
    renderList(loaded)
    await user.click(
      within(cardEl(loaded[0].key)).getByRole("button", {
        name: REVIEW_COPY.accept,
      })
    )
    expect(await screen.findByText(REVIEW_COPY.conflict("Soup"))).toBeTruthy()
    const last = cardEl(loaded[47].key)
    expect(
      within(last).getByRole("button", { name: REVIEW_COPY.accept })
    ).toBeTruthy()
    actions.decideMenuPhotoAction.mockResolvedValue({
      ok: false,
      code: "state_conflict",
      message: "stale",
    })
    await user.click(
      within(last).getByRole("button", { name: REVIEW_COPY.accept })
    )
    await waitFor(() =>
      expect(actions.decideMenuPhotoAction).toHaveBeenCalledTimes(2)
    )
    expect(
      actions.decideMenuPhotoAction.mock.calls[1][0].expectedRevision
    ).toBe(7)
  })
})

describe("menu photo flags on loaded cards beyond the fresh page", () => {
  // 30 accepted Soup photos on the Accepted view; the menu photo is the last,
  // beyond the 24 a decision's re-read returns.
  const accepted = (n: number, over: Partial<QueueCard> = {}): ListCard =>
    card({
      key: id(0x3000 + n),
      labelId: id(0x3000 + n),
      photoId: id(0x4000 + n),
      asset: { ...card().asset, assetId: id(0x5000 + n) },
      kind: "decided",
      basis: "staff_label",
      state: "accepted",
      item: { ...card().item!, covered: true },
      groupCount: 29,
      ...over,
    })
  const loaded = Array.from({ length: 30 }, (_, n) =>
    accepted(n, n === 29 ? { isPrimary: true, isEffectivePrimary: true } : {})
  )
  const page = (
    primaryAt: number | null,
    flagged = true,
    over: Partial<QueueCard> = {}
  ) =>
    loaded.slice(0, 24).map((c, n) => ({
      ...c,
      itemRevision: 8,
      isPrimary: flagged && n === primaryAt,
      isEffectivePrimary: n === primaryAt,
      ...over,
    }))

  it("set as menu photo: the old menu photo beyond the page becomes an alternative", () => {
    const next = mergeOutcome(
      loaded,
      loaded[0],
      "set_preferred",
      decision({
        action: "set_preferred",
        itemRevision: 8,
        preferredAssetId: loaded[0].asset.assetId,
        preferredPhotoId: loaded[0].photoId,
        preferredIsFallback: false,
        cards: page(0),
      })
    )
    const old = next[29]
    expect(old.key).toBe(loaded[29].key)
    expect(old.isPrimary).toBe(false)
    expect(old.isEffectivePrimary).toBe(false)
    expect(old.itemRevision).toBe(8)
    expect(availableActions(old)).toContain("set_preferred")
    expect(next[0].isEffectivePrimary).toBe(true)
    // Exactly one menu photo across the loaded list.
    expect(next.filter((c) => c.isEffectivePrimary)).toHaveLength(1)
  })

  it("withdrawing the menu photo: the fallback beyond the page becomes it", () => {
    // Menu photo on the page (card 0) is withdrawn; the earliest accepted
    // remaining (card 25, beyond the page) is the fallback.
    const start = loaded.map((c, n) =>
      n === 0
        ? { ...c, isPrimary: true, isEffectivePrimary: true }
        : { ...c, isPrimary: false, isEffectivePrimary: false }
    )
    const next = mergeOutcome(
      start,
      start[0],
      "withdraw",
      decision({
        action: "withdraw",
        itemRevision: 8,
        preferredAssetId: start[25].asset.assetId,
        preferredPhotoId: start[25].photoId,
        preferredIsFallback: true,
        cards: page(null, false, { groupCount: 28 }).slice(1),
      })
    )
    const fallback = next.find((c) => c.key === start[25].key)!
    expect(fallback.isEffectivePrimary).toBe(true)
    expect(fallback.isPrimary).toBe(false)
    expect(availableActions(fallback)).not.toContain("set_preferred")
    expect(fallback.groupCount).toBe(28)
    const other = next.find((c) => c.key === start[26].key)!
    expect(other.isEffectivePrimary).toBe(false)
    expect(availableActions(other)).toContain("set_preferred")
  })

  it("withdrawing the last accepted photo uncovers the retained cards", () => {
    const next = mergeOutcome(
      loaded,
      loaded[0],
      "withdraw",
      decision({
        action: "withdraw",
        itemRevision: 8,
        itemCovered: false,
        preferredPhotoId: null,
        preferredIsFallback: false,
        cards: [],
      })
    )
    expect(next[29].item?.covered).toBe(false)
    expect(next[29].isEffectivePrimary).toBe(false)
    expect(next[29].isPrimary).toBe(false)
  })

  it("an unknown menu photo (item read failed) holds back Set as menu photo", () => {
    const next = mergeOutcome(
      loaded,
      loaded[0],
      "set_preferred",
      decision({
        action: "set_preferred",
        itemRevision: 8,
        preferredAssetId: null,
        cards: page(0),
      })
    )
    const kept = next[25]
    expect(kept.primaryUnknown).toBe(true)
    expect(kept.itemRevision).toBe(8)
    expect(availableActions(kept)).not.toContain("set_preferred")
    expect(availableActions(kept)).toContain("withdraw")
    // A later decision that knows the menu photo clears the hold.
    const later = mergeOutcome(
      next,
      next[1],
      "set_preferred",
      decision({
        action: "set_preferred",
        itemRevision: 9,
        preferredAssetId: next[1].asset.assetId,
        preferredPhotoId: next[1].photoId,
        preferredIsFallback: false,
        cards: page(1),
      })
    )
    expect(later[25].primaryUnknown).toBe(false)
    expect(availableActions(later[25])).toContain("set_preferred")
    expect(later[29].isEffectivePrimary).toBe(false)
  })

  it("applyCurrent: a re-read showing the menu photo clears the old one beyond the page", () => {
    const next = applyCurrent(loaded, SOUP, page(3), () => true, false)
    expect(next[29].isEffectivePrimary).toBe(false)
    expect(next[29].isPrimary).toBe(false)
    expect(next[29].itemRevision).toBe(8)
    expect(availableActions(next[29])).toContain("set_preferred")
  })

  it("applyCurrent: a re-read without the menu photo marks it unknown", () => {
    const start = loaded.map((c, n) =>
      n === 29 ? { ...c, isPrimary: false, isEffectivePrimary: false } : c
    )
    const next = applyCurrent(start, SOUP, page(null), () => true, false)
    expect(next[29].primaryUnknown).toBe(true)
    expect(availableActions(next[29])).not.toContain("set_preferred")
  })

  it("applyCurrent: an uncovered item has no menu photo", () => {
    const next = applyCurrent(
      loaded,
      SOUP,
      page(null, false, { item: { ...card().item!, covered: false } }),
      () => true,
      false
    )
    expect(next[29].isEffectivePrimary).toBe(false)
    expect(next[29].item?.covered).toBe(false)
    expect(next[29].primaryUnknown).toBe(false)
  })

  it("ReviewList: the old menu photo beyond the page loses its chip", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockResolvedValue({
      ok: true,
      outcome: decision({
        action: "set_preferred",
        itemRevision: 8,
        preferredAssetId: loaded[0].asset.assetId,
        preferredPhotoId: loaded[0].photoId,
        preferredIsFallback: false,
        cards: page(0),
      }),
    })
    renderList(loaded, { view: { ...VIEW, status: "accepted" } })
    const old = cardEl(loaded[29].key)
    expect(within(old).getByText(REVIEW_COPY.state.menuPhoto)).toBeTruthy()
    await user.click(
      within(cardEl(loaded[0].key)).getByRole("button", {
        name: REVIEW_COPY.setPreferred,
      })
    )
    await waitFor(() =>
      expect(
        within(cardEl(loaded[29].key)).queryByText(REVIEW_COPY.state.menuPhoto)
      ).toBeNull()
    )
    expect(
      within(cardEl(loaded[29].key)).getByRole("button", {
        name: REVIEW_COPY.setPreferred,
      })
    ).toBeTruthy()
  })
})

describe("own photos by scope", () => {
  it("managers may not review their own photos; admins may", () => {
    const own = card({ isSelf: true })
    expect(ownPhotoBlocked(own)).toBe(true)
    expect(ownPhotoBlocked(own, "manager")).toBe(true)
    expect(ownPhotoBlocked(own, "admin")).toBe(false)
    expect(availableActions(own)).toEqual([])
    expect(availableActions(own, "manager")).toEqual([])
    expect(availableActions(own, "admin")).toEqual([
      "accept",
      "relink",
      "ask_another",
    ])
    expect(availableActions({ ...own, settled: true }, "admin")).toEqual([])
  })

  it("an admin sees actions on their own photo, labelled You", () => {
    const scope: ReviewScope = { kind: "admin", venueId: VENUE }
    renderList([card({ isSelf: true })], { scope })
    const el = cardEl(card().key)
    expect(within(el).getByText(REVIEW_COPY.you)).toBeTruthy()
    expect(within(el).queryByText(REVIEW_COPY.ownPhoto)).toBeNull()
    expect(
      within(el).getByRole("button", { name: REVIEW_COPY.accept })
    ).toBeTruthy()
  })

  it("a manager still sees the own-photo note and no actions", () => {
    renderList([card({ isSelf: true })])
    const el = cardEl(card().key)
    expect(within(el).getByText(REVIEW_COPY.you)).toBeTruthy()
    expect(within(el).getByText(REVIEW_COPY.ownPhoto)).toBeTruthy()
    expect(
      within(el).queryByRole("button", { name: REVIEW_COPY.accept })
    ).toBeNull()
  })

  it("an admin accepting their own photo sends the venue", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockResolvedValue({
      ok: true,
      outcome: decision(),
    })
    renderList([card({ isSelf: true })], {
      scope: { kind: "admin", venueId: VENUE },
    })
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.accept }))
    await waitFor(() =>
      expect(actions.decideMenuPhotoAction).toHaveBeenCalledTimes(1)
    )
    expect(actions.decideMenuPhotoAction.mock.calls[0][0]).toMatchObject({
      action: "accept",
      venueId: VENUE,
    })
  })
})

describe("ReviewList decisions", () => {
  it("a relink on an item view keeps the target item's other cards out", async () => {
    const user = userEvent.setup()
    const soup = card()
    const moved = pieCard(0x31, {
      asset: soup.asset,
      itemRevision: 10,
      state: "accepted",
      basis: "reviewer",
      correctsItemId: SOUP,
    })
    const otherPie = pieCard(0x32, { itemRevision: 10 })
    actions.decideMenuPhotoAction.mockResolvedValue({
      ok: true,
      outcome: decision({
        action: "relink",
        itemId: PIE,
        itemRevision: 10,
        correctsItem: { itemId: SOUP, itemRevision: 4 },
        cards: [moved, otherPie],
      }),
    })
    renderList([soup], { view: { ...VIEW, itemId: SOUP } })
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.relink }))
    await relinkToPie(user)
    expect(await screen.findByText("Moved to Pie and accepted.")).toBeTruthy()
    expect(hasCard(otherPie.key)).toBe(false)
    expect(hasCard(moved.key)).toBe(false)
    // The decided card settles in place, collapsed.
    expect(
      within(cardEl(soup.key)).queryByRole("button", {
        name: REVIEW_COPY.accept,
      })
    ).toBeNull()
  })

  it("the next decision on the source item sends its bumped revision", async () => {
    const user = userEvent.setup()
    const soup = card()
    const sibling = card({
      key: id(0x12),
      labelId: id(0x12),
      asset: { ...card().asset, assetId: id(0xa2) },
    })
    actions.decideMenuPhotoAction.mockResolvedValueOnce({
      ok: true,
      outcome: decision({
        action: "relink",
        itemId: PIE,
        itemRevision: 10,
        correctsItem: { itemId: SOUP, itemRevision: 4 },
        cards: [],
      }),
    })
    renderList([soup, sibling])
    await user.click(
      within(cardEl(soup.key)).getByRole("button", {
        name: REVIEW_COPY.relink,
      })
    )
    await relinkToPie(user)
    await screen.findByText("Moved to Pie and accepted.")
    actions.decideMenuPhotoAction.mockResolvedValueOnce({
      ok: true,
      outcome: decision({ itemRevision: 5 }),
    })
    await user.click(
      within(cardEl(sibling.key)).getByRole("button", {
        name: REVIEW_COPY.accept,
      })
    )
    await waitFor(() =>
      expect(actions.decideMenuPhotoAction).toHaveBeenCalledTimes(2)
    )
    expect(actions.decideMenuPhotoAction.mock.calls[1][0]).toMatchObject({
      itemId: SOUP,
      expectedRevision: 4,
    })
  })

  it("onDecided runs after a successful decision only", async () => {
    const user = userEvent.setup()
    const onDecided = vi.fn()
    const result = decision()
    actions.decideMenuPhotoAction.mockResolvedValueOnce({
      ok: false,
      code: "state_conflict",
      message: "Out of date",
    })
    renderList([card()], { onDecided })
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.accept }))
    await waitFor(() =>
      expect(actions.decideMenuPhotoAction).toHaveBeenCalledTimes(1)
    )
    expect(onDecided).not.toHaveBeenCalled()
    actions.decideMenuPhotoAction.mockResolvedValueOnce({
      ok: true,
      outcome: result,
    })
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.accept }))
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1))
    expect(onDecided).toHaveBeenCalledWith(result)
  })
})

describe("Item page waiting list", () => {
  it("refreshes the item detail after a decision", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockResolvedValue({
      ok: true,
      outcome: decision(),
    })
    render(
      <ItemWaitingReview
        itemId={SOUP}
        initial={{ items: [card()], nextCursor: null }}
        venueName="The Railway"
        now={NOW}
      />
    )
    // The item page links nowhere else for its own item.
    expect(screen.queryByRole("link", { name: "Soup" })).toBeNull()
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.accept }))
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1))
  })
})
