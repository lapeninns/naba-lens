// Full App v1, S1-COV: the coverage rule as Album reads it (lib/album/model.ts;
// 20261118100200_coverage_slots.sql). Slot states follow the rule, with the
// viewer's own sending and retake notes laid over it; a reference photo never
// covers (the database decides that); Check due is its own state (FA-11);
// an amenity's photo has its own review (FA-32).
import { describe, expect, it } from "vitest"

import {
  amenityState,
  buildAlbum,
  countCoverage,
  coverageByAlbumId,
  coverageSlotState,
  dishState,
  parseCoverage,
  type AlbumInput,
  type AmenityInput,
  type CoverageSlot,
  type DishInput,
} from "@/lib/album/model"
import {
  adminAmenityState,
  buildAdminAlbums,
} from "@/app/admin/albums/albums-model"

const BAR = "00000000-0000-4000-8000-00000000b001"
const DRINKS = "00000000-0000-4000-8000-00000000c001"
const ITEM = "00000000-0000-4000-8000-0000000d0001"
const CHECK = "00000000-0000-4000-8000-0000000a0001"

const dish = (over: Partial<DishInput> = {}): DishInput => ({
  itemId: ITEM,
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
  checkId: CHECK,
  question: "Can guests play darts?",
  category: "Games",
  progress: "needs_capture",
  answer: null,
  myLatestState: null,
  ...over,
})

const base = (over: Partial<AlbumInput> = {}): AlbumInput => ({
  places: [{ subjectId: BAR, label: "The bar" }],
  placements: [
    { source: "menu_section", key: "drinks", subjectId: BAR },
    { source: "amenity_category", key: "Games", subjectId: BAR },
  ],
  sections: [{ sectionId: DRINKS, slug: "drinks" }],
  dishes: [],
  amenities: [],
  areas: [],
  myRetakeItemIds: new Set(),
  ...over,
})

describe("coverageSlotState", () => {
  it("maps each requirement state to one slot state", () => {
    expect(coverageSlotState("covered")).toBe("accepted")
    expect(coverageSlotState("check_due")).toBe("check-due")
    expect(coverageSlotState("pending")).toBe("waiting")
    expect(coverageSlotState("missing")).toBe("needed")
    expect(coverageSlotState("replacement_needed")).toBe("needed")
    expect(coverageSlotState("replacement_needed", true)).toBe("retake")
    expect(coverageSlotState("not_here")).toBe("not-here")
    expect(coverageSlotState("inactive")).toBeNull()
  })
})

describe("dishState with the coverage rule", () => {
  it("follows the rule over the older per-item fields", () => {
    // Our menu would call it covered; the rule says a check is due.
    expect(
      dishState(dish({ covered: true, coverage: "check_due" }), false)
    ).toBe("check-due")
    // A reference photo leaves the item missing (AC16).
    expect(
      dishState(dish({ covered: false, coverage: "missing" }), false)
    ).toBe("needed")
    expect(dishState(dish({ coverage: "covered" }), false)).toBe("accepted")
  })
  it("lays the viewer's own photo and retake note over a gap", () => {
    expect(dishState(dish({ coverage: "missing", myWaiting: 1 }), false)).toBe(
      "waiting"
    )
    expect(dishState(dish({ coverage: "replacement_needed" }), true)).toBe(
      "retake"
    )
    expect(dishState(dish({ coverage: "covered", myWaiting: 1 }), false)).toBe(
      "accepted"
    )
  })
})

describe("amenityState with the coverage rule (FA-32)", () => {
  it("does not fill a confirmed Yes until its photo is accepted", () => {
    expect(
      amenityState(
        check({ progress: "complete", answer: "yes", coverage: "missing" })
      )
    ).toBe("needed")
    expect(
      amenityState(
        check({ progress: "complete", answer: "yes", coverage: "covered" })
      )
    ).toBe("accepted")
  })
  it("leaves a confirmed No as Not here and a fact-only question out", () => {
    expect(amenityState(check({ coverage: "not_here" }))).toBe("not-here")
    expect(amenityState(check({ coverage: "inactive" }))).toBeNull()
  })
  it("keeps the viewer's own finding over a gap", () => {
    expect(
      amenityState(check({ coverage: "missing", myLatestState: "submitted" }))
    ).toBe("waiting")
    expect(
      amenityState(
        check({ coverage: "missing", myLatestState: "needs_attention" })
      )
    ).toBe("retake")
  })
})

describe("buildAlbum with coverage", () => {
  it("counts Check due as waiting, never as filled, and drops inactive slots", () => {
    const view = buildAlbum(
      base({
        dishes: [
          dish({ coverage: "check_due" }),
          dish({
            itemId: "00000000-0000-4000-8000-0000000d0002",
            name: "Cider",
            coverage: "covered",
          }),
        ],
        amenities: [
          check({ coverage: "inactive" }),
          check({
            checkId: "00000000-0000-4000-8000-0000000a0002",
            question: "Is there a pool table?",
            coverage: "missing",
          }),
        ],
      })
    )
    expect(view.counts).toEqual({ filled: 1, waiting: 1, empty: 1, total: 3 })
    const states = view.places[0]!.groups.flatMap((g) =>
      g.slots.map((s) => s.state)
    )
    expect(states.sort()).toEqual(["accepted", "check-due", "needed"])
  })
})

const slot = (over: Partial<CoverageSlot> = {}): CoverageSlot => ({
  kind: "dish",
  slotId: ITEM,
  name: "Guinness, pint",
  groupKey: DRINKS,
  groupName: "Drinks",
  category: "drinks",
  counted: true,
  state: "covered",
  unavailable: false,
  primaryAssetId: null,
  pendingCount: 0,
  ...over,
})

describe("parseCoverage and countCoverage (AC39)", () => {
  const raw = {
    venueId: BAR,
    slots: [
      { ...slot(), counted: true },
      {
        ...slot({
          slotId: "00000000-0000-4000-8000-0000000d0002",
          state: "pending",
          pendingCount: 2,
          unavailable: true,
        }),
      },
      {
        ...slot({
          kind: "amenity",
          slotId: CHECK,
          category: "facilities",
          state: "not_here",
        }),
      },
      { kind: "dish", slotId: "not-a-uuid", state: "covered" },
      {
        ...slot({ slotId: "00000000-0000-4000-8000-0000000d0003" }),
        state: "bogus",
      },
    ],
    categories: [
      { category: "drinks", total: 2, covered: 1, pending: 1, unavailable: 1 },
    ],
    totals: { total: 2, covered: 1, pending: 1, notHere: 1, unavailable: 1 },
  }

  it("keeps only well-formed rows and every category in order", () => {
    const view = parseCoverage(raw)!
    expect(view.slots.map((s) => s.state)).toEqual([
      "covered",
      "pending",
      "not_here",
    ])
    expect(view.slots[2]!.counted).toBe(false)
    expect(view.categories.map((c) => c.category)).toEqual([
      "food",
      "drinks",
      "spaces",
      "facilities",
      "other",
    ])
    expect(view.categories[1]).toMatchObject({ total: 2, covered: 1 })
    expect(parseCoverage({})).toBeNull()
  })

  it("reproduces the database's totals from the rows", () => {
    const view = parseCoverage(raw)!
    expect(countCoverage(view.slots)).toEqual(view.totals)
  })

  it("keys states by album slot id", () => {
    const map = coverageByAlbumId(parseCoverage(raw))
    expect(map.get(`dish:${ITEM}`)).toBe("covered")
    expect(map.get(`amenity:${CHECK}`)).toBe("not_here")
    expect(coverageByAlbumId(null).size).toBe(0)
  })
})

describe("admin albums on the rule", () => {
  it("uses the amenity's coverage state when the read gives one", () => {
    expect(
      adminAmenityState({
        category: "Games",
        progress: "complete",
        answer: "yes",
        openState: null,
        state: "missing",
      })
    ).toBe("needed")
    expect(
      adminAmenityState({
        category: "Games",
        progress: "complete",
        answer: "yes",
        openState: null,
      })
    ).toBe("accepted")
  })

  it("counts a check-due place as waiting, not filled", () => {
    const albums = buildAdminAlbums([
      {
        venueId: BAR,
        venueName: "The Bell",
        counts: { menuState: "ready", sections: [], amenities: [] },
        areas: [{ state: "check-due" }, { state: "accepted" }],
      },
    ])
    expect(albums.rows[0]!.cells.areas).toEqual({
      kind: "counts",
      filled: 1,
      waiting: 1,
      total: 2,
    })
  })
})
