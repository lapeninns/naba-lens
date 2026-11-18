/*
 * Admin albums (docs/design-system/DESIGN.md §6.6): every venue's album as a
 * matrix, venues down and Food, Drinks, Amenities, Areas across, each cell
 * "filled of total", and the biggest gaps under it. Pure: lib/server/
 * album-admin.ts reads the sources; tests/unit/admin-albums-model.test.ts
 * covers the rules here.
 *
 * The slot rules are the album's own (lib/album/model.ts, DESIGN.md §4):
 * filled is Accepted, waiting is Waiting for review, empty is Needed or
 * Retake, and Not here leaves the total. Amenity states go through
 * amenityState, the rule staff Album uses.
 */

import {
  amenityState,
  coverageSlotState,
  type CoverageState,
  type SlotState,
} from "@/lib/album/model"

export type AlbumColumn = "food" | "drinks" | "amenities" | "areas"

export const ALBUM_COLUMNS: ReadonlyArray<{ key: AlbumColumn; label: string }> =
  [
    { key: "food", label: "Food" },
    { key: "drinks", label: "Drinks" },
    { key: "amenities", label: "Amenities" },
    { key: "areas", label: "Areas" },
  ]

export type SlotCounts = {
  /** Accepted. */
  filled: number
  /** Waiting for review. */
  waiting: number
  /** Every slot except Not here. */
  total: number
}

/**
 * One cell. `no-menu`: the venue has no active menu (Food and Drinks only).
 * `unavailable`: that read failed; the rest of the page still shows.
 */
export type AdminAlbumCell =
  | ({ kind: "counts" } & SlotCounts)
  | { kind: "no-menu" }
  | { kind: "unavailable" }

export type AdminAlbumRow = {
  venueId: string
  venueName: string
  cells: Record<AlbumColumn, AdminAlbumCell>
}

/** A section, amenity category or a venue's areas with slots still empty. */
export type AdminAlbumGap = {
  venueId: string
  venueName: string
  column: AlbumColumn
  /** "Desserts", "Games"; "Places" for a venue's areas. */
  group: string
  /** Needed or Retake. */
  empty: number
  total: number
}

export type AdminAlbums = {
  rows: AdminAlbumRow[]
  /** Every readable cell added up, per column. */
  totals: Record<AlbumColumn, SlotCounts>
  /** Needed or Retake across every venue. */
  empty: number
  gaps: AdminAlbumGap[]
}

// ---- inputs, in the shapes lib/server/album-admin.ts reads -------------------

export type AdminSectionInput = {
  name: string
  kind: "food" | "drinks"
  total: number
  accepted: number
  waiting: number
}

export type AdminAmenityInput = {
  category: string
  progress: "needs_capture" | "complete" | "needs_recheck"
  answer: string | null
  /**
   * The state of its latest open finding (sent, not yet finally decided);
   * null with none. `needs_attention`: a manager asked for more detail.
   */
  openState: "needs_attention" | "submitted" | "awaiting_confirmation" | null
  /**
   * The coverage rule's state (album_admin_counts since S1-COV,
   * 20261118100200). When present it decides the slot (FA-32: the photo has
   * its own review); the fields above are kept for older reads.
   */
  state?: CoverageState
}

export type AdminAreaInput = {
  state: "needed" | "waiting" | "retake" | "accepted" | "check-due"
}

export type AdminVenueInput = {
  venueId: string
  venueName: string
  /** Dishes and amenities from album_admin_counts; null when unreadable. */
  counts: {
    menuState: "ready" | "no_menu"
    sections: AdminSectionInput[]
    amenities: AdminAmenityInput[]
  } | null
  /** From album_area_states; null when unreadable. */
  areas: AdminAreaInput[] | null
}

export const AREAS_GROUP = "Places"

/** How many gaps are listed under the matrix. */
export const GAP_LIMIT = 8

// ---- rules ---------------------------------------------------------------------

/**
 * An amenity slot's state as an admin sees it: the latest open finding's state
 * stands in for the sender's own (staff Album), so a finding a manager sent
 * back for more detail is Retake, and one still to be decided is Waiting.
 */
export function adminAmenityState(input: AdminAmenityInput): SlotState {
  if (input.state) {
    const state = coverageSlotState(input.state)
    if (state === "needed" && input.openState === "needs_attention")
      return "retake"
    // Inactive amenities are not sent; treat a stray one as Not here.
    return state ?? "not-here"
  }
  return (
    amenityState({
      checkId: "",
      question: "",
      category: input.category,
      progress: input.progress,
      answer:
        input.answer === "yes" ||
        input.answer === "no" ||
        input.answer === "not_applicable"
          ? input.answer
          : null,
      myLatestState: input.openState,
    }) ?? "not-here"
  )
}

const ZERO: SlotCounts = { filled: 0, waiting: 0, total: 0 }

function add(a: SlotCounts, b: SlotCounts): SlotCounts {
  return {
    filled: a.filled + b.filled,
    waiting: a.waiting + b.waiting,
    total: a.total + b.total,
  }
}

function countStates(states: SlotState[]): SlotCounts {
  const counted = states.filter((s) => s !== "not-here")
  return {
    filled: counted.filter((s) => s === "accepted").length,
    // Check due waits on a manager's check (FA-11), as on staff Album.
    waiting: counted.filter(
      (s) => s === "waiting" || s === "sending" || s === "check-due"
    ).length,
    total: counted.length,
  }
}

/** Needed or Retake: the slots still to be photographed. */
export const emptyOf = (c: SlotCounts) =>
  Math.max(0, c.total - c.filled - c.waiting)

/**
 * How dark a cell's tint is (DESIGN.md §6.6): 0 none filled, 1 under half,
 * 2 half or more, 3 every slot filled. Null for a cell with no slots.
 */
export function tintLevel(c: SlotCounts): 0 | 1 | 2 | 3 | null {
  if (c.total === 0) return null
  if (c.filled >= c.total) return 3
  if (c.filled === 0) return 0
  return c.filled * 2 < c.total ? 1 : 2
}

// ---- build ---------------------------------------------------------------------

type Group = { column: AlbumColumn; name: string; counts: SlotCounts }

function groupsOf(input: AdminVenueInput): Group[] {
  const groups: Group[] = []
  if (input.counts) {
    for (const s of input.counts.sections)
      groups.push({
        column: s.kind,
        name: s.name,
        counts: { filled: s.accepted, waiting: s.waiting, total: s.total },
      })
    const byCategory = new Map<string, SlotState[]>()
    for (const a of input.counts.amenities) {
      const list = byCategory.get(a.category) ?? []
      list.push(adminAmenityState(a))
      byCategory.set(a.category, list)
    }
    for (const [name, states] of byCategory)
      groups.push({ column: "amenities", name, counts: countStates(states) })
  }
  if (input.areas)
    groups.push({
      column: "areas",
      name: AREAS_GROUP,
      counts: countStates(input.areas.map((a) => a.state)),
    })
  return groups
}

function cellsOf(
  input: AdminVenueInput,
  groups: Group[]
): Record<AlbumColumn, AdminAlbumCell> {
  const sum = (column: AlbumColumn): AdminAlbumCell => ({
    kind: "counts",
    ...groups
      .filter((g) => g.column === column)
      .reduce((n, g) => add(n, g.counts), ZERO),
  })
  const menu = (column: "food" | "drinks"): AdminAlbumCell =>
    !input.counts
      ? { kind: "unavailable" }
      : input.counts.menuState === "no_menu"
        ? { kind: "no-menu" }
        : sum(column)
  return {
    food: menu("food"),
    drinks: menu("drinks"),
    amenities: input.counts ? sum("amenities") : { kind: "unavailable" },
    areas: input.areas ? sum("areas") : { kind: "unavailable" },
  }
}

const byName = (a: string, b: string) => a.localeCompare(b, "en-GB")

export function buildAdminAlbums(venues: AdminVenueInput[]): AdminAlbums {
  const rows: AdminAlbumRow[] = []
  const gaps: AdminAlbumGap[] = []
  const totals = {
    food: ZERO,
    drinks: ZERO,
    amenities: ZERO,
    areas: ZERO,
  } as Record<AlbumColumn, SlotCounts>

  // Venues down in name order: the matrix lists venues, it does not rank them.
  for (const venue of [...venues].sort((a, b) =>
    byName(a.venueName, b.venueName)
  )) {
    const groups = groupsOf(venue)
    const cells = cellsOf(venue, groups)
    rows.push({ venueId: venue.venueId, venueName: venue.venueName, cells })
    for (const { key } of ALBUM_COLUMNS) {
      const cell = cells[key]
      if (cell.kind === "counts") totals[key] = add(totals[key], cell)
    }
    for (const g of groups) {
      const empty = emptyOf(g.counts)
      if (empty > 0)
        gaps.push({
          venueId: venue.venueId,
          venueName: venue.venueName,
          column: g.column,
          group: g.name,
          empty,
          total: g.counts.total,
        })
    }
  }

  const columnOrder = new Map(ALBUM_COLUMNS.map((c, i) => [c.key, i]))
  gaps.sort(
    (a, b) =>
      b.empty - a.empty ||
      byName(a.venueName, b.venueName) ||
      (columnOrder.get(a.column) ?? 0) - (columnOrder.get(b.column) ?? 0) ||
      byName(a.group, b.group)
  )

  return {
    rows,
    totals,
    empty: ALBUM_COLUMNS.reduce((n, { key }) => n + emptyOf(totals[key]), 0),
    gaps: gaps.slice(0, GAP_LIMIT),
  }
}
