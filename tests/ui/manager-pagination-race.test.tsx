// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react"
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

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import type { LoadMenuItems } from "@/components/nabalens/manager/menu/menu-list"
import type { MenuFilter } from "@/components/nabalens/manager/menu/menu-query"
import { MenuScreen } from "@/components/nabalens/manager/menu/menu-screen"
import type { ReviewView } from "@/components/nabalens/manager/review/links"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { ReviewScreen } from "@/components/nabalens/manager/review/review-screen"
import type {
  DecisionOutcome,
  ManagerMenuItem,
  ManagerOverview,
  Page,
  QueueCard,
} from "@/lib/server/menu-photos/types"

afterEach(cleanup)
beforeEach(() => {
  window.sessionStorage.clear()
  vi.clearAllMocks()
})

const NOW = "2026-11-07T12:00:00.000Z"
const STARTERS = "00000000-0000-4000-8000-0000000000b1"
const MAINS = "00000000-0000-4000-8000-0000000000b2"
const STAFF = "00000000-0000-4000-8000-0000000000f1"
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A waiting labelled photo of item `n` (key, asset and item derive from n). */
function card(n: number, name: string, sectionId = STARTERS): QueueCard {
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
      itemId: id(0xc00 + n),
      name,
      sectionId,
      sectionName: sectionId === STARTERS ? "Starters" : "Mains",
      variantId: null,
      variantName: null,
      covered: false,
    },
    staffLabels: [],
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
  }
}

const cardEl = (key: string) =>
  document.querySelector<HTMLElement>(`[data-card-key="${key}"]`)

const PENDING: ReviewView = {
  status: "pending",
  sectionId: null,
  contributorId: null,
  itemId: null,
}
const MAINS_VIEW: ReviewView = { ...PENDING, sectionId: MAINS }

function reviewScreen(view: ReviewView, initial: Page<QueueCard>) {
  return (
    <ReviewScreen
      scope={{ kind: "manager" }}
      view={view}
      initial={initial}
      sections={[
        { id: STARTERS, name: "Starters" },
        { id: MAINS, name: "Mains" },
      ]}
      contributors={[{ id: STAFF, name: "TEST Sam Lee" }]}
      showMine={false}
      venueName="The Railway"
      now={NOW}
    />
  )
}

const loadMoreButton = () => screen.getByRole("button", { name: "Load more" })

describe("Review Show more across a filter change", () => {
  const soup = card(1, "Soup")
  const tart = card(2, "Tart")
  const pie = card(3, "Pie", MAINS)
  const stew = card(4, "Stew", MAINS)

  it("drops the old view's page and keeps the new view's cursor", async () => {
    const user = userEvent.setup()
    const pending = deferred<unknown>()
    actions.loadReviewPageAction.mockReturnValueOnce(pending.promise)
    const view = render(
      reviewScreen(PENDING, { items: [soup], nextCursor: "old-next" })
    )
    await user.click(loadMoreButton())
    expect(actions.loadReviewPageAction).toHaveBeenCalledTimes(1)
    expect(actions.loadReviewPageAction.mock.calls[0][0]).toMatchObject({
      cursor: "old-next",
    })

    // The reviewer picks Mains before the old page arrives.
    view.rerender(
      reviewScreen(MAINS_VIEW, { items: [pie], nextCursor: "mains-next" })
    )
    expect(cardEl(pie.key)).toBeTruthy()
    expect(cardEl(soup.key)).toBeNull()
    // The new view is not stuck behind the old request.
    expect(loadMoreButton().hasAttribute("disabled")).toBe(false)

    await act(async () => {
      pending.resolve({ ok: true, items: [tart], nextCursor: "old-after" })
      await pending.promise
    })
    // Nothing from the old view reached the new list.
    expect(cardEl(tart.key)).toBeNull()
    expect(cardEl(pie.key)).toBeTruthy()
    expect(
      screen.queryByText(REVIEW_COPY.moreLoaded(1), { exact: false })
    ).toBeNull()

    // The next page continues the Mains view from its own cursor.
    actions.loadReviewPageAction.mockResolvedValueOnce({
      ok: true,
      items: [stew],
      nextCursor: null,
    })
    await user.click(loadMoreButton())
    expect(actions.loadReviewPageAction).toHaveBeenCalledTimes(2)
    expect(actions.loadReviewPageAction.mock.calls[1][0]).toMatchObject({
      sectionId: MAINS,
      cursor: "mains-next",
    })
    expect(cardEl(stew.key)).toBeTruthy()
    expect(cardEl(tart.key)).toBeNull()
  })

  it("shows no stale load error in the new view", async () => {
    const user = userEvent.setup()
    const pending = deferred<unknown>()
    actions.loadReviewPageAction.mockReturnValueOnce(pending.promise)
    const view = render(
      reviewScreen(PENDING, { items: [soup], nextCursor: "old-next" })
    )
    await user.click(loadMoreButton())
    view.rerender(
      reviewScreen(MAINS_VIEW, { items: [pie], nextCursor: "mains-next" })
    )
    await act(async () => {
      pending.reject(new Error("offline"))
      await pending.promise.catch(() => {})
    })
    expect(screen.queryByText(REVIEW_COPY.loadMoreFailed)).toBeNull()
    expect(loadMoreButton().hasAttribute("disabled")).toBe(false)
  })

  it("keeps a decision saved under the old view out of the new list", async () => {
    const user = userEvent.setup()
    const pending = deferred<unknown>()
    actions.decideMenuPhotoAction.mockReturnValueOnce(pending.promise)
    const view = render(
      reviewScreen(PENDING, { items: [soup], nextCursor: null })
    )
    await user.click(
      within(cardEl(soup.key)!).getByRole("button", {
        name: REVIEW_COPY.accept,
      })
    )
    view.rerender(reviewScreen(MAINS_VIEW, { items: [pie], nextCursor: null }))

    // The outcome carries the old view's fresh cards for Soup.
    const fresh = { ...soup, state: "accepted" } as QueueCard
    await act(async () => {
      pending.resolve({
        ok: true,
        outcome: {
          action: "accept",
          itemId: soup.item!.itemId,
          itemRevision: 4,
          replayed: false,
          itemCovered: true,
          preferredAssetId: soup.asset.assetId,
          cards: [fresh],
        } satisfies DecisionOutcome,
      })
      await pending.promise
    })
    expect(cardEl(soup.key)).toBeNull()
    expect(cardEl(pie.key)).toBeTruthy()
    // The saved decision is still announced and the new view reloads.
    expect(
      await screen.findByText("Accepted for Soup. Soup now has a photo.")
    ).toBeTruthy()
    expect(nav.refresh).toHaveBeenCalledTimes(1)
  })
})

describe("Menu Show more across a filter change", () => {
  const overview: ManagerOverview = {
    venueId: id(0xa1),
    venueName: "The Railway",
    menuState: "ready",
    menu: {
      versionId: id(0xd1),
      title: "Autumn menu",
      activatedAt: "2026-09-01T09:00:00.000Z",
    },
    eligible: 3,
    covered: 0,
    awaitingReviewItems: 0,
    needsPhotoItems: 3,
    replacementPendingItems: 0,
    needsRecheckItems: 0,
    pendingPhotos: 0,
    ownWaitingPhotos: 0,
    oldestPendingAt: null,
    carriedItems: 0,
    newItems: 0,
    sections: [
      {
        sectionId: STARTERS,
        name: "Starters",
        kind: "food",
        position: 1,
        eligible: 2,
        covered: 0,
        awaitingReview: 0,
        needsPhoto: 2,
      },
      {
        sectionId: MAINS,
        name: "Mains",
        kind: "food",
        position: 2,
        eligible: 2,
        covered: 0,
        awaitingReview: 0,
        needsPhoto: 2,
      },
    ],
  }

  function item(n: number, name: string, sectionId: string): ManagerMenuItem {
    const mains = sectionId === MAINS
    return {
      itemId: id(0xe00 + n),
      name,
      description: null,
      section: {
        id: sectionId,
        name: mains ? "Mains" : "Starters",
        kind: "food",
        position: mains ? 2 : 1,
      },
      entryPosition: n,
      variants: [],
      status: "needs_photo",
      hasPendingReplacement: false,
      needsRecheck: false,
      ownWaiting: 0,
      othersWaiting: 0,
      acceptedCount: 0,
      candidateCount: 0,
      preferred: null,
      itemRevision: 1,
    }
  }

  const ALL: MenuFilter = { status: null, sectionId: null, query: "" }
  const MAINS_FILTER: MenuFilter = { ...ALL, sectionId: MAINS }

  function menuScreen(
    filter: MenuFilter,
    items: Page<ManagerMenuItem>,
    loadItems: LoadMenuItems
  ) {
    return (
      <MenuScreen
        overview={overview}
        filter={filter}
        items={items}
        loadItems={loadItems}
        now={NOW}
      />
    )
  }

  it("drops the old filter's page and keeps the new filter's cursor", async () => {
    const user = userEvent.setup()
    const soup = item(1, "Soup", STARTERS)
    const tart = item(2, "Tart", STARTERS)
    const pie = item(3, "Pie", MAINS)
    const stew = item(4, "Stew", MAINS)
    const pending = deferred<Awaited<ReturnType<LoadMenuItems>>>()
    const loadItems = vi
      .fn<LoadMenuItems>()
      .mockReturnValueOnce(pending.promise)
    const view = render(
      menuScreen(ALL, { items: [soup], nextCursor: "old-next" }, loadItems)
    )
    await user.click(
      screen.getByRole("button", { name: MANAGER_COPY.menu.showMore })
    )
    expect(loadItems).toHaveBeenCalledTimes(1)

    view.rerender(
      menuScreen(
        MAINS_FILTER,
        { items: [pie], nextCursor: "mains-next" },
        loadItems
      )
    )
    await act(async () => {
      pending.resolve({ ok: true, items: [tart], nextCursor: "old-after" })
      await pending.promise
    })
    expect(screen.queryByRole("link", { name: /Tart/ })).toBeNull()
    expect(screen.getByRole("link", { name: /Pie/ })).toBeTruthy()

    loadItems.mockResolvedValueOnce({
      ok: true,
      items: [stew],
      nextCursor: null,
    })
    await user.click(
      screen.getByRole("button", { name: MANAGER_COPY.menu.showMore })
    )
    expect(loadItems).toHaveBeenCalledTimes(2)
    expect(loadItems.mock.calls[1][0]).toEqual({
      sectionId: MAINS,
      cursor: "mains-next",
    })
    expect(await screen.findByRole("link", { name: /Stew/ })).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Tart/ })).toBeNull()
  })
})
