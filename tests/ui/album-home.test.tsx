// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AlbumHome } from "@/components/nabalens/album/album-home"
import { AlbumPlaceScreen } from "@/components/nabalens/album/album-place"
import {
  AlbumPlacesForm,
  type AlbumPlacesGroup,
} from "@/components/nabalens/album/album-places-form"
import {
  AddProvider,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { buildAlbum, currentPlace, type AlbumInput } from "@/lib/album/model"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/staff/tasks",
}))

afterEach(cleanup)

const BAR = "00000000-0000-4000-8000-00000000b001"
const PASS = "00000000-0000-4000-8000-00000000b002"
const DRINKS = "00000000-0000-4000-8000-00000000c001"
const DESSERTS = "00000000-0000-4000-8000-00000000c002"

const input: AlbumInput = {
  places: [
    { subjectId: BAR, label: "The bar" },
    { subjectId: PASS, label: "Kitchen pass" },
  ],
  placements: [
    { source: "menu_section", key: "drinks", subjectId: BAR },
    { source: "menu_section", key: "desserts", subjectId: PASS },
    { source: "amenity_category", key: "Games", subjectId: BAR },
  ],
  sections: [
    { sectionId: DRINKS, slug: "drinks" },
    { sectionId: DESSERTS, slug: "desserts" },
  ],
  dishes: [
    {
      itemId: "00000000-0000-4000-8000-0000000d0001",
      name: "Guinness, pint",
      sectionId: DRINKS,
      sectionName: "Drinks",
      covered: false,
      needsRecheck: false,
      thumbnailUrl: null,
      myWaiting: 0,
      reviewState: null,
      neededBy: null,
    },
    {
      itemId: "00000000-0000-4000-8000-0000000d0002",
      name: "Aperol spritz",
      sectionId: DRINKS,
      sectionName: "Drinks",
      covered: true,
      needsRecheck: false,
      thumbnailUrl: "/thumb.jpg",
      myWaiting: 0,
      reviewState: null,
      neededBy: null,
    },
    {
      itemId: "00000000-0000-4000-8000-0000000d0003",
      name: "Sticky toffee pudding",
      sectionId: DESSERTS,
      sectionName: "Desserts",
      covered: false,
      needsRecheck: false,
      thumbnailUrl: null,
      myWaiting: 1,
      reviewState: "waiting",
      neededBy: null,
    },
  ],
  amenities: [
    {
      checkId: "00000000-0000-4000-8000-0000000a0001",
      question: "Can guests play darts?",
      category: "Games",
      progress: "needs_capture",
      answer: null,
      myLatestState: null,
    },
  ],
  areas: [],
  myRetakeItemIds: new Set(),
}

const album = buildAlbum(input)

function renderHome(openAdd = vi.fn(), place: string | null = null) {
  render(
    <AddProvider value={{ openAdd }}>
      <AlbumHome
        venueName="The Bell"
        album={album}
        current={currentPlace(album, place)}
        retakes={[]}
        canAdd
        blocked={null}
      />
    </AddProvider>
  )
  return openAdd
}

describe("Album Home (DESIGN.md §5a)", () => {
  it("leads with the venue's empty slots, then the count line", () => {
    renderHome()
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /2\s*slots still empty/
    )
    expect(screen.getByText("1 in · 1 waiting · 4 in all")).toBeTruthy()
  })

  it("opens on the place with most gaps and lists the places with their counts", () => {
    renderHome()
    const bar = screen.getByRole("link", { name: /The bar\s*2 empty/ })
    expect(bar.getAttribute("aria-current")).toBe("true")
    expect(
      screen.getByRole("link", { name: /Kitchen pass\s*0 empty/ })
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Empty at The bar" })
    ).toBeTruthy()
  })

  it("shows only empty slots where you are", () => {
    renderHome()
    const here = screen
      .getByRole("heading", { name: "Empty at The bar" })
      .closest("section")!
    expect(
      within(here).getByRole("button", { name: "Guinness, pint: needed" })
    ).toBeTruthy()
    expect(
      within(here)
        .getByRole("link", { name: "Can guests play darts?: needed" })
        .getAttribute("href")
    ).toBe("/staff/tasks/amenities/00000000-0000-4000-8000-0000000a0001")
    expect(within(here).queryByText("Aperol spritz")).toBeNull()
  })

  it("opens the gallery, not a camera, with the dish chosen", async () => {
    const openAdd = renderHome()
    await userEvent.click(
      screen.getByRole("button", { name: "Guinness, pint: needed" })
    )
    // One photo from the gallery, straight to this slot (AL-1, §6.1).
    const opts = openAdd.mock.calls[0][0] as OpenAddOptions
    expect(opts.slot).toEqual({
      kind: "dish",
      itemId: expect.any(String),
      name: "Guinness, pint",
    })
    expect(opts.source).toBeUndefined()
  })

  it("has one main button, and it opens the gallery", async () => {
    const openAdd = renderHome()
    await userEvent.click(
      screen.getByRole("button", { name: "Add photos from your gallery" })
    )
    // The gallery, then Match, suggesting where the person is (AL-1, §6.1).
    expect((openAdd.mock.calls[0][0] as OpenAddOptions).match).toEqual({
      place: expect.any(String),
    })
    expect(document.body.innerHTML).not.toMatch(/camera/i)
  })

  it("says when a place has nothing empty", () => {
    renderHome(vi.fn(), PASS)
    expect(
      screen.getByText(
        "Nothing is empty at Kitchen pass. Choose another place."
      )
    ).toBeTruthy()
  })
})

describe("Album place (DESIGN.md §6.2)", () => {
  it("shows every slot by section with filled of total", () => {
    render(
      <AlbumPlaceScreen
        venueName="The Bell"
        place={currentPlace(album, BAR)!}
        canAdd
      />
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "The bar" })
    ).toBeTruthy()
    expect(screen.getByText("2 empty of 3")).toBeTruthy()
    const drinks = screen
      .getByRole("heading", { name: "Drinks" })
      .closest("section")!
    expect(within(drinks).getByText("1 of 2")).toBeTruthy()
    expect(
      within(drinks).getByRole("group", { name: "Aperol spritz: in the album" })
    ).toBeTruthy()
  })

  it("names each section region, even when its name has spaces (revb should-fix 4)", () => {
    const spaced = buildAlbum({
      ...input,
      placements: [
        ...input.placements.filter((p) => p.source !== "amenity_category"),
        {
          source: "amenity_category",
          key: "Games and amenities",
          subjectId: BAR,
        },
      ],
      amenities: input.amenities.map((a) => ({
        ...a,
        category: "Games and amenities",
      })),
    })
    render(
      <AlbumPlaceScreen
        venueName="The Bell"
        place={currentPlace(spaced, BAR)!}
        canAdd
      />
    )
    expect(
      screen.getByRole("region", { name: "Games and amenities" })
    ).toBeTruthy()
    expect(screen.getByRole("region", { name: "Drinks" })).toBeTruthy()
    for (const region of screen.getAllByRole("region"))
      expect(region.getAttribute("aria-labelledby")).not.toMatch(/\s/)
  })
})

describe("Album places (manager)", () => {
  const groups: AlbumPlacesGroup[] = [
    { source: "menu_section", key: "drinks", name: "Drinks", subjectId: BAR },
    {
      source: "amenity_category",
      key: "Games",
      name: "Games",
      subjectId: null,
    },
  ]
  const places = [
    { subjectId: BAR, label: "The bar" },
    { subjectId: PASS, label: "Kitchen pass" },
  ]

  it("labels each group's place and saves a change, saying so on the page", async () => {
    const onSet = vi.fn().mockResolvedValue({ ok: true })
    render(<AlbumPlacesForm places={places} groups={groups} onSet={onSet} />)
    const games = screen.getByLabelText("Games") as HTMLSelectElement
    expect(games.value).toBe("")
    await userEvent.selectOptions(games, PASS)
    expect(onSet).toHaveBeenCalledWith({
      source: "amenity_category",
      key: "Games",
      subjectId: PASS,
    })
    expect(
      await screen.findByText("Saved: Games is photographed at Kitchen pass.")
    ).toBeTruthy()
  })

  it("puts the old place back and says why when saving fails", async () => {
    const onSet = vi.fn().mockResolvedValue({
      ok: false,
      message:
        "That place is no longer listed for this venue. Reload the page.",
    })
    render(<AlbumPlacesForm places={places} groups={groups} onSet={onSet} />)
    const drinks = screen.getByLabelText("Drinks") as HTMLSelectElement
    await userEvent.selectOptions(drinks, "")
    expect(await screen.findByText(/no longer listed/)).toBeTruthy()
    expect(drinks.value).toBe(BAR)
  })
})
