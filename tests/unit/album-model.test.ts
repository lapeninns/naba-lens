import { describe, expect, it } from "vitest"

import {
  AREA_GROUP,
  amenityState,
  buildAlbum,
  currentPlace,
  dishState,
  type AlbumInput,
  type AmenityInput,
  type DishInput,
} from "@/lib/album/model"

const BAR = "00000000-0000-4000-8000-00000000b001"
const PASS = "00000000-0000-4000-8000-00000000b002"
const DRINKS = "00000000-0000-4000-8000-00000000c001"
const DESSERTS = "00000000-0000-4000-8000-00000000c002"

const dish = (over: Partial<DishInput> = {}): DishInput => ({
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
  ...over,
})

const check = (over: Partial<AmenityInput> = {}): AmenityInput => ({
  checkId: "00000000-0000-4000-8000-0000000a0001",
  question: "Can guests play darts?",
  category: "Games",
  progress: "needs_capture",
  answer: null,
  myLatestState: null,
  ...over,
})

const base = (over: Partial<AlbumInput> = {}): AlbumInput => ({
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
  dishes: [],
  amenities: [],
  areas: [],
  myRetakeItemIds: new Set(),
  ...over,
})

describe("dishState", () => {
  it("is accepted once covered, unless a menu change reopened it", () => {
    expect(dishState(dish({ covered: true }), false)).toBe("accepted")
    expect(dishState(dish({ covered: true, needsRecheck: true }), false)).toBe(
      "needed"
    )
  })
  it("is waiting while a photo waits for review or is being checked", () => {
    expect(dishState(dish({ myWaiting: 1 }), false)).toBe("waiting")
    expect(dishState(dish({ reviewState: "waiting" }), false)).toBe("waiting")
    expect(dishState(dish({ reviewState: "being_checked" }), false)).toBe(
      "waiting"
    )
  })
  it("is a retake only for the person asked", () => {
    expect(dishState(dish(), true)).toBe("retake")
    expect(dishState(dish(), false)).toBe("needed")
  })
})

describe("amenityState", () => {
  it("reads No and Not applicable as Not here", () => {
    expect(amenityState(check({ progress: "complete", answer: "no" }))).toBe(
      "not-here"
    )
    expect(
      amenityState(check({ progress: "complete", answer: "not_applicable" }))
    ).toBe("not-here")
    expect(amenityState(check({ progress: "complete", answer: "yes" }))).toBe(
      "accepted"
    )
  })
  it("is waiting after I send, retake when it needs attention or a recheck", () => {
    expect(amenityState(check({ myLatestState: "submitted" }))).toBe("waiting")
    expect(amenityState(check({ myLatestState: "saved" }))).toBe("needed")
    expect(amenityState(check({ myLatestState: "needs_attention" }))).toBe(
      "retake"
    )
    expect(amenityState(check({ progress: "needs_recheck" }))).toBe("retake")
  })
})

describe("buildAlbum", () => {
  it("places dishes by section slug, amenities by category, areas as themselves", () => {
    const view = buildAlbum(
      base({
        dishes: [
          dish(),
          dish({
            itemId: "00000000-0000-4000-8000-0000000d0002",
            name: "Sticky toffee pudding",
            sectionId: DESSERTS,
            sectionName: "Desserts",
            covered: true,
          }),
        ],
        amenities: [check()],
        areas: [{ subjectId: BAR, label: "The bar", state: "needed" }],
      })
    )
    const bar = view.places.find((p) => p.subjectId === BAR)!
    expect(bar.groups.map((g) => g.name)).toEqual([
      "Drinks",
      "Games",
      AREA_GROUP,
    ])
    expect(bar.empty).toBe(3)
    const pass = view.places.find((p) => p.subjectId === PASS)!
    expect(pass.groups[0].slots[0].state).toBe("accepted")
    expect(view.unplaced).toBeNull()
  })

  it("keeps a group with no place under Not placed yet", () => {
    const view = buildAlbum(
      base({ placements: [], dishes: [dish()], amenities: [check()] })
    )
    expect(view.places).toEqual([])
    expect(view.unplaced?.label).toBe("Not placed yet")
    expect(view.unplaced?.total).toBe(2)
  })

  it("ignores a placement at a place that is no longer listed", () => {
    const view = buildAlbum(
      base({
        places: [{ subjectId: PASS, label: "Kitchen pass" }],
        dishes: [dish()],
      })
    )
    expect(view.unplaced?.total).toBe(1)
  })

  it("counts empty, waiting and filled, and leaves Not here out of the total", () => {
    const view = buildAlbum(
      base({
        dishes: [
          dish(),
          dish({
            itemId: "00000000-0000-4000-8000-0000000d0003",
            myWaiting: 1,
          }),
          dish({
            itemId: "00000000-0000-4000-8000-0000000d0004",
            covered: true,
          }),
        ],
        amenities: [check({ progress: "complete", answer: "no" })],
      })
    )
    expect(view.counts).toEqual({ filled: 1, waiting: 1, empty: 1, total: 3 })
  })

  it("orders places by most empty; slots by a manager's needed-by, then retakes, then needed (spec §6 S1)", () => {
    const view = buildAlbum(
      base({
        dishes: [
          dish({ covered: true }),
          dish({
            itemId: "00000000-0000-4000-8000-0000000d0005",
            name: "Aperol",
          }),
          dish({
            itemId: "00000000-0000-4000-8000-0000000d0006",
            name: "Cider",
            neededBy: { date: "2026-11-30", passed: false },
          }),
          dish({
            itemId: "00000000-0000-4000-8000-0000000d0007",
            sectionId: DESSERTS,
            sectionName: "Desserts",
          }),
        ],
        myRetakeItemIds: new Set(["00000000-0000-4000-8000-0000000d0005"]),
      })
    )
    expect(view.places.map((p) => p.label)).toEqual(["The bar", "Kitchen pass"])
    const drinks = view.places[0].groups[0].slots
    expect(drinks.map((s) => s.state)).toEqual(["needed", "retake", "accepted"])
    expect(drinks[0].neededBy).toMatch(/^Needed by /)
  })

  it("opens on a place that fits the person's work areas when none was asked for", () => {
    const view = buildAlbum(
      base({
        dishes: [
          dish(),
          dish({
            itemId: "00000000-0000-4000-8000-0000000d0007",
            sectionId: DESSERTS,
            sectionName: "Desserts",
          }),
        ],
      })
    )
    // Both places have gaps; the person works the pass.
    expect(currentPlace(view, null, ["plating"])?.label).toBe("Kitchen pass")
    expect(currentPlace(view, null, ["bar"])?.label).toBe("The bar")
    // An asked-for place always wins; no areas is All (most gaps first).
    expect(currentPlace(view, BAR, ["plating"])?.subjectId).toBe(BAR)
    expect(currentPlace(view, null, [])?.label).toBe(view.places[0].label)
  })

  it("opens on the place asked for, else the one with most gaps", () => {
    const view = buildAlbum(base({ dishes: [dish()] }))
    expect(currentPlace(view, PASS)?.subjectId).toBe(BAR)
    expect(currentPlace(view, BAR)?.subjectId).toBe(BAR)
    expect(currentPlace(buildAlbum(base()), null)).toBeNull()
  })
})
