// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  OUR_MENU_COPY,
  OurMenuScreen,
  ourMenuHref,
  waitingFor,
  type LoadOurMenuItems,
  type OurMenuFilter,
  type OurMenuLoad,
} from "@/components/nabalens/menu-photos"
import {
  AddProvider,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import type {
  OurMenuItem,
  OurMenuSection,
  OurMenuView,
} from "@/lib/server/coverage/types"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

afterEach(() => {
  cleanup()
  refresh.mockClear()
})

const VENUE = {
  id: "00000000-0000-4000-8000-0000000000a1",
  name: "The Railway",
}
const STARTERS = "00000000-0000-4000-8000-0000000000b1"
const MAINS = "00000000-0000-4000-8000-0000000000b2"

function section(
  sectionId: string,
  name: string,
  eligible: number,
  covered: number
): OurMenuSection {
  return {
    sectionId,
    name,
    kind: "food",
    position: sectionId === STARTERS ? 1 : 2,
    eligible,
    covered,
    needsRecheck: 0,
    review: null,
  }
}

function item(over: Partial<OurMenuItem> = {}): OurMenuItem {
  return {
    itemId: "00000000-0000-4000-8000-0000000000c1",
    sectionId: STARTERS,
    sectionName: "Starters",
    sectionKind: "food",
    name: "Soup",
    description: null,
    variants: [],
    covered: false,
    acceptedCount: 0,
    needsRecheck: false,
    primary: null,
    itemRevision: 1,
    review: null,
    ...over,
  }
}

const SECTIONS = [
  section(STARTERS, "Starters", 2, 1),
  section(MAINS, "Mains", 1, 0),
]

function menu(over: Partial<OurMenuView> = {}): OurMenuView {
  return {
    venue: VENUE,
    menuState: "ready",
    menuVersionId: "00000000-0000-4000-8000-0000000000d1",
    totals: { eligible: 3, covered: 1, gaps: 2, needsRecheck: 0 },
    sections: SECTIONS,
    review: null,
    canReview: false,
    ...over,
  }
}

const ITEMS: OurMenuItem[] = [
  item(),
  item({
    itemId: "00000000-0000-4000-8000-0000000000c2",
    name: "Salad",
    covered: true,
    acceptedCount: 2,
    variants: [
      { variantId: "00000000-0000-4000-8000-0000000000e1", name: "Small" },
      { variantId: "00000000-0000-4000-8000-0000000000e2", name: "Large" },
    ],
    primary: {
      photoId: "00000000-0000-4000-8000-0000000000f1",
      asset: {
        id: "00000000-0000-4000-8000-0000000000f2",
        thumbnailUrl:
          "/api/menu-photos/00000000-0000-4000-8000-0000000000f2/thumb",
        previewUrl: null,
        width: 320,
        height: 240,
        available: true,
      },
    },
  }),
  item({
    itemId: "00000000-0000-4000-8000-0000000000c3",
    sectionId: MAINS,
    sectionName: "Mains",
    name: "Pie",
    needsRecheck: true,
  }),
]

const ALL: OurMenuFilter = { sectionId: null, gapsOnly: false, query: "" }

function ready(items = ITEMS, nextCursor: string | null = null): OurMenuLoad {
  return { state: "ready", menu: menu(), items: { items, nextCursor } }
}

function renderScreen(
  props: Partial<React.ComponentProps<typeof OurMenuScreen>> = {},
  openAdd?: (opts?: OpenAddOptions) => void
) {
  const screenEl = (
    <OurMenuScreen load={ready()} filter={ALL} canAdd {...props} />
  )
  return render(
    openAdd ? (
      <AddProvider value={{ openAdd }}>{screenEl}</AddProvider>
    ) : (
      screenEl
    )
  )
}

describe("Our menu (staff)", () => {
  it("groups dishes by section with each section's accepted count", () => {
    renderScreen()
    expect(
      screen.getByRole("heading", { level: 1, name: "Our menu" })
    ).toBeTruthy()
    expect(
      screen.getByText("1 of 3 menu items have an accepted photo.")
    ).toBeTruthy()
    const starters = screen.getByRole("region", { name: "Starters" })
    expect(
      within(starters).getByText("1 of 2 with an accepted photo")
    ).toBeTruthy()
    expect(
      within(starters)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent)
    ).toEqual(["Soup", "Salad"])
    const mains = screen.getByRole("region", { name: "Mains" })
    expect(
      within(mains).getByText("0 of 1 with an accepted photo")
    ).toBeTruthy()
    expect(within(mains).getByText(OUR_MENU_COPY.recheck)).toBeTruthy()
  })

  it("shows whether each dish has an accepted photo", () => {
    renderScreen()
    const soup = screen.getByRole("article", { name: "Soup" })
    expect(within(soup).getByText(OUR_MENU_COPY.gaps)).toBeTruthy()
    const salad = screen.getByRole("article", { name: "Salad" })
    expect(within(salad).getByText(OUR_MENU_COPY.hasPhoto)).toBeTruthy()
    expect(within(salad).getByText("Small, Large")).toBeTruthy()
    expect(within(salad).getByText("2 accepted photos")).toBeTruthy()
  })

  it("opens the camera with the dish applied as a label", async () => {
    const user = userEvent.setup()
    const openAdd = vi.fn()
    renderScreen({}, openAdd)
    const soup = screen.getByRole("article", { name: "Soup" })
    const button = within(soup).getByRole("button", {
      name: "Take a photo of this dish",
    })
    // The dish's name describes the button, so each row's button is distinct.
    expect(button.getAttribute("aria-describedby")).toBeTruthy()
    expect(
      document.getElementById(button.getAttribute("aria-describedby")!)
        ?.textContent
    ).toBe("Soup")
    await user.click(button)
    expect(openAdd).toHaveBeenCalledTimes(1)
    expect(openAdd).toHaveBeenCalledWith({
      source: "camera",
      imagesOnly: true,
      preset: {
        itemId: ITEMS[0].itemId,
        variantId: null,
        itemName: "Soup",
        variantName: null,
      },
      // B02-05: the guidance step before the camera, where the entry is on.
      guide: true,
    })
  })

  it("offers no add button to staff who cannot upload, or outside the staff layout", () => {
    const openAdd = vi.fn()
    renderScreen({ canAdd: false }, openAdd)
    expect(
      screen.queryByRole("button", { name: "Take a photo of this dish" })
    ).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Choose from photos" })
    ).toBeNull()
    cleanup()
    renderScreen({ canAdd: true })
    expect(
      screen.queryByRole("button", { name: "Take a photo of this dish" })
    ).toBeNull()
  })

  it("links the filters through the URL and keeps the search", () => {
    renderScreen({ filter: { ...ALL, query: "so" } })
    const show = screen.getByRole("navigation", { name: "Show" })
    expect(
      within(show)
        .getByRole("link", { name: OUR_MENU_COPY.gaps })
        .getAttribute("href")
    ).toBe("/staff/menu?filter=gaps&q=so")
    expect(
      within(show)
        .getByRole("link", { name: OUR_MENU_COPY.allDishes })
        .getAttribute("aria-current")
    ).toBe("page")
    const sections = screen.getByRole("navigation", { name: "Menu sections" })
    expect(
      within(sections)
        .getByRole("link", { name: /^Starters/ })
        .getAttribute("href")
    ).toBe(`/staff/menu?section=${STARTERS}&q=so`)
    const search = screen.getByRole("search", { name: "Menu search" })
    expect(search.getAttribute("action")).toBe("/staff/menu")
    expect(search.getAttribute("method")).toBe("get")
    expect(
      (within(search).getByLabelText("Search the menu") as HTMLInputElement)
        .value
    ).toBe("so")
    expect(
      screen
        .getByRole("link", { name: OUR_MENU_COPY.clear })
        .getAttribute("href")
    ).toBe("/staff/menu")
  })

  it("keeps the gaps filter and section in the search form", () => {
    const { container } = renderScreen({
      filter: { sectionId: MAINS, gapsOnly: true, query: "" },
    })
    const hidden = Array.from(
      container.querySelectorAll<HTMLInputElement>('form input[type="hidden"]')
    ).map((i) => [i.name, i.value])
    expect(hidden).toEqual([
      ["section", MAINS],
      ["filter", "gaps"],
    ])
    expect(
      screen
        .getByRole("link", { name: OUR_MENU_COPY.gaps })
        .getAttribute("aria-current")
    ).toBe("page")
    expect(
      screen.getByRole("link", { name: /^Mains/ }).getAttribute("aria-current")
    ).toBe("page")
  })

  it("says when nothing matches a search, with a way back", () => {
    renderScreen({ load: ready([]), filter: { ...ALL, query: "zzz" } })
    expect(screen.getByText(OUR_MENU_COPY.noMatches)).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: OUR_MENU_COPY.allDishes, current: false })
        .getAttribute("href")
    ).toBe("/staff/menu")
  })

  it("says every dish has a photo when the gaps filter is empty", () => {
    renderScreen({ load: ready([]), filter: { ...ALL, gapsOnly: true } })
    expect(screen.getByText(OUR_MENU_COPY.allCovered)).toBeTruthy()
  })

  it("shows the no-menu wording exactly", () => {
    renderScreen({
      load: {
        state: "no_menu",
        menu: menu({ menuState: "no_menu", sections: [] }),
      },
    })
    expect(
      screen.getByText(
        "Menu photos will appear once your venue’s menu is set up"
      )
    ).toBeTruthy()
    expect(screen.queryByRole("search")).toBeNull()
  })

  it("tells an empty menu apart from a missing one", () => {
    renderScreen({
      load: {
        state: "empty",
        menu: menu({ menuState: "empty", sections: [] }),
      },
    })
    expect(screen.getByText(OUR_MENU_COPY.emptyTitle)).toBeTruthy()
    expect(screen.queryByText(OUR_MENU_COPY.noMenu)).toBeNull()
  })

  it("offers to try again when the menu could not load", async () => {
    const user = userEvent.setup()
    renderScreen({ load: { state: "unavailable" } })
    expect(screen.getByText(OUR_MENU_COPY.unavailableTitle)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("explains a missing venue", () => {
    renderScreen({ load: { state: "needs_venue" } })
    expect(screen.getByText(OUR_MENU_COPY.needsVenue)).toBeTruthy()
  })

  it("loads more dishes with the same filters", async () => {
    const user = userEvent.setup()
    const loadItems = vi.fn<LoadOurMenuItems>(async () => ({
      ok: true as const,
      items: [
        item({
          itemId: "00000000-0000-4000-8000-0000000000c9",
          sectionId: MAINS,
          sectionName: "Mains",
          name: "Curry",
        }),
      ],
      nextCursor: null,
    }))
    renderScreen({
      load: ready(ITEMS.slice(0, 1), "cursor-1"),
      filter: { sectionId: null, gapsOnly: true, query: "c" },
      loadItems,
    })
    await user.click(screen.getByRole("button", { name: "Load more" }))
    expect(loadItems).toHaveBeenCalledWith({
      gapsOnly: true,
      query: "c",
      cursor: "cursor-1",
    })
    expect(await screen.findByRole("article", { name: "Curry" })).toBeTruthy()
  })
})

describe("Our menu helpers", () => {
  it("builds filter URLs without empty values", () => {
    expect(ourMenuHref("/staff/menu")).toBe("/staff/menu")
    expect(
      ourMenuHref("/staff/manage/menu/items", {
        view: "items",
        gapsOnly: true,
        query: "pie & mash",
      })
    ).toBe("/staff/manage/menu/items?view=items&filter=gaps&q=pie+%26+mash")
  })

  it("says how long a photo has waited", () => {
    const now = "2026-11-07T12:00:00.000Z"
    expect(waitingFor(null, now)).toBeNull()
    expect(waitingFor("2026-11-07T11:30:00.000Z", now)).toBe("under an hour")
    expect(waitingFor("2026-11-07T07:00:00.000Z", now)).toBe("5 hours")
    expect(waitingFor("2026-11-06T11:00:00.000Z", now)).toBe("1 day")
    expect(waitingFor("2026-11-04T12:00:00.000Z", now)).toBe("3 days")
  })
})
