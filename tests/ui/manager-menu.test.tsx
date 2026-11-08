// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import {
  ItemDetail,
  type DecideMenuPhoto,
} from "@/components/nabalens/manager/menu/item-detail"
import { ItemWaiting } from "@/components/nabalens/manager/menu/item-waiting"
import type { LoadItemEvents } from "@/components/nabalens/manager/menu/item-history"
import type { LoadMenuItems } from "@/components/nabalens/manager/menu/menu-list"
import {
  backHref,
  itemHref,
  parseMenuFilter,
  type MenuFilter,
} from "@/components/nabalens/manager/menu/menu-query"
import { MenuScreen } from "@/components/nabalens/manager/menu/menu-screen"
import type {
  ItemEvent,
  ItemPhoto,
  ManagerItemDetail,
  ManagerMenuItem,
  ManagerOverview,
  Page,
} from "@/lib/server/menu-photos/types"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  router.replace.mockClear()
  router.refresh.mockClear()
  window.sessionStorage.clear()
})

const NOW = "2026-11-07T12:00:00.000Z"
const STARTERS = "00000000-0000-4000-8000-0000000000b1"
const MAINS = "00000000-0000-4000-8000-0000000000b2"
const ITEM = "00000000-0000-4000-8000-0000000000c1"
const NO_FILTER: MenuFilter = { status: null, sectionId: null, query: "" }

const overview: ManagerOverview = {
  venueId: "00000000-0000-4000-8000-0000000000a1",
  venueName: "The Railway",
  menuState: "ready",
  menu: {
    versionId: "00000000-0000-4000-8000-0000000000d1",
    title: "Autumn menu",
    activatedAt: "2026-09-01T09:00:00.000Z",
  },
  eligible: 3,
  covered: 1,
  awaitingReviewItems: 1,
  needsPhotoItems: 1,
  replacementPendingItems: 1,
  needsRecheckItems: 1,
  pendingPhotos: 2,
  ownWaitingPhotos: 1,
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
      covered: 1,
      awaitingReview: 1,
      needsPhoto: 0,
    },
    {
      sectionId: MAINS,
      name: "Mains",
      kind: "food",
      position: 2,
      eligible: 1,
      covered: 0,
      awaitingReview: 0,
      needsPhoto: 1,
    },
  ],
}

function menuItem(over: Partial<ManagerMenuItem> = {}): ManagerMenuItem {
  return {
    itemId: ITEM,
    name: "Soup",
    description: null,
    section: { id: STARTERS, name: "Starters", kind: "food", position: 1 },
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
    itemRevision: 3,
    ...over,
  }
}

const LONG =
  "Slow-roasted pork belly with crackling, apple and cider sauce, seasonal greens and buttery mash"

const ITEMS: ManagerMenuItem[] = [
  menuItem({
    status: "covered",
    hasPendingReplacement: true,
    acceptedCount: 1,
    variants: [
      { variantId: "00000000-0000-4000-8000-0000000000e1", name: "Cup" },
      { variantId: "00000000-0000-4000-8000-0000000000e2", name: "Bowl" },
    ],
    preferred: {
      assetId: "00000000-0000-4000-8000-0000000000f1",
      thumbnailUrl:
        "/api/menu-photos/00000000-0000-4000-8000-0000000000f1/thumb",
      previewUrl: null,
      width: 320,
      height: 240,
    },
  }),
  menuItem({
    itemId: "00000000-0000-4000-8000-0000000000c2",
    name: LONG,
    status: "awaiting_review",
    needsRecheck: true,
    ownWaiting: 1,
  }),
  menuItem({
    itemId: "00000000-0000-4000-8000-0000000000c3",
    name: "Fish pie",
    section: { id: MAINS, name: "Mains", kind: "food", position: 2 },
  }),
]

function screenWith(
  items: Page<ManagerMenuItem>,
  filter: MenuFilter = NO_FILTER,
  loadItems: LoadMenuItems = vi.fn()
) {
  return render(
    <MenuScreen
      overview={overview}
      filter={filter}
      items={items}
      loadItems={loadItems}
      now={NOW}
    />
  )
}

function row(name: string) {
  return screen.getByRole("link", { name }).closest("article") as HTMLElement
}

describe("Menu list", () => {
  it("shows the three headline states and the secondary chips", () => {
    screenWith({ items: ITEMS, nextCursor: null })
    const soup = within(row("Soup"))
    expect(soup.getByText("Has a photo")).toBeTruthy()
    expect(soup.getByText("New photo waiting")).toBeTruthy()
    expect(soup.getByText("Cup, Bowl")).toBeTruthy()
    const long = within(row(LONG))
    expect(long.getByText("Awaiting review")).toBeTruthy()
    expect(long.getByText("Needs a recheck")).toBeTruthy()
    expect(
      long.getByText("Your earlier photo is waiting for an admin")
    ).toBeTruthy()
    expect(
      within(row("Fish pie")).getByText("Still needs a photo")
    ).toBeTruthy()
    expect(within(row("Fish pie")).queryByText("New photo waiting")).toBeNull()
  })

  it("groups by section with the section's covered count", () => {
    screenWith({ items: ITEMS, nextCursor: null })
    const starters = screen.getByRole("region", { name: "Starters" })
    expect(within(starters).getByText("1 of 2 covered")).toBeTruthy()
    const mains = screen.getByRole("region", { name: "Mains" })
    expect(within(mains).getByText("0 of 1 covered")).toBeTruthy()
  })

  it("wraps long names instead of truncating them", () => {
    screenWith({ items: ITEMS, nextCursor: null })
    const heading = screen.getByRole("heading", { level: 3, name: LONG })
    expect(heading.className).toContain("break-words")
    expect(heading.className).not.toContain("truncate")
    expect(heading.querySelector(".truncate")).toBeNull()
  })

  it("links each row to the item and keeps the list's filters in ?from=", () => {
    const filter: MenuFilter = {
      status: "needs_photo",
      sectionId: MAINS,
      query: "pie",
    }
    screenWith({ items: ITEMS.slice(2), nextCursor: null }, filter)
    const href = screen
      .getByRole("link", { name: "Fish pie" })
      .getAttribute("href")!
    expect(
      href.startsWith(
        "/manager/menu/00000000-0000-4000-8000-0000000000c3?from="
      )
    ).toBe(true)
    const from = new URL(href, "http://x").searchParams.get("from")
    expect(backHref(from ?? undefined)).toBe(
      `/manager/menu?status=needs_photo&section=${MAINS}&q=pie`
    )
    expect(itemHref(ITEM, NO_FILTER)).toBe(`/manager/menu/${ITEM}`)
  })

  it("status choices carry the overview counts and mark the current one", () => {
    screenWith(
      { items: ITEMS, nextCursor: null },
      {
        ...NO_FILTER,
        status: "recheck",
      }
    )
    const nav = screen.getByRole("navigation", { name: "Show" })
    const links = within(nav).getAllByRole("link")
    expect(links.map((a) => a.textContent)).toEqual([
      "All3",
      "Still needs a photo1",
      "Awaiting review1",
      "Has a photo1",
      "New photo waiting1",
      "Needs a recheck1",
    ])
    expect(
      links.filter((a) => a.getAttribute("aria-current") === "page")
    ).toHaveLength(1)
    expect(links[5]?.getAttribute("aria-current")).toBe("page")
    expect(links[5]?.getAttribute("href")).toBe("/manager/menu?status=recheck")
  })

  it("search replaces the URL without scrolling, 300 ms after typing", () => {
    vi.useFakeTimers()
    screenWith(
      { items: ITEMS, nextCursor: null },
      {
        ...NO_FILTER,
        status: "covered",
      }
    )
    const input = screen.getByRole("searchbox", { name: "Search items" })
    fireEvent.change(input, { target: { value: "so" } })
    fireEvent.change(input, { target: { value: "soup " } })
    act(() => vi.advanceTimersByTime(299))
    expect(router.replace).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith(
      "/manager/menu?status=covered&q=soup",
      { scroll: false }
    )
  })

  it("an empty search says nothing matches and offers every item", () => {
    screenWith({ items: [], nextCursor: null }, { ...NO_FILTER, query: "zzz" })
    expect(screen.getByText("No items match 'zzz'")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Show all items" }).getAttribute("href")
    ).toBe("/manager/menu")
  })

  it("Show more items loads in place, announces the count and keeps focus", async () => {
    const user = userEvent.setup()
    let resolve: (v: Awaited<ReturnType<LoadMenuItems>>) => void = () => {}
    const loadItems = vi.fn<LoadMenuItems>(
      () => new Promise((r) => (resolve = r))
    )
    screenWith(
      { items: ITEMS.slice(0, 2), nextCursor: "c1" },
      { ...NO_FILTER, query: "o" },
      loadItems
    )
    const button = screen.getByRole("button", { name: "Show more items" })
    await user.click(button)
    expect(loadItems).toHaveBeenCalledWith({ query: "o", cursor: "c1" })
    expect(document.activeElement).toBe(button)
    expect(button.getAttribute("aria-disabled")).toBe("true")
    await act(async () =>
      resolve({
        ok: true,
        items: [
          ITEMS[2]!,
          menuItem({
            itemId: "00000000-0000-4000-8000-0000000000c4",
            name: "Pie",
            section: ITEMS[2]!.section,
          }),
        ],
        nextCursor: "c2",
      })
    )
    expect(screen.getByRole("link", { name: "Fish pie" })).toBeTruthy()
    expect(screen.getByText("2 more items loaded")).toBeTruthy()
    const again = screen.getByRole("button", { name: "Show more items" })
    expect(again).toBe(button)
    expect(document.activeElement).toBe(button)
  })
})

describe("parseMenuFilter", () => {
  it("drops unknown values", () => {
    expect(
      parseMenuFilter({ status: "bogus", section: "x", q: ["a", "b"] })
    ).toEqual(NO_FILTER)
    expect(
      parseMenuFilter({ status: "replacement", section: MAINS, q: "  pie " })
    ).toEqual({ status: "replacement", sectionId: MAINS, query: "pie" })
    expect(backHref("https://evil.example/?q=1")).toBe("/manager/menu")
  })
})

// ---- Item detail -------------------------------------------------------------------

function photo(over: Partial<ItemPhoto> = {}): ItemPhoto {
  return {
    photoId: "00000000-0000-4000-8000-000000000101",
    asset: {
      assetId: "00000000-0000-4000-8000-000000000201",
      thumbnailUrl:
        "/api/menu-photos/00000000-0000-4000-8000-000000000201/thumb",
      previewUrl:
        "/api/menu-photos/00000000-0000-4000-8000-000000000201/preview",
      width: 800,
      height: 600,
    },
    state: "accepted",
    basis: "staff_label",
    isPrimary: true,
    isEffective: true,
    variantId: null,
    variantName: null,
    recheckKind: null,
    reason: null,
    decidedAt: "2026-11-02T10:00:00.000Z",
    decidedByName: "Mina Patel",
    author: {
      id: "00000000-0000-4000-8000-000000000301",
      name: "Sam Lee",
      status: "here",
      canFollowUp: true,
    },
    isSelf: false,
    correctsItemId: null,
    correctsVariantId: null,
    correctsItemName: null,
    ...over,
  }
}

function detail(over: Partial<ManagerItemDetail> = {}): ManagerItemDetail {
  return {
    item: menuItem({ status: "covered", acceptedCount: 2 }),
    preferred: { ...photo(), fallback: false },
    alternatives: [
      photo({
        photoId: "00000000-0000-4000-8000-000000000102",
        isPrimary: false,
        isEffective: false,
        author: {
          id: "00000000-0000-4000-8000-000000000302",
          name: "Ana Cruz",
          status: "here",
          canFollowUp: true,
        },
      }),
    ],
    askedForAnother: [],
    recheck: [],
    waiting: { items: [], nextCursor: null },
    ...over,
  }
}

function showItem(
  d: ManagerItemDetail,
  decide: DecideMenuPhoto = vi.fn(),
  loadEvents: LoadItemEvents = vi.fn()
) {
  return render(
    <ItemDetail
      detail={d}
      backHref="/manager/menu?status=covered"
      decide={decide}
      history={{
        items: [
          {
            id: "9",
            action: "accepted",
            photoId: "00000000-0000-4000-8000-000000000101",
            actorName: "Mina Patel",
            actorRole: "manager",
            reason: null,
            basis: "reviewer",
            correctsItemName: "Salad",
            recheckKind: null,
            createdAt: "2026-11-02T10:00:00.000Z",
          },
          {
            id: "8",
            action: "carried",
            photoId: "00000000-0000-4000-8000-000000000101",
            actorName: null,
            actorRole: "system",
            reason: null,
            basis: null,
            correctsItemName: null,
            recheckKind: null,
            createdAt: "2026-11-01T09:00:00.000Z",
          },
        ],
        nextCursor: "8",
      }}
      loadEvents={loadEvents}
      waiting={<ItemWaiting item={d.item} waiting={d.waiting} />}
    />
  )
}

const region = (name: string) => screen.getByRole("region", { name })

describe("Item detail", () => {
  it("shows the menu photo, alternatives, waiting and history sections", () => {
    showItem(detail())
    expect(
      screen.getByRole("link", { name: "Menu" }).getAttribute("href")
    ).toBe("/manager/menu?status=covered")
    expect(screen.getByRole("heading", { level: 1, name: "Soup" })).toBeTruthy()
    const menuPhoto = within(region("Menu photo"))
    expect(
      menuPhoto.getByText("Accepted by Mina Patel · 2 Nov 2026")
    ).toBeTruthy()
    expect(menuPhoto.queryByText(MANAGER_COPY.item.fallback)).toBeNull()
    expect(
      menuPhoto.getByRole("button", { name: "Withdraw acceptance" })
    ).toBeTruthy()
    expect(
      menuPhoto.queryByRole("button", { name: "Set as menu photo" })
    ).toBeNull()
    const alternatives = within(region("Accepted alternatives"))
    expect(
      alternatives.getByText("Photo by Ana Cruz", { selector: "p" })
    ).toBeTruthy()
    expect(
      alternatives.getByRole("button", { name: "Set as menu photo" })
    ).toBeTruthy()
    expect(
      alternatives.getByRole("button", { name: "Withdraw acceptance" })
    ).toBeTruthy()
    expect(
      within(region("Waiting for review")).getByText(
        MANAGER_COPY.item.noneWaiting
      )
    ).toBeTruthy()
    const history = within(region("History"))
    expect(
      history.getByText("Mina Patel moved from Salad · 2 Nov 2026")
    ).toBeTruthy()
    expect(
      history.getByText("Kept after a menu change · 1 Nov 2026")
    ).toBeTruthy()
    expect(history.getByRole("button", { name: "Show more" })).toBeTruthy()
  })

  it("says when the earliest accepted photo stands in, and offers to set it", () => {
    showItem(
      detail({
        preferred: { ...photo({ isPrimary: false }), fallback: true },
        alternatives: [],
      })
    )
    const menuPhoto = within(region("Menu photo"))
    expect(
      menuPhoto.getByText("Showing the earliest accepted photo")
    ).toBeTruthy()
    expect(
      menuPhoto.getByRole("button", { name: "Set as menu photo" })
    ).toBeTruthy()
  })

  it("without a menu photo says so", () => {
    showItem(
      detail({
        item: menuItem(),
        preferred: null,
        alternatives: [],
      })
    )
    expect(
      within(region("Menu photo")).getByText("No menu photo yet")
    ).toBeTruthy()
  })

  it("variant_removed offers only withdraw; other rechecks can be accepted again", () => {
    showItem(
      detail({
        recheck: [
          photo({
            photoId: "00000000-0000-4000-8000-000000000103",
            state: "needs_recheck",
            isPrimary: false,
            isEffective: false,
            recheckKind: "variant_removed",
            author: {
              id: "00000000-0000-4000-8000-000000000303",
              name: "Removed Option",
              status: "here",
              canFollowUp: true,
            },
          }),
          photo({
            photoId: "00000000-0000-4000-8000-000000000104",
            state: "needs_recheck",
            isPrimary: false,
            isEffective: false,
            recheckKind: "name_changed",
            author: {
              id: "00000000-0000-4000-8000-000000000304",
              name: "Renamed Item",
              status: "here",
              canFollowUp: true,
            },
          }),
        ],
      })
    )
    const cards = within(region("Needs a recheck")).getAllByRole("article")
    const removed = within(cards[0]!)
    expect(removed.getByText("Option no longer on the menu")).toBeTruthy()
    expect(
      removed.getByText("This option is no longer on the menu")
    ).toBeTruthy()
    expect(
      removed.queryByRole("button", { name: "Accept again for this menu" })
    ).toBeNull()
    expect(
      removed
        .getAllByRole("button")
        .filter((b) => !b.getAttribute("aria-label")?.startsWith("Open "))
        .map((b) => b.textContent)
    ).toEqual(["Withdraw"])
    const renamed = within(cards[1]!)
    expect(renamed.getByText("Name changed on the new menu")).toBeTruthy()
    expect(
      renamed.getByRole("button", { name: "Accept again for this menu" })
    ).toBeTruthy()
  })

  it("accept again on a reviewer-matched row sends its stored correction", async () => {
    const user = userEvent.setup()
    const decide = vi.fn<DecideMenuPhoto>(async () => ({
      ok: true,
      outcome: {
        action: "reaccept",
        itemId: ITEM,
        itemRevision: 4,
        replayed: false,
        itemCovered: true,
        preferredAssetId: null,
        cards: [],
      },
    }))
    showItem(
      detail({
        recheck: [
          photo({
            photoId: "00000000-0000-4000-8000-000000000105",
            state: "needs_recheck",
            basis: "reviewer",
            isPrimary: false,
            isEffective: false,
            recheckKind: "section_changed",
            variantId: "00000000-0000-4000-8000-0000000000e1",
            correctsItemId: "00000000-0000-4000-8000-0000000000c9",
            correctsVariantId: null,
            correctsItemName: "Salad",
          }),
        ],
      }),
      decide
    )
    await user.click(
      screen.getByRole("button", { name: "Accept again for this menu" })
    )
    expect(decide).toHaveBeenCalledTimes(1)
    const [input, view] = decide.mock.calls[0]!
    expect(input).toMatchObject({
      action: "reaccept",
      itemId: ITEM,
      photoId: "00000000-0000-4000-8000-000000000105",
      variantId: "00000000-0000-4000-8000-0000000000e1",
      expectedRevision: 3,
      basis: "reviewer",
      correctsItemId: "00000000-0000-4000-8000-0000000000c9",
      correctsVariantId: null,
    })
    expect(typeof (input as { requestId: string }).requestId).toBe("string")
    expect(view).toEqual({ status: "all" })
    expect(router.refresh).toHaveBeenCalled()
    expect(screen.getByText("Accepted again for Soup.")).toBeTruthy()
  })

  it("withdraw needs a reason and says what happens to the menu photo", async () => {
    const user = userEvent.setup()
    const decide = vi.fn<DecideMenuPhoto>()
    showItem(detail({ alternatives: [] }), decide)
    await user.click(
      within(region("Menu photo")).getByRole("button", {
        name: "Withdraw acceptance",
      })
    )
    const dialog = screen.getByRole("dialog")
    expect(
      within(dialog).getByText("Soup will need a photo again.")
    ).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", { name: "Withdraw acceptance" })
    )
    expect(within(dialog).getByText("Give a reason.")).toBeTruthy()
    expect(decide).not.toHaveBeenCalled()
  })

  it("a stale revision shows the latest state; a network failure keeps the request id", async () => {
    const user = userEvent.setup()
    const decide = vi
      .fn<DecideMenuPhoto>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: false,
        code: "revision_conflict",
        status: 409,
        message: "Changed.",
      })
    showItem(detail(), decide)
    const set = () =>
      within(region("Accepted alternatives")).getByRole("button", {
        name: "Set as menu photo",
      })
    await user.click(set())
    // A lost reply: the decision may be saved, so it can't say it failed.
    expect(
      screen.getByText(
        "We couldn't confirm the decision was saved. Check your connection, then try again or refresh to see if it was. The photo won't be decided twice."
      )
    ).toBeTruthy()
    await user.click(set())
    const ids = decide.mock.calls.map(
      ([i]) => (i as { requestId: string }).requestId
    )
    expect(ids[0]).toBe(ids[1])
    expect(
      screen.getByText("Someone else changed Soup first. Here is the latest.")
    ).toBeTruthy()
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it("own photos show the note and no actions", () => {
    showItem(
      detail({
        alternatives: [
          photo({
            photoId: "00000000-0000-4000-8000-000000000106",
            isPrimary: false,
            isEffective: false,
            isSelf: true,
          }),
        ],
      })
    )
    const alternatives = within(region("Accepted alternatives"))
    expect(alternatives.getByText(MANAGER_COPY.item.ownPhoto)).toBeTruthy()
    expect(
      alternatives.queryByRole("button", { name: "Set as menu photo" })
    ).toBeNull()
  })

  it("a leaver's photos stay on show with the note and no actions", () => {
    const left = {
      id: "00000000-0000-4000-8000-000000000309",
      name: "Former Staff",
      status: "left" as const,
      canFollowUp: false,
    }
    showItem(
      detail({
        preferred: { ...photo({ author: left }), fallback: true },
        alternatives: [
          photo({
            photoId: "00000000-0000-4000-8000-000000000107",
            isPrimary: false,
            isEffective: false,
            author: left,
          }),
        ],
        askedForAnother: [
          photo({
            photoId: "00000000-0000-4000-8000-000000000108",
            state: "better_photo_requested",
            isPrimary: false,
            isEffective: false,
            author: left,
          }),
        ],
        recheck: [
          photo({
            photoId: "00000000-0000-4000-8000-000000000109",
            state: "needs_recheck",
            isPrimary: false,
            isEffective: false,
            recheckKind: "name_changed",
            author: left,
          }),
        ],
      })
    )
    for (const name of [
      "Menu photo",
      "Accepted alternatives",
      "Asked for another photo",
      "Needs a recheck",
    ]) {
      const section = within(region(name))
      expect(section.getByText(MANAGER_COPY.item.contributorLeft)).toBeTruthy()
      expect(
        section.getByText("Photo by Former Staff", { selector: "p" })
      ).toBeTruthy()
      // Only the photo's own preview button is left.
      expect(
        section
          .getAllByRole("button")
          .filter((b) => !b.getAttribute("aria-label")?.startsWith("Open "))
      ).toEqual([])
    }
  })

  it("a contributor who moved venue keeps the manager's actions", () => {
    showItem(
      detail({
        alternatives: [
          photo({
            photoId: "00000000-0000-4000-8000-000000000110",
            isPrimary: false,
            isEffective: false,
            author: {
              id: "00000000-0000-4000-8000-000000000310",
              name: "Moved On",
              status: "moved",
              canFollowUp: false,
            },
          }),
        ],
      })
    )
    const alternatives = within(region("Accepted alternatives"))
    expect(
      alternatives.queryByText(MANAGER_COPY.item.contributorLeft)
    ).toBeNull()
    expect(
      alternatives.getByRole("button", { name: "Set as menu photo" })
    ).toBeTruthy()
  })

  it("history shows the newest events after a refresh", async () => {
    const user = userEvent.setup()
    const event = (id: string, actorName: string, createdAt: string) => ({
      id,
      action: "accepted" as const,
      photoId: "00000000-0000-4000-8000-000000000101",
      actorName,
      actorRole: "manager" as const,
      reason: null,
      basis: "staff_label" as const,
      correctsItemName: null,
      recheckKind: null,
      createdAt,
    })
    const loadEvents = vi.fn<LoadItemEvents>(async () => ({
      ok: true,
      items: [event("7", "Old Hand", "2026-10-30T09:00:00.000Z")],
      nextCursor: null,
    }))
    const props = (
      d: ManagerItemDetail,
      history: Page<ItemEvent> | null
    ): React.ComponentProps<typeof ItemDetail> => ({
      detail: d,
      backHref: "/manager/menu",
      decide: vi.fn(),
      history,
      loadEvents,
      waiting: <ItemWaiting item={d.item} waiting={d.waiting} />,
    })
    const first = detail()
    const view = render(
      <ItemDetail
        {...props(first, {
          items: [event("8", "Mina Patel", "2026-11-01T09:00:00.000Z")],
          nextCursor: "8",
        })}
      />
    )
    await user.click(
      within(region("History")).getByRole("button", { name: "Show more" })
    )
    expect(await within(region("History")).findByText(/^Old Hand/)).toBeTruthy()
    // router.refresh(): the server sends the item's new head and history.
    const refreshed = detail({
      item: { ...first.item, itemRevision: first.item.itemRevision + 1 },
    })
    view.rerender(
      <ItemDetail
        {...props(refreshed, {
          items: [
            event("9", "Ana Cruz", "2026-11-03T09:00:00.000Z"),
            event("8", "Mina Patel", "2026-11-01T09:00:00.000Z"),
          ],
          nextCursor: "8",
        })}
      />
    )
    const history = within(region("History"))
    expect(history.getByText(/^Ana Cruz accepted/)).toBeTruthy()
    expect(history.getByText(/^Mina Patel accepted/)).toBeTruthy()
    expect(history.queryByText(/^Old Hand/)).toBeNull()
    expect(history.getByRole("button", { name: "Show more" })).toBeTruthy()
  })

  it("history recovers when a refresh reads it after a failure", () => {
    const d = detail()
    const base = {
      detail: d,
      backHref: "/manager/menu",
      decide: vi.fn<DecideMenuPhoto>(),
      loadEvents: vi.fn<LoadItemEvents>(),
      waiting: <ItemWaiting item={d.item} waiting={d.waiting} />,
    }
    const view = render(<ItemDetail {...base} history={null} />)
    expect(
      within(region("History")).getByText(MANAGER_COPY.item.historyFailed)
    ).toBeTruthy()
    view.rerender(
      <ItemDetail {...base} history={{ items: [], nextCursor: null }} />
    )
    const history = within(region("History"))
    expect(history.queryByText(MANAGER_COPY.item.historyFailed)).toBeNull()
    expect(history.getByText(MANAGER_COPY.item.historyEmpty)).toBeTruthy()
  })

  it("waiting photos link to Review for the item; others' photos wait for an admin", () => {
    const card = {
      key: "k1",
      kind: "labelled" as const,
      labelId: "00000000-0000-4000-8000-000000000401",
      photoId: null,
      asset: photo().asset,
      uploadedAt: "2026-11-05T10:00:00.000Z",
      labelledAt: null,
      contributor: {
        id: "00000000-0000-4000-8000-000000000301",
        name: "Sam Lee",
        status: "here" as const,
        canFollowUp: true,
      },
      isSelf: false,
      item: null,
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
    showItem(detail({ waiting: { items: [card], nextCursor: null } }))
    const waiting = within(region("Waiting for review"))
    expect(waiting.getByText("1 photo waiting for a decision")).toBeTruthy()
    expect(
      waiting
        .getByRole("link", { name: "Review these photos" })
        .getAttribute("href")
    ).toBe(`/manager/review?item=${ITEM}`)
    cleanup()
    showItem(detail({ item: menuItem({ othersWaiting: 2 }) }))
    expect(
      within(region("Waiting for review")).getByText("Waiting for an admin")
    ).toBeTruthy()
  })
})
