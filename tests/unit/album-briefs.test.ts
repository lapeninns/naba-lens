// Album AL-4 (DESIGN.md §5 Brief): the order a slot's brief comes from.
import { describe, expect, it } from "vitest"

import {
  buildAlbum,
  NO_BRIEFS,
  slotBrief,
  type AlbumBriefs,
  type AlbumInput,
  type AlbumSlot,
} from "@/lib/album/model"

const BAR = "00000000-0000-4000-8000-00000000b001"
const DRINKS = "00000000-0000-4000-8000-00000000c001"
const DESSERTS = "00000000-0000-4000-8000-00000000c002"
const PINT = "00000000-0000-4000-8000-0000000d0001"
const SPRITZ = "00000000-0000-4000-8000-0000000d0002"
const CRUMBLE = "00000000-0000-4000-8000-0000000d0003"
const DARTS = "00000000-0000-4000-8000-0000000a0001"
const POOL = "00000000-0000-4000-8000-0000000a0002"

const briefs: AlbumBriefs = {
  sections: new Map([["drinks", "The glass on the bar, label to camera"]]),
  items: new Map([[SPRITZ, "Spritz with its orange slice, in the wine glass"]]),
  amenities: new Map([["darts", "The dartboard and the oche, lights on"]]),
}

const dish = (itemId: string, name: string, sectionId: string) => ({
  itemId,
  name,
  sectionId,
  sectionName: sectionId === DRINKS ? "Drinks" : "Desserts",
  covered: false,
  needsRecheck: false,
  thumbnailUrl: null,
  myWaiting: 0,
  reviewState: null,
  neededBy: null,
})

const input = (over: Partial<AlbumInput> = {}): AlbumInput => ({
  places: [{ subjectId: BAR, label: "The bar" }],
  placements: [
    { source: "menu_section", key: "drinks", subjectId: BAR },
    { source: "amenity_category", key: "Games", subjectId: BAR },
  ],
  sections: [
    { sectionId: DRINKS, slug: "drinks" },
    { sectionId: DESSERTS, slug: "desserts" },
  ],
  dishes: [
    dish(PINT, "Guinness, pint", DRINKS),
    dish(SPRITZ, "Aperol spritz", DRINKS),
    dish(CRUMBLE, "Apple crumble", DESSERTS),
  ],
  amenities: [
    {
      checkId: DARTS,
      key: "darts",
      question: "Can guests play darts?",
      category: "Games",
      progress: "needs_capture",
      answer: null,
      myLatestState: null,
    },
    {
      checkId: POOL,
      key: "pool_table",
      question: "Is there a pool table?",
      category: "Games",
      progress: "needs_capture",
      answer: null,
      myLatestState: null,
    },
  ],
  areas: [{ subjectId: BAR, label: "The bar", state: "needed" }],
  myRetakeItemIds: new Set(),
  briefs,
  ...over,
})

function slots(view: ReturnType<typeof buildAlbum>): Map<string, AlbumSlot> {
  const all = [...view.places, ...(view.unplaced ? [view.unplaced] : [])]
  return new Map(
    all.flatMap((p) => p.groups.flatMap((g) => g.slots)).map((s) => [s.id, s])
  )
}

describe("slotBrief", () => {
  it("uses a dish's own brief first", () => {
    expect(
      slotBrief({ kind: "dish", itemId: SPRITZ, sectionSlug: "drinks" }, briefs)
    ).toBe("Spritz with its orange slice, in the wine glass")
  })
  it("falls back to the dish's section brief", () => {
    expect(
      slotBrief({ kind: "dish", itemId: PINT, sectionSlug: "drinks" }, briefs)
    ).toBe("The glass on the bar, label to camera")
  })
  it("is null when neither the dish nor its section has one", () => {
    expect(
      slotBrief(
        { kind: "dish", itemId: CRUMBLE, sectionSlug: "desserts" },
        briefs
      )
    ).toBeNull()
    expect(
      slotBrief({ kind: "dish", itemId: PINT, sectionSlug: null }, briefs)
    ).toBeNull()
  })
  it("uses the catalogue capture brief for an amenity, and none for an area", () => {
    expect(slotBrief({ kind: "amenity", key: "darts" }, briefs)).toBe(
      "The dartboard and the oche, lights on"
    )
    expect(slotBrief({ kind: "amenity", key: "pool_table" }, briefs)).toBeNull()
    expect(slotBrief({ kind: "amenity", key: null }, briefs)).toBeNull()
    expect(slotBrief({ kind: "area" }, briefs)).toBeNull()
  })
})

describe("buildAlbum briefs", () => {
  it("fills AlbumSlot.brief in that order", () => {
    const view = slots(buildAlbum(input()))
    expect(view.get(`dish:${SPRITZ}`)?.brief).toBe(
      "Spritz with its orange slice, in the wine glass"
    )
    expect(view.get(`dish:${PINT}`)?.brief).toBe(
      "The glass on the bar, label to camera"
    )
    // Desserts is not placed and has no brief: still listed, with none.
    expect(view.get(`dish:${CRUMBLE}`)?.brief).toBeNull()
    expect(view.get(`amenity:${DARTS}`)?.brief).toBe(
      "The dartboard and the oche, lights on"
    )
    expect(view.get(`amenity:${POOL}`)?.brief).toBeNull()
    expect(view.get(`area:${BAR}`)?.brief).toBeNull()
  })

  it("leaves every brief null when the briefs could not be read", () => {
    for (const over of [{ briefs: undefined }, { briefs: NO_BRIEFS }]) {
      const view = slots(buildAlbum(input(over)))
      expect([...view.values()].every((s) => s.brief === null)).toBe(true)
    }
  })

  it("does not change counts or order", () => {
    const withBriefs = buildAlbum(input())
    const without = buildAlbum(input({ briefs: undefined }))
    expect(withBriefs.counts).toEqual(without.counts)
    expect(withBriefs.places.map((p) => p.label)).toEqual(
      without.places.map((p) => p.label)
    )
  })
})
