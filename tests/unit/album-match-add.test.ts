// Full App v1 S2-ADD: Match's search by other names and spelling slips
// (spec §5.3, AC02), slots with a photo already waiting (§6 S1), recent
// slots (§5.3) and "Use for the next N photos" (§5.4, AC05).
import { describe, expect, it } from "vitest"

import {
  allSlots,
  groupKeys,
  matchBoardOf,
  openAfter,
  recentSlots,
  searchSlots,
  suggestSlots,
  type MatchBoard,
  type MatchSlot,
} from "@/components/nabalens/album/match/model"
import { buildAlbum, type AlbumInput } from "@/lib/album/model"

const PASS = "00000000-0000-4000-8000-00000000b002"
const MAINS = "00000000-0000-4000-8000-00000000c003"

const slot = (
  id: string,
  name: string,
  extra: Partial<MatchSlot> = {}
): MatchSlot => ({
  id: `dish:${id}`,
  name,
  group: "Mains",
  place: PASS,
  placeLabel: "Kitchen pass",
  brief: null,
  target: { kind: "dish", itemId: id, name },
  ...extra,
})

const BOARD: MatchBoard = {
  slots: [
    slot("momo", "Chicken momo", { aliases: ["momos", "dumplings"] }),
    slot("veg-momo", "Vegetable momo"),
    slot("bhaji", "Onion bhaji"),
    slot("guinness", "Guinness, pint"),
    slot("chips", "Chips"),
  ],
  amenities: [],
  waiting: [slot("tikka", "Chicken tikka", { waiting: true })],
}

const none = new Set<string>()
const names = (slots: MatchSlot[]) => slots.map((s) => s.name)

describe("search (spec §5.3)", () => {
  it("finds a dish by its approved other name and shows its own name", () => {
    expect(names(searchSlots(BOARD, "dumplings", none))).toEqual([
      "Chicken momo",
    ])
  })

  it("forgives plurals and one-letter slips, and tells similar dishes apart", () => {
    expect(names(searchSlots(BOARD, "bhajis", none))).toEqual(["Onion bhaji"])
    expect(names(searchSlots(BOARD, "guiness", none))).toEqual([
      "Guinness, pint",
    ])
    // Both momos match "momo"; "chicken momo" names one of them only.
    expect(names(searchSlots(BOARD, "momo", none))).toEqual([
      "Chicken momo",
      "Vegetable momo",
    ])
    expect(names(searchSlots(BOARD, "chicken momo", none))).toEqual([
      "Chicken momo",
    ])
  })

  it("puts exact matches before forgiven ones, and empty slots before waiting ones", () => {
    expect(names(searchSlots(BOARD, "chicken", none))).toEqual([
      "Chicken momo",
      "Chicken tikka",
    ])
  })

  it("never offers a slot taken in this visit, and finds nothing for nothing", () => {
    expect(names(searchSlots(BOARD, "momo", new Set(["dish:momo"])))).toEqual([
      "Vegetable momo",
    ])
    expect(searchSlots(BOARD, "  ", none)).toEqual([])
    expect(searchSlots(BOARD, "pizza", none)).toEqual([])
  })
})

describe("waiting slots (spec §6 S1)", () => {
  const input: AlbumInput = {
    places: [{ subjectId: PASS, label: "Kitchen pass" }],
    placements: [{ source: "menu_section", key: "mains", subjectId: PASS }],
    sections: [{ sectionId: MAINS, slug: "mains" }],
    dishes: [
      {
        itemId: "00000000-0000-4000-8000-0000000d0001",
        name: "Chicken momo",
        sectionId: MAINS,
        sectionName: "Mains",
        covered: false,
        needsRecheck: false,
        thumbnailUrl: null,
        myWaiting: 0,
        reviewState: null,
        neededBy: null,
      },
      {
        itemId: "00000000-0000-4000-8000-0000000d0002",
        name: "Chicken tikka",
        sectionId: MAINS,
        sectionName: "Mains",
        covered: false,
        needsRecheck: false,
        thumbnailUrl: null,
        myWaiting: 1,
        reviewState: null,
        neededBy: null,
      },
    ],
    amenities: [],
    areas: [],
    myRetakeItemIds: new Set(),
  }

  it("keeps them apart from the empty ones, with the menu's other names", () => {
    const board = matchBoardOf(buildAlbum(input), {
      aliases: new Map([["00000000-0000-4000-8000-0000000d0001", ["momos"]]]),
      venue: { id: "v1", name: "The Bell" },
    })
    expect(names(board.slots)).toEqual(["Chicken momo"])
    expect(board.slots[0].aliases).toEqual(["momos"])
    expect(names(board.waiting ?? [])).toEqual(["Chicken tikka"])
    expect(board.waiting?.[0].waiting).toBe(true)
    expect(board.venue).toEqual({ id: "v1", name: "The Bell" })
    // Never suggested as an empty slot.
    expect(
      names(suggestSlots(board, { current: PASS, last: null, taken: none }))
    ).toEqual(["Chicken momo"])
    expect(names(allSlots(board))).toEqual(["Chicken momo", "Chicken tikka"])
  })
})

describe("recent slots (spec §5.3)", () => {
  it("offers the latest ones still on the board, newest first, never taken ones", () => {
    const recent = ["dish:tikka", "dish:gone", "dish:bhaji", "dish:momo"]
    expect(names(recentSlots(BOARD, recent, none))).toEqual([
      "Chicken tikka",
      "Onion bhaji",
      "Chicken momo",
    ])
    expect(
      names(recentSlots(BOARD, recent, new Set(["dish:bhaji"]), 2))
    ).toEqual(["Chicken tikka", "Chicken momo"])
    expect(recentSlots(BOARD, [], none)).toEqual([])
  })
})

describe("use for the next N photos (spec §5.4)", () => {
  const photos = ["a", "b", "c", "d", "e"].map((key) => ({ key }))

  it("takes the shown photo and the next ones without an answer, never more", () => {
    expect(groupKeys(photos, new Set(), "a", 3)).toEqual(["a", "b", "c"])
    // A decided photo is skipped, not answered twice.
    expect(groupKeys(photos, new Set(["b"]), "a", 3)).toEqual(["a", "c", "d"])
    expect(groupKeys(photos, new Set(), "d", 9)).toEqual(["d", "e"])
    expect(groupKeys(photos, new Set(), "c", 1)).toEqual(["c"])
    // Never a photo before the shown one, never an answered shown photo.
    expect(groupKeys(photos, new Set(["c"]), "c", 2)).toEqual([])
    expect(groupKeys(photos, new Set(), "zz", 2)).toEqual([])
  })

  it("counts the photos left after the shown one", () => {
    expect(openAfter(photos, new Set(), "a")).toBe(4)
    expect(openAfter(photos, new Map([["e", 1]]), "b")).toBe(2)
    expect(openAfter(photos, new Set(), "e")).toBe(0)
  })
})
