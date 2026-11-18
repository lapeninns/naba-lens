// Match on add (DESIGN.md §6.1, D9): which empty slots Match offers, in
// which order, and what a search finds.
import { describe, expect, it } from "vitest"

import {
  byCaptureTime,
  matchBoardOf,
  searchNamesAmenity,
  searchSlots,
  suggestSlots,
  type MatchBoard,
  type MatchSlot,
} from "@/components/nabalens/album/match/model"
import { buildAlbum, type AlbumInput } from "@/lib/album/model"

const BAR = "00000000-0000-4000-8000-00000000b001"
const PASS = "00000000-0000-4000-8000-00000000b002"
const GARDEN = "00000000-0000-4000-8000-00000000b003"
const DRINKS = "00000000-0000-4000-8000-00000000c001"
const DESSERTS = "00000000-0000-4000-8000-00000000c002"

const dish = (
  n: number,
  name: string,
  sectionId: string,
  extra: Partial<AlbumInput["dishes"][number]> = {}
): AlbumInput["dishes"][number] => ({
  itemId: `00000000-0000-4000-8000-0000000d000${n}`,
  name,
  sectionId,
  sectionName: sectionId === DRINKS ? "Drinks" : "Desserts",
  covered: false,
  needsRecheck: false,
  thumbnailUrl: null,
  myWaiting: 0,
  reviewState: null,
  neededBy: null,
  ...extra,
})

const input: AlbumInput = {
  places: [
    { subjectId: BAR, label: "The bar" },
    { subjectId: PASS, label: "Kitchen pass" },
    { subjectId: GARDEN, label: "The garden" },
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
    dish(1, "Guinness, pint", DRINKS),
    dish(2, "Aperol spritz", DRINKS),
    // Accepted: not empty, never suggested; found by search (X5).
    dish(3, "Cider", DRINKS, { covered: true }),
    // Check due: found by search too (X5).
    dish(6, "Porter", DRINKS, { covered: true, coverage: "check_due" }),
    dish(4, "Sticky toffee pudding", DESSERTS),
    dish(5, "Crème brûlée", DESSERTS),
  ],
  amenities: [
    {
      checkId: "check-darts",
      question: "Is there a darts board?",
      category: "Games",
      progress: "needs_capture",
      answer: null,
      myLatestState: null,
    },
  ],
  areas: [{ subjectId: GARDEN, label: "The garden", state: "needed" }],
  myRetakeItemIds: new Set(),
}

const board = matchBoardOf(buildAlbum(input))
const names = (slots: MatchSlot[]) => slots.map((s) => s.name)

describe("matchBoardOf", () => {
  it("offers empty dish and area slots only, with their place", () => {
    expect(names(board.slots).sort()).toEqual(
      [
        "Aperol spritz",
        "Crème brûlée",
        "Guinness, pint",
        "Sticky toffee pudding",
        "The garden",
      ].sort()
    )
    const garden = board.slots.find((s) => s.name === "The garden")!
    expect(garden.target).toEqual({
      kind: "area",
      subjectId: GARDEN,
      name: "The garden",
    })
    expect(garden.placeLabel).toBe("The garden")
    const pint = board.slots.find((s) => s.name === "Guinness, pint")!
    expect(pint.target).toEqual({
      kind: "dish",
      itemId: input.dishes[0].itemId,
      name: "Guinness, pint",
    })
    expect(pint.place).toBe(BAR)
  })

  it("keeps slots already in the album apart, found by search only (X5)", () => {
    expect(names(board.filled ?? []).sort()).toEqual(["Cider", "Porter"])
    const cider = board.filled!.find((s) => s.name === "Cider")!
    expect(cider.filled).toBe("accepted")
    expect(board.filled!.find((s) => s.name === "Porter")!.filled).toBe(
      "check-due"
    )
    // Never suggested as empty…
    expect(
      names(
        suggestSlots(board, {
          current: BAR,
          last: null,
          taken: new Set(),
          limit: 20,
        })
      )
    ).not.toContain("Cider")
    // …but a search for it finds it, so Not on the menu? never shows for it.
    expect(names(searchSlots(board, "cider", new Set()))).toEqual(["Cider"])
    // Empty slots come first, filled ones last.
    expect(names(searchSlots(board, "drinks", new Set()))).toEqual([
      "Aperol spritz",
      "Guinness, pint",
      "Cider",
      "Porter",
    ])
  })

  it("keeps empty amenities aside, by name, for the search note", () => {
    expect(board.amenities).toEqual(["Is there a darts board?"])
  })
})

describe("suggestSlots", () => {
  it("puts the current place first, then the place last matched in, then the rest", () => {
    const got = suggestSlots(board, {
      current: PASS,
      last: GARDEN,
      taken: new Set(),
    })
    expect(names(got)).toEqual([
      "Crème brûlée",
      "Sticky toffee pudding",
      "The garden",
      // Then the rest, in Album's order.
      "Aperol spritz",
      "Guinness, pint",
    ])
  })

  it("never offers a slot already filled in this visit", () => {
    const taken = new Set([
      board.slots.find((s) => s.name === "Crème brûlée")!.id,
    ])
    expect(
      names(suggestSlots(board, { current: PASS, last: null, taken, limit: 1 }))
    ).toEqual(["Sticky toffee pudding"])
  })

  it("with no place known, starts with the place with the most gaps", () => {
    const got = suggestSlots(board, {
      current: null,
      last: null,
      taken: new Set(),
      limit: 2,
    })
    expect(new Set(got.map((s) => s.place)).size).toBe(1)
    expect(got.length).toBe(2)
  })

  it("stops at the limit", () => {
    expect(
      suggestSlots(board, {
        current: BAR,
        last: PASS,
        taken: new Set(),
        limit: 3,
      })
    ).toHaveLength(3)
  })
})

describe("searchSlots", () => {
  it("finds every word in name, section or place, ignoring case and accents", () => {
    expect(names(searchSlots(board, "creme", new Set()))).toEqual([
      "Crème brûlée",
    ])
    // Slots already in the album come after the empty ones (X5).
    expect(names(searchSlots(board, "bar", new Set()))).toEqual([
      "Aperol spritz",
      "Guinness, pint",
      "Cider",
      "Porter",
    ])
    expect(names(searchSlots(board, "kitchen sticky", new Set()))).toEqual([
      "Sticky toffee pudding",
    ])
  })

  it("puts name matches first", () => {
    const b: MatchBoard = {
      amenities: [],
      slots: [
        { ...board.slots[0], id: "a", name: "Pint glass", placeLabel: "Bar" },
        {
          ...board.slots[0],
          id: "b",
          name: "Ale",
          placeLabel: "The pint room",
        },
      ],
    }
    expect(names(searchSlots(b, "pint", new Set()))).toEqual([
      "Pint glass",
      "Ale",
    ])
  })

  it("finds nothing for an empty query", () => {
    expect(searchSlots(board, "   ", new Set())).toEqual([])
  })

  it("says when the search names an amenity, which Match never offers", () => {
    expect(searchSlots(board, "darts", new Set())).toEqual([])
    expect(searchNamesAmenity(board, "darts")).toBe(true)
    expect(searchNamesAmenity(board, "pudding")).toBe(false)
  })
})

describe("byCaptureTime", () => {
  it("orders photos by when they were taken", () => {
    const file = (name: string, lastModified: number) =>
      new File([""], name, { lastModified })
    const got = byCaptureTime([
      { file: file("b", 20) },
      { file: file("a", 10) },
      { file: file("c", 30) },
    ])
    expect(got.map((p) => p.file.name)).toEqual(["a", "b", "c"])
  })
})
