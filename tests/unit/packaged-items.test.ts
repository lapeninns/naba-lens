// FA-51 packaged drinks in Album (lib/album/model.ts) and Match
// (components/nabalens/album/match/model.ts): an optional slot (the coverage
// rule's "inactive" dish) is listed and shows its photos, but leaves every
// Album count, is never empty and is never suggested as an empty slot.
import { describe, expect, it } from "vitest"

import {
  matchBoardOf,
  searchSlots,
  suggestSlots,
} from "@/components/nabalens/album/match/model"
import {
  allSlots,
  buildAlbum,
  countCoverage,
  filterPlace,
  parseCoverage,
  type AlbumInput,
  type DishInput,
} from "@/lib/album/model"

const BAR = "00000000-0000-4000-8000-00000000b001"
const DRINKS = "00000000-0000-4000-8000-00000000c001"
const LAGER = "00000000-0000-4000-8000-0000000d0001"
const COLA = "00000000-0000-4000-8000-0000000d0002"
const ALE = "00000000-0000-4000-8000-0000000d0003"

const dish = (
  itemId: string,
  name: string,
  over: Partial<DishInput> = {}
): DishInput => ({
  itemId,
  name,
  sectionId: DRINKS,
  sectionName: "Drinks",
  covered: false,
  needsRecheck: false,
  thumbnailUrl: null,
  myWaiting: 0,
  reviewState: null,
  neededBy: null,
  coverage: "missing",
  coverageCategory: "drinks",
  ...over,
})

const input = (dishes: DishInput[]): AlbumInput => ({
  places: [{ subjectId: BAR, label: "The bar" }],
  placements: [{ source: "menu_section", key: "drinks", subjectId: BAR }],
  sections: [{ sectionId: DRINKS, slug: "drinks" }],
  dishes,
  amenities: [],
  areas: [],
  myRetakeItemIds: new Set(),
})

describe("an optional packaged slot in Album (FA-51)", () => {
  const album = buildAlbum(
    input([
      // Packaged, no photo yet.
      dish(LAGER, "Bottled lager", { coverage: "inactive" }),
      // Packaged, its photo accepted.
      dish(COLA, "Canned cola", {
        coverage: "inactive",
        covered: true,
        thumbnailUrl: "/thumb/cola",
      }),
      // An ordinary drink.
      dish(ALE, "Ale"),
    ])
  )
  const byId = new Map(allSlots(album).map(({ slot }) => [slot.id, slot]))

  it("is listed, optional, and draws its photo state from the dish", () => {
    expect(byId.get(`dish:${LAGER}`)).toMatchObject({
      state: "needed",
      optional: true,
      needsUpdate: false,
    })
    expect(byId.get(`dish:${COLA}`)).toMatchObject({
      state: "accepted",
      optional: true,
      thumbnailUrl: "/thumb/cola",
    })
    expect(byId.get(`dish:${ALE}`)?.optional).toBeUndefined()
  })

  it("leaves every count and is never empty", () => {
    expect(album.counts).toEqual({ filled: 0, waiting: 0, empty: 1, total: 1 })
    const bar = album.places[0]!
    expect(bar).toMatchObject({ empty: 1, total: 1 })
    expect(bar.groups[0]).toMatchObject({ filled: 0, total: 1 })
  })

  it("is not under Needed, but is under All", () => {
    const bar = album.places[0]!
    const needed = filterPlace(bar, { show: "needed", category: null })
    expect(needed.groups.flatMap((g) => g.slots.map((s) => s.id))).toEqual([
      `dish:${ALE}`,
    ])
    const all = filterPlace(bar, { show: "all", category: null })
    expect(all.groups.flatMap((g) => g.slots)).toHaveLength(3)
  })

  it("is found by Match's search but never suggested as empty", () => {
    const board = matchBoardOf(album)
    const none = new Set<string>()
    expect(
      suggestSlots(board, { current: BAR, last: null, taken: none }).map(
        (s) => s.id
      )
    ).toEqual([`dish:${ALE}`])
    expect(board.optional?.map((s) => s.id)).toEqual([`dish:${LAGER}`])
    const found = searchSlots(board, "lager", none)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ id: `dish:${LAGER}`, optional: true })
  })
})

describe("coverage counts with an optional slot (AC39)", () => {
  it("count the same from the rows as the database's totals", () => {
    const view = parseCoverage({
      venueId: BAR,
      slots: [
        {
          kind: "dish",
          slotId: LAGER,
          name: "Bottled lager",
          category: "drinks",
          state: "inactive",
        },
        {
          kind: "dish",
          slotId: COLA,
          name: "Canned cola",
          category: "drinks",
          state: "covered",
        },
        {
          kind: "dish",
          slotId: ALE,
          name: "Ale",
          category: "drinks",
          state: "missing",
        },
      ],
      categories: [],
      totals: { total: 2, covered: 1, missing: 1, inactive: 1 },
    })!
    const counts = countCoverage(view.slots)
    expect(counts).toMatchObject({
      total: 2,
      covered: 1,
      missing: 1,
      inactive: 1,
    })
    expect(counts.total).toBe(view.totals.total)
    expect(view.slots.find((s) => s.slotId === LAGER)?.counted).toBe(false)
  })
})
