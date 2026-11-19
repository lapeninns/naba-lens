import { describe, expect, it } from "vitest"

import type { AlbumPlace, AlbumSlot, AlbumView } from "@/lib/album/model"
import {
  albumParts,
  buildShelves,
  defaultShow,
  isAlbumPartKey,
  isShelfOf,
  normaliseName,
  partType,
  shelfOf,
  suggestShelf,
} from "@/lib/album/shelves"

describe("suggestShelf (DESIGN.md §5d): the dev venue's sections", () => {
  const food: Record<string, string> = {
    Starters: "food.starters",
    "Chef Selection": "food.specials",
    "Clay Oven": "food.mains",
    "Dum Biryani": "food.mains",
    "Mixed Grills": "food.mains",
    Curries: "food.mains",
    Rice: "food.sides",
    Naans: "food.sides",
    Sides: "food.sides",
    Fries: "food.sides",
    Chowmein: "food.mains",
    "Pub Grub": "food.mains",
    "Pub Classic": "food.mains",
    Kids: "food.kids",
    Desserts: "food.desserts",
    "Old Crown House Special": "food.specials",
    "Test menu": "food.more",
  }
  const drinks: Record<string, string> = {
    "Draught Beer & Cider": "drinks.beer",
    "Bottled Ciders": "drinks.beer",
    "Bottled Lager & Beer": "drinks.beer",
    "No & Low Alcohol Beer & Cider": "drinks.beer",
    "Soft Drinks": "drinks.soft",
    "Juices & Water": "drinks.soft",
    "Hot Drinks": "drinks.soft",
    "Loose Leaf Tea": "drinks.soft",
    "Cocktail Classics": "drinks.cocktails",
    "The Garden Party Jugs": "drinks.cocktails",
    "Sparkling Wine": "drinks.wine",
    "White Wine": "drinks.wine",
    "Red Wine": "drinks.wine",
    "Rosé Wine": "drinks.wine",
    Gin: "drinks.spirits",
    Vodka: "drinks.spirits",
    Rum: "drinks.spirits",
    Whisky: "drinks.spirits",
    "Liqueurs & Shots": "drinks.spirits",
    Brandy: "drinks.spirits",
  }
  it.each(Object.entries(food))("food: %s", (name, shelf) => {
    expect(suggestShelf("food", name)).toBe(shelf)
  })
  it.each(Object.entries(drinks))("drinks: %s", (name, shelf) => {
    expect(suggestShelf("drinks", name)).toBe(shelf)
  })

  it("checks the narrower shelf first", () => {
    expect(suggestShelf("food", "Kids Burgers")).toBe("food.kids")
    expect(suggestShelf("drinks", "Gin Cocktails")).toBe("drinks.cocktails")
    expect(suggestShelf("drinks", "Bottled Water")).toBe("drinks.soft")
  })

  it("normalises accents, apostrophes and punctuation", () => {
    expect(normaliseName("Rosé & Chef’s")).toBe("rose chefs")
  })
})

const slot = (id: string, over: Partial<AlbumSlot> = {}): AlbumSlot =>
  ({
    id,
    name: id,
    group: "Gin",
    state: "needed",
    thumbnailUrl: null,
    category: "drinks",
    sectionKey: "gin",
    ...over,
  }) as AlbumSlot

const place = (subjectId: string | null, slots: AlbumSlot[]): AlbumPlace => ({
  subjectId,
  label: subjectId ?? "Not placed yet",
  groups: [{ name: "x", slots, filled: 0, total: slots.length }],
  empty: 0,
  total: slots.length,
})

const view = (places: AlbumPlace[], unplaced: AlbumPlace | null = null) =>
  ({ counts: {}, places, unplaced }) as unknown as AlbumView

describe("shelfOf", () => {
  it("lets a manager's choice win, within the slot's type only", () => {
    const s = slot("dish:1")
    expect(shelfOf(s, new Map()).key).toBe("drinks.spirits")
    expect(shelfOf(s, new Map([["gin", "drinks.cocktails"]])).key).toBe(
      "drinks.cocktails"
    )
    // A food shelf can't hold a drink: the suggestion stands.
    expect(shelfOf(s, new Map([["gin", "food.mains"]])).key).toBe(
      "drinks.spirits"
    )
    expect(isShelfOf("spaces", "drinks.beer")).toBe(false)
  })

  it("puts amenities on their category and areas on The venue", () => {
    expect(
      shelfOf(
        slot("amenity:1", { category: "facilities", group: "Pets" }),
        new Map()
      )
    ).toEqual({ key: "facilities.Pets", label: "Pets" })
    expect(
      shelfOf(
        slot("area:1", { category: "spaces", group: "The space" }),
        new Map()
      ).label
    ).toBe("The venue")
  })
})

describe("buildShelves", () => {
  const bar = place("bar", [
    slot("dish:gin1", { state: "accepted", thumbnailUrl: "/t/1" }),
    slot("dish:gin2"),
    slot("dish:red1", { group: "Red Wine", sectionKey: "red-wine" }),
    slot("dish:pack", {
      group: "Red Wine",
      sectionKey: "red-wine",
      optional: true,
    }),
  ])
  const kitchen = place("kitchen", [
    slot("dish:naan", {
      group: "Naans",
      sectionKey: "naans",
      category: "food",
    }),
    slot("dish:kids", {
      group: "Kids",
      sectionKey: "kids",
      category: "food",
      state: "waiting",
    }),
  ])

  it("groups by type, shelf and section with counts", () => {
    const v = buildShelves(view([bar, kitchen]), {
      sectionOrder: ["naans", "kids", "red-wine", "gin"],
    })
    expect(v.types.map((t) => t.label)).toEqual(["Food", "Drinks"])
    const drinks = v.types[1]!
    expect(drinks.shelves.map((s) => s.label)).toEqual([
      "Wine & fizz",
      "Spirits",
    ])
    expect(drinks).toMatchObject({ total: 3, filled: 1, empty: 2 })
    expect(drinks.covers).toEqual(["/t/1"])
    expect(drinks.shelves[1]!.covers).toEqual(["/t/1"])
    expect(drinks.shelves[0]!.covers).toEqual([])
    const food = v.types[0]!
    expect(food.shelves.map((s) => s.label)).toEqual([
      "Rice, breads & sides",
      "Kids",
    ])
    expect(food).toMatchObject({ waiting: 1, empty: 1 })
    expect(v).toMatchObject({ total: 5, empty: 3 })
  })

  it("filters by place, keeps menu order and leaves optional out of counts", () => {
    const v = buildShelves(view([bar, kitchen]), { lens: "bar" })
    expect(v.types.map((t) => t.label)).toEqual(["Drinks"])
    const wine = v.types[0]!.shelves[0]!
    expect(wine.sections[0]!.slots).toHaveLength(2)
    expect(wine).toMatchObject({ total: 1, empty: 1 })
  })

  it("reads Not placed yet as its own lens", () => {
    const loose = place(null, [slot("dish:x")])
    expect(buildShelves(view([bar], loose), { lens: "unplaced" }).total).toBe(1)
  })

  it("opens on Needed while anything is empty", () => {
    expect(defaultShow({ total: 2, filled: 1, waiting: 0, empty: 1 })).toBe(
      "needed"
    )
    expect(defaultShow({ total: 2, filled: 2, waiting: 0, empty: 0 })).toBe(
      "all"
    )
  })
})

describe("albumParts (DESIGN.md §5d)", () => {
  const all = place("all", [
    slot("dish:gin", { category: "drinks" }),
    slot("dish:naan", {
      group: "Naans",
      sectionKey: "naans",
      category: "food",
    }),
    slot("amenity:1", {
      category: "facilities",
      group: "Pets",
      state: "accepted",
    }),
    slot("amenity:2", { category: "other", group: "Other" }),
    slot("area:1", { category: "spaces", group: "The space" }),
  ])
  const parts = albumParts(buildShelves(view([all])))

  it("groups types into Menu, Amenities and Spaces, in that order", () => {
    expect(parts.map((p) => p.label)).toEqual(["Menu", "Amenities", "Spaces"])
    expect(parts[0]!.types.map((t) => t.label)).toEqual(["Food", "Drinks"])
    expect(parts[1]).toMatchObject({ total: 2, filled: 1, empty: 1 })
    expect(parts[1]!.shelves.map((s) => s.label)).toEqual(["Pets", "Other"])
  })

  it("leaves out a part with no slots and picks Menu's type", () => {
    const bar = albumParts(
      buildShelves(view([place("bar", [slot("dish:gin")])]))
    )
    expect(bar.map((p) => p.key)).toEqual(["menu"])
    expect(partType(bar[0]!, "food")?.category).toBe("drinks")
    expect(partType(parts[0]!, undefined)?.category).toBe("food")
    expect(partType(parts[0]!, "drinks")?.category).toBe("drinks")
    expect(isAlbumPartKey("menu")).toBe(true)
    expect(isAlbumPartKey("food")).toBe(false)
  })
})
