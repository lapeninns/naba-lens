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
// Contribution sets (B02-05) are off here: the cards show as before.
vi.mock("@/app/_media/actions", () => ({
  readPhotoSets: vi.fn(async () => ({ status: "missing" })),
}))
vi.mock("@/app/manager/actions", () => actions)

import { ItemWaitingReview } from "@/components/nabalens/manager/menu/item-waiting-review"
import {
  applyCurrent,
  availableActions,
  mergeOutcome,
  ownPhotoBlocked,
  staysInView,
  type CardAction,
  type ListCard,
} from "@/components/nabalens/manager/review/card-model"
import type {
  ReviewScope,
  ReviewView,
} from "@/components/nabalens/manager/review/links"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { ReviewList } from "@/components/nabalens/manager/review/review-list"
import type {
  DecisionAction,
  DecisionOutcome,
  ManagerMenuItem,
  PhotoState,
  QueueCard,
  QueueStatus,
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

describe("a decision after the manager's access ended", () => {
  const WORKSPACE_REFUSED =
    "You do not have access to this venue's workspace. Reload the page."

  it.each(["not_permitted", "wrong_venue", "account_inactive"])(
    "%s says so on the card and offers Refresh, which re-renders the workspace",
    async (code) => {
      const user = userEvent.setup()
      actions.decideMenuPhotoAction.mockResolvedValueOnce({
        ok: false,
        code,
        status: 403,
        message: WORKSPACE_REFUSED,
      })
      renderList([card()])
      await user.click(screen.getByRole("button", { name: REVIEW_COPY.accept }))
      const alert = await within(cardEl(card().key)).findByRole("alert")
      expect(alert.textContent).toContain(WORKSPACE_REFUSED)
      expect(nav.refresh).not.toHaveBeenCalled()
      await user.click(
        within(alert).getByRole("button", { name: REVIEW_COPY.refresh })
      )
      expect(nav.refresh).toHaveBeenCalledTimes(1)
    }
  )

  it("keeps the admin's refusal as a plain card error", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockResolvedValueOnce({
      ok: false,
      code: "not_permitted",
      status: 403,
      message: "Not allowed.",
    })
    renderList([card()], { scope: { kind: "admin", venueId: id(0xb1) } })
    await user.click(screen.getByRole("button", { name: REVIEW_COPY.accept }))
    const alert = await within(cardEl(card().key)).findByRole("alert")
    expect(alert.textContent).toContain("Not allowed.")
    expect(
      within(alert).queryByRole("button", { name: REVIEW_COPY.refresh })
    ).toBeNull()
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

describe("the decided card and the retained cards: decision x view x page", () => {
  // Every decision a card offers, on every view, with the item's cards on one
  // page (complete) or more (the decided card beyond the first 24). The server
  // returns the decided photo's row wherever it sits ("known"), or could not
  // read past the first page ("unknown"): then the action alone decides, and
  // absence from the page never means the card left.
  type Variant = { status: QueueStatus; name: string; make: CardFor }
  type CardFor = (n: number) => QueueCard
  const base = (n: number, over: Partial<QueueCard> = {}): QueueCard =>
    card({
      key: id(0x6000 + n),
      labelId: id(0x6000 + n),
      asset: { ...card().asset, assetId: id(0x7000 + n) },
      item: { ...card().item!, covered: true },
      groupCount: 0,
      ...over,
    })
  const decidedRow = (n: number, state: PhotoState): Partial<QueueCard> => ({
    kind: "decided",
    key: id(0x8000 + n),
    labelId: null,
    photoId: id(0x8000 + n),
    basis: "staff_label",
    state,
  })
  const variants: Variant[] = [
    { status: "pending", name: "waiting", make: (n) => base(n) },
    {
      status: "mine",
      name: "own (admin)",
      make: (n) => base(n, { isSelf: true }),
    },
    {
      status: "recheck",
      name: "staff-label recheck",
      make: (n) =>
        base(n, {
          ...decidedRow(n, "needs_recheck"),
          kind: "labelled",
          labelId: id(0x6000 + n),
          recheckKind: "name_changed",
        }),
    },
    {
      status: "needs_another_photo",
      name: "asked for another",
      make: (n) => base(n, decidedRow(n, "better_photo_requested")),
    },
    {
      status: "accepted",
      name: "reviewer-matched accepted",
      make: (n) =>
        base(n, {
          ...decidedRow(n, "accepted"),
          basis: "reviewer",
          staffLabels: [],
        }),
    },
    {
      status: "stale_label",
      name: "stale label",
      make: (n) =>
        base(n, {
          kind: "stale",
          item: null,
          itemRevision: 0,
          staffLabels: [{ ...card().staffLabels[0], onMenu: false }],
        }),
    },
    {
      status: "unlabelled",
      name: "unlabelled",
      make: (n) =>
        base(n, {
          kind: "unlabelled",
          labelId: null,
          item: null,
          staffLabels: [],
          itemRevision: 0,
        }),
    },
    { status: "all", name: "waiting", make: (n) => base(n) },
    {
      status: "all",
      name: "accepted",
      make: (n) => base(n, decidedRow(n, "accepted")),
    },
  ]
  const after = (action: DecisionAction): PhotoState | null =>
    action === "ask_another"
      ? "better_photo_requested"
      : action === "withdraw"
        ? null
        : "accepted"
  const moves = (a: DecisionAction) =>
    a === "relink" || a === "assign_stale" || a === "assign_unlabelled"

  /** What the database does: is the decided photo's card, as shown, still in the view? */
  function truth(status: QueueStatus, action: CardAction): boolean {
    if (action === "also_assign") return true
    // A withdrawn photo is in no decided set, and its label no longer waits.
    if (action === "withdraw") return false
    const state = after(action)
    switch (status) {
      case "accepted":
        return state === "accepted"
      case "needs_another_photo":
        return state === "better_photo_requested"
      case "all":
        return true
      default:
        return false
    }
  }

  type Row = {
    view: string
    status: QueueStatus
    action: CardAction
    complete: boolean
    known: boolean
    make: CardFor
  }
  const rows: Row[] = []
  for (const v of variants)
    for (const action of availableActions(v.make(0), "admin"))
      for (const complete of [true, false])
        for (const known of [true, false])
          rows.push({
            view: `${v.status} (${v.name})`,
            status: v.status,
            action,
            complete,
            known,
            make: v.make,
          })

  it("covers every decision kind and every view", () => {
    const kinds = new Set(rows.map((r) => r.action))
    for (const a of [
      "accept",
      "accept_preferred",
      "set_preferred",
      "ask_another",
      "withdraw",
      "reaccept",
      "relink",
      "assign_stale",
      "assign_unlabelled",
      "also_assign",
    ] as CardAction[])
      expect(kinds).toContain(a)
    expect(new Set(rows.map((r) => r.status)).size).toBe(8)
  })

  it.each(rows)(
    "$view, $action, complete=$complete, decided row known=$known",
    ({ status, action, complete, known, make }) => {
      const total = complete ? 10 : 30
      const at = complete ? 6 : 26 // beyond the 24-card page when incomplete
      const list: ListCard[] = Array.from({ length: total }, (_, n) => make(n))
      const decided = list[at]
      const act = action === "also_assign" ? "assign_unlabelled" : action
      const target = moves(act) || action === "also_assign" ? PIE : SOUP
      const itemless = decided.item === null
      const stays = truth(status, action)
      // The decided photo's row after the decision, as the server reads it.
      const row: QueueCard = {
        ...decided,
        key: id(0x9000 + at),
        kind: "decided",
        photoId: id(0x9000 + at),
        state: after(act),
        isPrimary: act === "set_preferred" || act === "accept_preferred",
        isEffectivePrimary:
          act === "set_preferred" || act === "accept_preferred",
        item: target === PIE ? pieCard(0x21).item : decided.item,
        itemRevision: 8,
      }
      const others = list.filter((c) => c.key !== decided.key)
      const pageOf = itemless || target === PIE ? [] : others
      const firstPage = pageOf
        .slice(0, 24)
        .map((c) => ({ ...c, itemRevision: 8 }))
      const cards = [...firstPage, ...(stays && known ? [row] : [])]
      const next = mergeOutcome(
        list,
        decided,
        act,
        decision({
          action: act,
          itemId: target,
          itemRevision: 8,
          status,
          cards,
          cardsComplete: complete,
          decidedKnown: known,
        }),
        () => true,
        target === PIE ? "Pie" : "Soup"
      )

      // The decided card.
      const mine = next[at]
      if (action === "also_assign") {
        // Its own row (for Soup) is unchanged; Pie's card is another card.
        expect(mine).toBe(decided)
        expect(availableActions(mine, "admin").length).toBeGreaterThan(0)
      } else if (known) {
        expect(mine.settled ?? false).toBe(!stays)
        if (stays) expect(mine).toBe(row)
      } else {
        const predicted = staysInView(status, act)
        // Where the action alone says, it agrees with the database. (A move
        // is the exception: the card shown is for its old item, and its new
        // item's card, when the view lists it, is another row.)
        if (predicted !== undefined && !moves(act))
          expect(predicted).toBe(stays)
        expect(mine.settled ?? false).toBe(predicted === false)
        expect(mine.key).toBe(decided.key)
        if (!mine.settled) {
          expect(mine.state).toBe(after(act))
          expect(mine.itemRevision).toBe(8)
        }
      }
      if (act === "set_preferred" && !mine.settled) {
        expect(mine.isEffectivePrimary).toBe(true)
        expect(availableActions(mine, "admin")).toContain("withdraw")
      }

      // The retained cards: all still there, none settled, all actionable.
      for (const c of others) {
        const kept = next.find(
          (k) =>
            k.key === c.key ||
            (k.asset.assetId === c.asset.assetId && k !== mine)
        )!
        expect(kept, c.key).toBeTruthy()
        expect(kept.settled ?? false).toBe(false)
        expect(availableActions(kept, "admin").length).toBeGreaterThan(0)
        if (!itemless && target === SOUP) expect(kept.itemRevision).toBe(8)
      }
      expect(next.filter((c) => c.settled).length).toBe(mine.settled ? 1 : 0)
    }
  )
})

describe("set as menu photo on a card beyond the fresh page (Codex P2)", () => {
  // 30 accepted Soup photos on the Accepted view; the decision is on card 26,
  // past the 24 cards the decision re-reads on its first page.
  const loaded = Array.from({ length: 30 }, (_, n) =>
    card({
      key: id(0x3000 + n),
      labelId: id(0x3000 + n),
      photoId: id(0x4000 + n),
      asset: { ...card().asset, assetId: id(0x5000 + n) },
      kind: "decided",
      basis: "staff_label",
      state: "accepted",
      item: { ...card().item!, covered: true },
      isPrimary: n === 0,
      isEffectivePrimary: n === 0,
      groupCount: 29,
    })
  )
  const page = loaded.slice(0, 24).map((c) => ({
    ...c,
    itemRevision: 8,
    isPrimary: false,
    isEffectivePrimary: false,
  }))
  const outcome = (over: Partial<DecisionOutcome> = {}) =>
    decision({
      action: "set_preferred",
      itemRevision: 8,
      preferredAssetId: loaded[26].asset.assetId,
      preferredPhotoId: loaded[26].photoId,
      preferredIsFallback: false,
      status: "accepted",
      cardsComplete: false,
      cards: page,
      ...over,
    })

  it("the server's row for the decided card replaces it, still actionable", () => {
    const row = {
      ...loaded[26],
      itemRevision: 8,
      isPrimary: true,
      isEffectivePrimary: true,
    }
    const next = mergeOutcome(
      loaded,
      loaded[26],
      "set_preferred",
      outcome({ cards: [...page, row], decidedKnown: true })
    )
    expect(next[26]).toBe(row)
    expect(availableActions(next[26])).toEqual(["withdraw"])
    expect(next.filter((c) => c.isEffectivePrimary)).toEqual([row])
  })

  it("without its row (the later pages could not be read) it stays in the Accepted view", () => {
    const next = mergeOutcome(
      loaded,
      loaded[26],
      "set_preferred",
      outcome({ decidedKnown: false })
    )
    expect(next[26].settled).toBeFalsy()
    expect(next[26].isEffectivePrimary).toBe(true)
    expect(next[26].isPrimary).toBe(true)
    expect(next[26].itemRevision).toBe(8)
    expect(availableActions(next[26])).toEqual(["withdraw"])
    expect(next.filter((c) => c.isEffectivePrimary)).toHaveLength(1)
  })

  it("ReviewList: the decided card keeps Withdraw", async () => {
    const user = userEvent.setup()
    actions.decideMenuPhotoAction.mockResolvedValue({
      ok: true,
      // The view's status is not echoed: the list supplies its own.
      outcome: outcome({ status: undefined, decidedKnown: false }),
    })
    renderList(loaded, { view: { ...VIEW, status: "accepted" } })
    await user.click(
      within(cardEl(loaded[26].key)).getByRole("button", {
        name: REVIEW_COPY.setPreferred,
      })
    )
    await waitFor(() =>
      expect(
        within(cardEl(loaded[26].key)).getByText(REVIEW_COPY.state.menuPhoto)
      ).toBeTruthy()
    )
    const decided = cardEl(loaded[26].key)
    expect(within(decided).queryByText(REVIEW_COPY.settled)).toBeNull()
    expect(
      within(decided).getByRole("button", { name: REVIEW_COPY.withdraw })
    ).toBeTruthy()
  })
})

describe("applyCurrent: the conflicting card's own row", () => {
  const loaded = Array.from({ length: 30 }, (_, n) =>
    card({
      key: id(0x1000 + n),
      labelId: id(0x1000 + n),
      asset: { ...card().asset, assetId: id(0x2000 + n) },
    })
  )
  const firstPage = loaded.slice(0, 24).map((c) => ({ ...c, itemRevision: 7 }))

  it("someone else decided it (new key, found past the page): their row replaces it", () => {
    const row: QueueCard = {
      ...loaded[26],
      key: id(0x9926),
      kind: "decided",
      photoId: id(0x9926),
      state: "better_photo_requested",
      basis: "staff_label",
      itemRevision: 7,
    }
    const next = applyCurrent(
      loaded,
      SOUP,
      [...firstPage, row],
      () => true,
      false,
      {
        key: loaded[26].key,
        known: true,
      }
    )
    expect(next[26]).toBe(row)
    expect(next).toHaveLength(30)
  })

  it("read everywhere and not there: settled; the rest of the partial page's item stays", () => {
    const next = applyCurrent(loaded, SOUP, firstPage, () => true, false, {
      key: loaded[26].key,
      known: true,
    })
    expect(next[26].settled).toBe(true)
    expect(next.filter((c) => c.settled)).toHaveLength(1)
    expect(next[27].itemRevision).toBe(7)
  })

  it("not read everywhere: it stays actionable", () => {
    const next = applyCurrent(loaded, SOUP, firstPage, () => true, false, {
      key: loaded[26].key,
      known: false,
    })
    expect(next.some((c) => c.settled)).toBe(false)
    expect(availableActions(next[26])).toContain("accept")
  })

  it("a relink's re-read (another item) says nothing of the card", () => {
    const next = applyCurrent(loaded, PIE, [pieCard(0x21)], () => true, true, {
      key: loaded[26].key,
      known: true,
    })
    expect(next[26]).toBe(loaded[26])
  })
})

describe("one photo, a card per variant of the item", () => {
  const V1 = id(0xb1)
  const V2 = id(0xb2)
  const variant = (variantId: string) => ({
    ...card().item!,
    variantId,
    variantName: variantId === V1 ? "Small" : "Large",
    covered: true,
  })
  const accepted = (key: number, variantId: string): QueueCard =>
    card({
      key: id(key),
      kind: "decided",
      labelId: null,
      photoId: id(key),
      state: "accepted",
      basis: "staff_label",
      item: variant(variantId),
    })

  it("mergeOutcome: the decided card takes its own variant's row, never a loaded sibling's", () => {
    // All view: V2's pending label card sorts first; V1's accepted card is loaded.
    const pendingV2 = card({ key: id(0xa2), item: variant(V2) })
    const p1 = accepted(0xb1, V1)
    const freshP1 = { ...p1, itemRevision: 4 }
    const freshP2 = { ...accepted(0xc2, V2), itemRevision: 4 }
    const next = mergeOutcome(
      [pendingV2, p1],
      pendingV2,
      "accept",
      decision({
        status: "all",
        cards: [freshP1, freshP2],
        cardsComplete: true,
        decidedKnown: true,
      })
    )
    expect(next.map((c) => c.key)).toEqual([freshP2.key, freshP1.key])
    expect(next[0]).toBe(freshP2)
    expect(next[1]).toBe(freshP1)
  })

  it("applyCurrent: the conflicting card is not matched to a loaded sibling's row", () => {
    const pendingV2 = card({ key: id(0xa2), item: variant(V2) })
    const p1 = accepted(0xb1, V1)
    const freshP1 = { ...p1, itemRevision: 4 }
    // Someone else accepted V2 (new key), and V1's row is in the re-read.
    const freshP2 = { ...accepted(0xc2, V2), itemRevision: 4 }
    const next = applyCurrent(
      [pendingV2, p1],
      SOUP,
      [freshP1, freshP2],
      () => true,
      true,
      { key: pendingV2.key, known: true }
    )
    expect(next.map((c) => c.key)).toEqual([freshP2.key, freshP1.key])
  })

  it("applyCurrent: another variant's row is not the conflicting card's", () => {
    const pendingV2 = card({ key: id(0xa2), item: variant(V2) })
    // Only V1's (new) row of the photo is in the complete re-read.
    const freshV1 = { ...accepted(0xc1, V1), itemRevision: 4 }
    const next = applyCurrent([pendingV2], SOUP, [freshV1], () => true, true, {
      key: pendingV2.key,
      known: true,
    })
    // V1's row is another card; V2's card was read everywhere and is gone.
    expect(next.find((c) => c.key === pendingV2.key)?.settled).toBe(true)
    expect(next.find((c) => c.key === freshV1.key)).toBe(freshV1)
    expect(next).toHaveLength(2)
  })
})

describe("withdrawing leaves every view", () => {
  it.each(["recheck", "all", "accepted"] as QueueStatus[])(
    "%s: settled even when the server could not read every page",
    (status) => {
      const decided = card({
        key: id(0x31),
        kind: "decided",
        labelId: null,
        photoId: id(0x31),
        state: status === "recheck" ? "needs_recheck" : "accepted",
        recheckKind: status === "recheck" ? "name_changed" : null,
        basis: "staff_label",
        item: { ...card().item!, covered: true },
      })
      expect(staysInView(status, "withdraw")).toBe(false)
      const next = mergeOutcome(
        [decided],
        decided,
        "withdraw",
        decision({
          action: "withdraw",
          itemCovered: false,
          status,
          cards: [],
          cardsComplete: false,
          decidedKnown: false,
        })
      )
      expect(next[0].settled).toBe(true)
      expect(availableActions(next[0], "admin")).toEqual([])
    }
  )
})

describe("ReviewList: a conflict on a stale card in the All view", () => {
  it("the picked item's re-read says nothing of the stale card: it stays", async () => {
    const user = userEvent.setup()
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
    actions.decideMenuPhotoAction.mockResolvedValue({
      ok: false,
      code: "revision_conflict",
      message: "stale",
      current: [pieCard(0x21)],
      currentComplete: true,
      currentDecidedKnown: true,
    })
    renderList([stale], { view: { ...VIEW, status: "all" } })
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
    expect(await screen.findByText(REVIEW_COPY.conflict("Pie"))).toBeTruthy()
    const el = cardEl(stale.key)
    expect(within(el).queryByText(REVIEW_COPY.settled)).toBeNull()
    expect(
      within(el).getByRole("button", { name: REVIEW_COPY.chooseItem })
    ).toBeTruthy()
  })
})
