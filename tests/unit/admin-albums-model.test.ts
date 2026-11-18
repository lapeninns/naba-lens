import { describe, expect, it } from "vitest"

import {
  adminAmenityState,
  buildAdminAlbums,
  GAP_LIMIT,
  tintLevel,
  type AdminVenueInput,
} from "@/app/admin/albums/albums-model"
import { parseAdminCounts } from "@/lib/server/album-admin"

// Admin albums (DESIGN.md §6.6): the matrix, its tints and the gaps.

const venue = (
  id: string,
  name: string,
  over: Partial<AdminVenueInput> = {}
): AdminVenueInput => ({
  venueId: `00000000-0000-4000-8000-0000000000${id}`,
  venueName: name,
  counts: { menuState: "ready", sections: [], amenities: [] },
  areas: [],
  ...over,
})

const bell = venue("01", "The Bell", {
  counts: {
    menuState: "ready",
    sections: [
      { name: "Desserts", kind: "food", total: 6, accepted: 2, waiting: 1 },
      { name: "Mains", kind: "food", total: 10, accepted: 10, waiting: 0 },
      { name: "Spirits", kind: "drinks", total: 8, accepted: 0, waiting: 0 },
    ],
    amenities: [
      {
        category: "Games",
        progress: "complete",
        answer: "yes",
        openState: null,
      },
      {
        category: "Games",
        progress: "complete",
        answer: "no",
        openState: null,
      },
      {
        category: "Games",
        progress: "needs_capture",
        answer: null,
        openState: "submitted",
      },
      {
        category: "Games",
        progress: "needs_capture",
        answer: null,
        openState: null,
      },
      {
        category: "Outside",
        progress: "needs_recheck",
        answer: null,
        openState: null,
      },
    ],
  },
  areas: [{ state: "accepted" }, { state: "retake" }, { state: "waiting" }],
})

const crown = venue("02", "Old Crown", {
  counts: { menuState: "no_menu", sections: [], amenities: [] },
  areas: [{ state: "needed" }, { state: "needed" }],
})

describe("buildAdminAlbums", () => {
  it("lists venues down by name with Food, Drinks, Amenities and Areas across", () => {
    const albums = buildAdminAlbums([bell, crown])
    expect(albums.rows.map((r) => r.venueName)).toEqual([
      "Old Crown",
      "The Bell",
    ])
    const bellRow = albums.rows[1]!
    expect(bellRow.cells).toEqual({
      food: { kind: "counts", filled: 12, waiting: 1, total: 16 },
      drinks: { kind: "counts", filled: 0, waiting: 0, total: 8 },
      // The No answer leaves the total (Not here); the open finding waits.
      amenities: { kind: "counts", filled: 1, waiting: 1, total: 4 },
      areas: { kind: "counts", filled: 1, waiting: 1, total: 3 },
    })
  })

  it("shows a venue with no menu as No menu, not as zero", () => {
    const albums = buildAdminAlbums([crown])
    const row = albums.rows[0]!
    expect(row.cells.food).toEqual({ kind: "no-menu" })
    expect(row.cells.drinks).toEqual({ kind: "no-menu" })
    expect(row.cells.amenities).toEqual({
      kind: "counts",
      filled: 0,
      waiting: 0,
      total: 0,
    })
    expect(row.cells.areas).toEqual({
      kind: "counts",
      filled: 0,
      waiting: 0,
      total: 2,
    })
    // No menu adds nothing to the Food and Drinks totals.
    expect(albums.totals.food).toEqual({ filled: 0, waiting: 0, total: 0 })
  })

  it("marks a read that failed as unavailable and keeps the rest", () => {
    const albums = buildAdminAlbums([
      venue("03", "The Railway", {
        counts: null,
        areas: [{ state: "accepted" }],
      }),
    ])
    const row = albums.rows[0]!
    expect(row.cells.food).toEqual({ kind: "unavailable" })
    expect(row.cells.amenities).toEqual({ kind: "unavailable" })
    expect(row.cells.areas).toEqual({
      kind: "counts",
      filled: 1,
      waiting: 0,
      total: 1,
    })
    const noAreas = buildAdminAlbums([
      venue("04", "The White Horse", { areas: null }),
    ])
    expect(noAreas.rows[0]!.cells.areas).toEqual({ kind: "unavailable" })
  })

  it("adds every readable cell into the totals and counts what is still empty", () => {
    const albums = buildAdminAlbums([bell, crown])
    expect(albums.totals).toEqual({
      food: { filled: 12, waiting: 1, total: 16 },
      drinks: { filled: 0, waiting: 0, total: 8 },
      amenities: { filled: 1, waiting: 1, total: 4 },
      areas: { filled: 1, waiting: 1, total: 5 },
    })
    // Needed or Retake: food 3, drinks 8, amenities 2, areas 3.
    expect(albums.empty).toBe(16)
  })

  it("orders the gaps by how many slots are still empty, waiting photos not counted", () => {
    const albums = buildAdminAlbums([bell, crown])
    expect(
      albums.gaps.map((g) => [g.venueName, g.column, g.group, g.empty, g.total])
    ).toEqual([
      ["The Bell", "drinks", "Spirits", 8, 8],
      // 6 dishes, 2 accepted, 1 waiting: 3 still empty.
      ["The Bell", "food", "Desserts", 3, 6],
      ["Old Crown", "areas", "Places", 2, 2],
      // Ties: by venue name, then column (Food, Drinks, Amenities, Areas),
      // then group name.
      ["The Bell", "amenities", "Games", 1, 3],
      ["The Bell", "amenities", "Outside", 1, 1],
      ["The Bell", "areas", "Places", 1, 3],
    ])
    // A full section is no gap.
    expect(albums.gaps.some((g) => g.group === "Mains")).toBe(false)
  })

  it("lists at most GAP_LIMIT gaps", () => {
    const many = Array.from({ length: GAP_LIMIT + 3 }, (_, i) =>
      venue(String(10 + i), `Venue ${String(10 + i)}`, {
        areas: [{ state: "needed" }],
      })
    )
    expect(buildAdminAlbums(many).gaps).toHaveLength(GAP_LIMIT)
  })

  it("has no rows and no gaps without venues", () => {
    const albums = buildAdminAlbums([])
    expect(albums).toMatchObject({ rows: [], gaps: [], empty: 0 })
  })
})

describe("tintLevel", () => {
  it("darkens as the cell fills", () => {
    expect(tintLevel({ filled: 0, waiting: 0, total: 0 })).toBeNull()
    expect(tintLevel({ filled: 0, waiting: 3, total: 10 })).toBe(0)
    expect(tintLevel({ filled: 1, waiting: 0, total: 10 })).toBe(1)
    expect(tintLevel({ filled: 4, waiting: 0, total: 9 })).toBe(1)
    expect(tintLevel({ filled: 5, waiting: 0, total: 10 })).toBe(2)
    expect(tintLevel({ filled: 9, waiting: 1, total: 10 })).toBe(2)
    expect(tintLevel({ filled: 10, waiting: 0, total: 10 })).toBe(3)
  })
})

describe("adminAmenityState", () => {
  it("uses the album's amenity rule, with the latest open finding's state", () => {
    const base = { category: "Games", answer: null, openState: null } as const
    expect(adminAmenityState({ ...base, progress: "needs_capture" })).toBe(
      "needed"
    )
    expect(
      adminAmenityState({
        ...base,
        progress: "needs_capture",
        openState: "submitted",
      })
    ).toBe("waiting")
    expect(
      adminAmenityState({
        ...base,
        progress: "needs_capture",
        openState: "awaiting_confirmation",
      })
    ).toBe("waiting")
    // A finding a manager sent back for more detail is Retake, as the sender
    // sees it on staff Album: an empty slot, not Waiting (revc should-fix 3).
    expect(
      adminAmenityState({
        ...base,
        progress: "needs_capture",
        openState: "needs_attention",
      })
    ).toBe("retake")
    expect(adminAmenityState({ ...base, progress: "needs_recheck" })).toBe(
      "retake"
    )
    expect(
      adminAmenityState({ ...base, progress: "complete", answer: "yes" })
    ).toBe("accepted")
    expect(
      adminAmenityState({
        ...base,
        progress: "complete",
        answer: "not_applicable",
      })
    ).toBe("not-here")
    // An answer value the album does not know counts as answered.
    expect(
      adminAmenityState({ ...base, progress: "complete", answer: "seasonal" })
    ).toBe("accepted")
  })
})

describe("parseAdminCounts (album_admin_counts)", () => {
  it("passes the latest open finding's state through; anything else is none", () => {
    const parsed = parseAdminCounts({
      menuState: "ready",
      sections: [],
      amenities: [
        {
          category: "Games",
          progress: "needs_capture",
          openState: "needs_attention",
        },
        {
          category: "Games",
          progress: "needs_capture",
          openState: "submitted",
        },
        { category: "Games", progress: "needs_capture", openState: null },
        { category: "Games", progress: "needs_capture", openState: "current" },
      ],
    })
    expect(parsed?.amenities.map((a) => a.openState)).toEqual([
      "needs_attention",
      "submitted",
      null,
      null,
    ])
    expect(parsed?.amenities.map(adminAmenityState)).toEqual([
      "retake",
      "waiting",
      "needed",
      "needed",
    ])
  })
})
