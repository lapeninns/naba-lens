/*
 * The album read model (docs/design-system/DESIGN.md §4, §5a, §6.2). Pure:
 * it takes what the existing loaders already return and groups every slot at
 * the venue by the place where it is photographed. lib/server/album.ts reads
 * the sources; tests/unit/album-model.test.ts covers the rules here.
 *
 * Three kinds of slot:
 *   dish     an eligible item on the active menu, placed by its section
 *   amenity  an amenity check from the venue's working list, placed by its
 *            catalogue category
 *   area     one of the venue's places itself (G-9 area photos)
 *
 * A slot whose group has no place yet goes in `unplaced`, which Album shows
 * as "Not placed yet" so nothing is hidden while a manager sets places up.
 *
 * Coverage (Full App v1, S1-COV; spec §10, FA-11, FA-30): the database
 * gives every slot one requirement state (public.coverage_slots, read by
 * lib/server/album.ts). When a slot carries it, its state follows that rule,
 * with the viewer's own sending and retake notes laid over it; without it
 * (the read failed) the older per-source rules below still apply.
 */

import { dayLabel } from "@/lib/server/coverage/time"
import type { FactVerificationState } from "@/lib/knowledge/facts"

export type SlotState =
  | "needed"
  | "sending"
  | "waiting"
  | "retake"
  | "accepted"
  | "check-due"
  | "not-here"

/**
 * A slot's requirement coverage state (spec §10), as
 * private.coverage_slot_rows gives it (20261118100200_coverage_slots.sql):
 *   covered             a current public-level photo
 *   check_due           covered, but a check is due; not counted as covered
 *   pending             a photo is waiting for review
 *   replacement_needed  a reviewer asked for another photo
 *   missing             none of the above
 *   not_here            confirmed No or Not applicable (leaves the total)
 *   inactive            no active photo requirement (leaves the total)
 */
export type CoverageState =
  | "covered"
  | "check_due"
  | "pending"
  | "replacement_needed"
  | "missing"
  | "not_here"
  | "inactive"

export const COVERAGE_STATES: ReadonlyArray<CoverageState> = [
  "covered",
  "check_due",
  "pending",
  "replacement_needed",
  "missing",
  "not_here",
  "inactive",
]

/** The spec's five staff-facing categories (§4.1, FA-6), in order. */
export type CoverageCategory =
  "food" | "drinks" | "spaces" | "facilities" | "other"

export const COVERAGE_CATEGORIES: ReadonlyArray<{
  key: CoverageCategory
  label: string
}> = [
  { key: "food", label: "Food" },
  { key: "drinks", label: "Drinks" },
  { key: "spaces", label: "Spaces" },
  { key: "facilities", label: "Facilities" },
  { key: "other", label: "Other" },
]

export type CoverageSlotKind = "dish" | "amenity" | "area"

/** One slot's row from public.coverage_slots. */
export type CoverageSlot = {
  kind: CoverageSlotKind
  slotId: string
  name: string
  /** Menu section id, amenity catalogue category, or the place's own id. */
  groupKey: string
  groupName: string
  category: CoverageCategory
  /** An active mandatory photo requirement (counted in the total). */
  counted: boolean
  state: CoverageState
  /** Temporarily unavailable (a dish sold out): still in the total. */
  unavailable: boolean
  /** The effective primary photo of a covered or check-due slot. */
  primaryAssetId: string | null
  /** Photos waiting for review. */
  pendingCount: number
}

/** n of N by category (§18.1): covered is the numerator, total the denominator. */
export type CoverageCounts = {
  total: number
  covered: number
  checkDue: number
  pending: number
  replacementNeeded: number
  missing: number
  notHere: number
  inactive: number
  unavailable: number
}

export type CoverageView = {
  venueId: string
  slots: CoverageSlot[]
  categories: Array<{ category: CoverageCategory } & CoverageCounts>
  totals: CoverageCounts
}

export type AlbumSlotTarget =
  | { kind: "dish"; itemId: string; itemName: string }
  | { kind: "amenity"; checkId: string }
  | { kind: "area"; subjectId: string }

export type AlbumSlot = {
  /** Unique across kinds: "dish:<id>", "amenity:<id>", "area:<id>". */
  id: string
  name: string
  /** The section heading it sits under in a place: "Desserts", "Games", "The space". */
  group: string
  state: SlotState
  thumbnailUrl: string | null
  /** A manager's "needed by" date on a dish, as written (DESIGN.md §7). */
  neededBy: string | null
  /**
   * One line on what the photo must show (DESIGN.md §5 Brief): a dish's own
   * brief, else its section's; an amenity's catalogue capture brief; null
   * for an area or when none is set (see slotBrief).
   */
  brief: string | null
  target: AlbumSlotTarget
}

export type AlbumGroup = {
  name: string
  slots: AlbumSlot[]
  filled: number
  total: number
}

export type AlbumPlace = {
  /** The knowledge_subjects id, or null for "Not placed yet". */
  subjectId: string | null
  label: string
  groups: AlbumGroup[]
  /** Needed and retake slots: what still has to be photographed. */
  empty: number
  total: number
}

export type AlbumCounts = {
  /** Accepted. */
  filled: number
  /** Waiting for review, sending, or Check due (FA-11). */
  waiting: number
  /** Needed or retake. */
  empty: number
  /** Every slot except Not here (DESIGN.md §4, "Counts"). */
  total: number
}

export type AlbumView = {
  counts: AlbumCounts
  /** Places with at least one slot, most empty first, then by name. */
  places: AlbumPlace[]
  unplaced: AlbumPlace | null
}

// ---- inputs, in the shapes the loaders give ---------------------------------

export type DishInput = {
  itemId: string
  name: string
  sectionId: string
  sectionName: string
  covered: boolean
  needsRecheck: boolean
  thumbnailUrl: string | null
  myWaiting: number
  reviewState: "waiting" | "being_checked" | null
  neededBy: { date: string; passed: boolean } | null
  /** The coverage rule's state, when the coverage read succeeded. */
  coverage?: CoverageState
}

export type AmenityInput = {
  checkId: string
  /** The catalogue question key, which finds its capture brief. */
  key?: string
  question: string
  category: string
  progress: "needs_capture" | "complete" | "needs_recheck"
  /** The answer in use, when available: yes, no or not_applicable. */
  answer: "yes" | "no" | "not_applicable" | null
  /** My latest finding's state, if I sent one. */
  myLatestState: string | null
  /** The accepted slot's current photo (AL-7), when it has one. */
  thumbnailUrl?: string | null
  /** The coverage rule's state, when the coverage read succeeded. */
  coverage?: CoverageState
  /**
   * The answer's fact verification (S1-FACTS, spec §10), when read. Used
   * only without the coverage rule: a complete Yes that is not currently
   * confirmed reads Check due (AC30).
   */
  verification?: FactVerificationState | null
}

export type AreaInput = {
  subjectId: string
  label: string
  state: "needed" | "waiting" | "retake" | "accepted" | "check-due"
  /** The accepted or waiting slot's current photo (AL-7), when it has one. */
  thumbnailUrl?: string | null
}

export type PlacementInput = {
  source: "menu_section" | "amenity_category"
  key: string
  subjectId: string
}

export type AlbumInput = {
  places: Array<{ subjectId: string; label: string }>
  placements: PlacementInput[]
  /** Active menu sections: id to slug, since placements are kept by slug. */
  sections: Array<{ sectionId: string; slug: string }>
  dishes: DishInput[]
  amenities: AmenityInput[]
  areas: AreaInput[]
  /** Dishes the viewer was asked to retake (their own open notes). */
  myRetakeItemIds: ReadonlySet<string>
  /** The venue's briefs (20261117130000_album_briefs.sql); none when absent. */
  briefs?: AlbumBriefs
}

/** Briefs as the loader reads them, keyed for lookup. */
export type AlbumBriefs = {
  /** Menu section slug to its brief. */
  sections: ReadonlyMap<string, string>
  /** Dish (menu item id) to its own brief. */
  items: ReadonlyMap<string, string>
  /** Amenity question key to the catalogue's capture brief. */
  amenities: ReadonlyMap<string, string>
}

export const NO_BRIEFS: AlbumBriefs = {
  sections: new Map(),
  items: new Map(),
  amenities: new Map(),
}

// ---- briefs ------------------------------------------------------------------

/** A brief is one line (DESIGN.md §5 Brief); the database holds the same limit. */
export const BRIEF_MAX = 140

// Control characters, line breaks and tabs included; Postgres [[:cntrl:]].
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/**
 * A trimmed brief the database accepts: 1 to BRIEF_MAX characters (code
 * points, as Postgres length() counts them) and no control characters.
 */
export function isBriefText(brief: string): boolean {
  const length = [...brief].length
  return length >= 1 && length <= BRIEF_MAX && !CONTROL.test(brief)
}

/**
 * A slot's brief (DESIGN.md §5 Brief): a dish's own brief, else its
 * section's, else none; an amenity's catalogue capture brief; an area none.
 */
export function slotBrief(
  target:
    | { kind: "dish"; itemId: string; sectionSlug: string | null }
    | { kind: "amenity"; key: string | null }
    | { kind: "area" },
  briefs: AlbumBriefs
): string | null {
  if (target.kind === "dish")
    return (
      briefs.items.get(target.itemId) ??
      (target.sectionSlug ? briefs.sections.get(target.sectionSlug) : null) ??
      null
    )
  if (target.kind === "amenity")
    return target.key ? (briefs.amenities.get(target.key) ?? null) : null
  return null
}

// ---- state rules -------------------------------------------------------------

/**
 * A slot state from the coverage rule. Missing and Replacement needed read
 * as Retake only for someone asked to retake it (their own note), else
 * Needed; Inactive has no slot (null).
 */
export function coverageSlotState(
  state: CoverageState,
  myRetake = false
): SlotState | null {
  switch (state) {
    case "covered":
      return "accepted"
    case "check_due":
      return "check-due"
    case "pending":
      return "waiting"
    case "not_here":
      return "not-here"
    case "inactive":
      return null
    default:
      return myRetake ? "retake" : "needed"
  }
}

/** A dish's slot state, as the viewer sees it. */
export function dishState(dish: DishInput, myRetake: boolean): SlotState {
  if (dish.coverage) {
    const state = coverageSlotState(dish.coverage, myRetake)
    // The viewer's own photo on its way, or waiting, shows as Waiting.
    if (
      (state === "needed" || state === "retake") &&
      (dish.myWaiting > 0 || dish.reviewState !== null)
    )
      return "waiting"
    return state ?? "needed"
  }
  if (dish.covered && !dish.needsRecheck) return "accepted"
  if (dish.myWaiting > 0 || dish.reviewState !== null) return "waiting"
  if (myRetake) return "retake"
  return "needed"
}

const WAITING_FINDINGS = new Set(["submitted", "awaiting_confirmation"])

/**
 * An amenity slot's state. No and Not applicable leave the album as Not
 * here. With the coverage rule, the photo has its own review (FA-32): a
 * confirmed Yes is not a filled slot until a photo is accepted; null for a
 * question that needs no photo (it has no slot).
 */
export function amenityState(check: AmenityInput): SlotState | null {
  if (check.coverage) {
    const state = coverageSlotState(check.coverage)
    if (state === "needed") {
      // The viewer's own finding, sent back or waiting.
      if (check.myLatestState === "needs_attention") return "retake"
      if (check.myLatestState && WAITING_FINDINGS.has(check.myLatestState))
        return "waiting"
    }
    return state
  }
  if (check.progress === "complete") {
    if (check.answer === "no" || check.answer === "not_applicable")
      return "not-here"
    // S2-INT (AC30): an answer that is not currently confirmed (Unconfirmed,
    // Check due, Withdrawn) asks for a check and is not counted as filled.
    if (check.verification && check.verification !== "confirmed")
      return "check-due"
    return "accepted"
  }
  if (check.myLatestState === "needs_attention") return "retake"
  if (check.myLatestState && WAITING_FINDINGS.has(check.myLatestState))
    return "waiting"
  if (check.progress === "needs_recheck") return "retake"
  return "needed"
}

const isEmpty = (state: SlotState) => state === "needed" || state === "retake"
/** Waiting on someone else: a review, a send, or a manager's check (FA-11). */
const isWaiting = (state: SlotState) =>
  state === "waiting" || state === "sending" || state === "check-due"

/** Needed slots first (with a needed-by date first of all), then retakes, waiting, accepted, not here. */
const ORDER: Record<SlotState, number> = {
  retake: 0,
  needed: 1,
  sending: 2,
  waiting: 3,
  "check-due": 4,
  accepted: 5,
  "not-here": 6,
}

function sortSlots(a: AlbumSlot, b: AlbumSlot) {
  const byState = ORDER[a.state] - ORDER[b.state]
  if (byState) return byState
  if (a.neededBy && !b.neededBy) return -1
  if (b.neededBy && !a.neededBy) return 1
  return a.name.localeCompare(b.name, "en-GB")
}

export const AREA_GROUP = "The space"

// ---- build --------------------------------------------------------------------

export function buildAlbum(input: AlbumInput): AlbumView {
  const placeLabel = new Map(input.places.map((p) => [p.subjectId, p.label]))
  const slugOf = new Map(input.sections.map((s) => [s.sectionId, s.slug]))
  const briefs = input.briefs ?? NO_BRIEFS
  const placeOf = new Map(
    input.placements
      .filter((p) => placeLabel.has(p.subjectId))
      .map((p) => [`${p.source}:${p.key}`, p.subjectId])
  )

  const slots: Array<{ place: string | null; slot: AlbumSlot }> = []

  for (const dish of input.dishes) {
    const slug = slugOf.get(dish.sectionId)
    const place = slug ? (placeOf.get(`menu_section:${slug}`) ?? null) : null
    slots.push({
      place,
      slot: {
        id: `dish:${dish.itemId}`,
        name: dish.name,
        group: dish.sectionName,
        state: dishState(dish, input.myRetakeItemIds.has(dish.itemId)),
        thumbnailUrl: dish.thumbnailUrl,
        neededBy: dish.neededBy
          ? dish.neededBy.passed
            ? "Needed"
            : `Needed by ${dayLabel(dish.neededBy.date)}`
          : null,
        brief: slotBrief(
          { kind: "dish", itemId: dish.itemId, sectionSlug: slug ?? null },
          briefs
        ),
        target: { kind: "dish", itemId: dish.itemId, itemName: dish.name },
      },
    })
  }

  for (const check of input.amenities) {
    const state = amenityState(check)
    if (!state) continue
    slots.push({
      place: placeOf.get(`amenity_category:${check.category}`) ?? null,
      slot: {
        id: `amenity:${check.checkId}`,
        name: check.question,
        group: check.category,
        state,
        // AL-7: an accepted (or check-due) slot shows its photo to everyone
        // at the venue.
        thumbnailUrl:
          state === "accepted" || state === "check-due"
            ? (check.thumbnailUrl ?? null)
            : null,
        neededBy: null,
        brief: slotBrief({ kind: "amenity", key: check.key ?? null }, briefs),
        target: { kind: "amenity", checkId: check.checkId },
      },
    })
  }

  for (const area of input.areas) {
    if (!placeLabel.has(area.subjectId)) continue
    slots.push({
      place: area.subjectId,
      slot: {
        id: `area:${area.subjectId}`,
        name: area.label,
        group: AREA_GROUP,
        state: area.state,
        // AL-7: review never gates visibility; a retake shows no photo.
        thumbnailUrl:
          area.state === "accepted" ||
          area.state === "waiting" ||
          area.state === "check-due"
            ? (area.thumbnailUrl ?? null)
            : null,
        neededBy: null,
        brief: null,
        target: { kind: "area", subjectId: area.subjectId },
      },
    })
  }

  const byPlace = new Map<string | null, AlbumSlot[]>()
  for (const { place, slot } of slots) {
    const list = byPlace.get(place) ?? []
    list.push(slot)
    byPlace.set(place, list)
  }

  const toPlace = (
    subjectId: string | null,
    label: string,
    list: AlbumSlot[]
  ): AlbumPlace => {
    const groups = new Map<string, AlbumSlot[]>()
    for (const slot of list) {
      const g = groups.get(slot.group) ?? []
      g.push(slot)
      groups.set(slot.group, g)
    }
    const counted = list.filter((s) => s.state !== "not-here")
    return {
      subjectId,
      label,
      groups: [...groups.entries()]
        .map(([name, g]) => {
          const real = g.filter((s) => s.state !== "not-here")
          return {
            name,
            slots: [...g].sort(sortSlots),
            filled: real.filter((s) => s.state === "accepted").length,
            total: real.length,
          }
        })
        // The place's own photo comes last; groups otherwise by name.
        .sort((a, b) =>
          a.name === AREA_GROUP
            ? 1
            : b.name === AREA_GROUP
              ? -1
              : a.name.localeCompare(b.name, "en-GB")
        ),
      empty: counted.filter((s) => isEmpty(s.state)).length,
      total: counted.length,
    }
  }

  const places = [...byPlace.entries()]
    .filter(([id]) => id !== null)
    .map(([id, list]) => toPlace(id, placeLabel.get(id as string) ?? "", list))
    .sort(
      (a, b) => b.empty - a.empty || a.label.localeCompare(b.label, "en-GB")
    )
  const unplacedList = byPlace.get(null)
  const unplaced = unplacedList?.length
    ? toPlace(null, "Not placed yet", unplacedList)
    : null

  const all = slots.map((s) => s.slot).filter((s) => s.state !== "not-here")
  return {
    counts: {
      filled: all.filter((s) => s.state === "accepted").length,
      waiting: all.filter((s) => isWaiting(s.state)).length,
      empty: all.filter((s) => isEmpty(s.state)).length,
      total: all.length,
    },
    places,
    unplaced,
  }
}

/**
 * The place Album opens on: the one asked for ("unplaced" for Not placed
 * yet), else the one with the most gaps, else the first.
 */
export function currentPlace(
  view: AlbumView,
  preferred: string | null
): AlbumPlace | null {
  const all = [...view.places, ...(view.unplaced ? [view.unplaced] : [])]
  const asked = preferred
    ? all.find((p) => (p.subjectId ?? "unplaced") === preferred)
    : undefined
  return asked ?? all.find((p) => p.empty > 0) ?? all[0] ?? null
}

// ---- coverage read ------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isCoverageState = (v: unknown): v is CoverageState =>
  COVERAGE_STATES.includes(v as CoverageState)
const isCategory = (v: unknown): v is CoverageCategory =>
  COVERAGE_CATEGORIES.some((c) => c.key === v)
const whole = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0

function parseCounts(raw: unknown): CoverageCounts {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    total: whole(r.total),
    covered: whole(r.covered),
    checkDue: whole(r.checkDue),
    pending: whole(r.pending),
    replacementNeeded: whole(r.replacementNeeded),
    missing: whole(r.missing),
    notHere: whole(r.notHere),
    inactive: whole(r.inactive),
    unavailable: whole(r.unavailable),
  }
}

/**
 * Parses public.coverage_slots (or album_admin_counts' slots, categories and
 * totals). Rows that are not well formed are left out; null when the shape
 * is not a coverage read at all.
 */
export function parseCoverage(data: unknown): CoverageView | null {
  const root = data as Record<string, unknown> | null
  if (!root || !Array.isArray(root.slots)) return null
  const slots = (root.slots as Array<Record<string, unknown>>).flatMap(
    (row): CoverageSlot[] => {
      const kind = row.kind
      if (kind !== "dish" && kind !== "amenity" && kind !== "area") return []
      if (typeof row.slotId !== "string" || !UUID.test(row.slotId)) return []
      if (!isCoverageState(row.state) || !isCategory(row.category)) return []
      const name = typeof row.name === "string" ? row.name : null
      if (!name) return []
      return [
        {
          kind,
          slotId: row.slotId,
          name,
          groupKey: typeof row.groupKey === "string" ? row.groupKey : "",
          groupName: typeof row.groupName === "string" ? row.groupName : "",
          category: row.category,
          counted: row.state !== "not_here" && row.state !== "inactive",
          state: row.state,
          unavailable: row.unavailable === true,
          primaryAssetId:
            typeof row.primaryAssetId === "string" &&
            UUID.test(row.primaryAssetId)
              ? row.primaryAssetId
              : null,
          pendingCount: whole(row.pendingCount),
        },
      ]
    }
  )
  const categories = COVERAGE_CATEGORIES.map(({ key }) => {
    const found = Array.isArray(root.categories)
      ? (root.categories as Array<Record<string, unknown>>).find(
          (c) => c.category === key
        )
      : undefined
    return { category: key, ...parseCounts(found) }
  })
  return {
    venueId: typeof root.venueId === "string" ? root.venueId : "",
    slots,
    categories,
    totals: parseCounts(root.totals),
  }
}

/**
 * Counts recomputed from slots (AC39): the same numbers the database gives,
 * so a displayed figure can be audited against its rows.
 */
export function countCoverage(
  slots: ReadonlyArray<CoverageSlot>
): CoverageCounts {
  const counted = slots.filter((s) => s.counted)
  const n = (state: CoverageState) =>
    slots.filter((s) => s.state === state).length
  return {
    total: counted.length,
    covered: n("covered"),
    checkDue: n("check_due"),
    pending: n("pending"),
    replacementNeeded: n("replacement_needed"),
    missing: n("missing"),
    notHere: n("not_here"),
    inactive: n("inactive"),
    unavailable: counted.filter((s) => s.unavailable).length,
  }
}

/** A slot's coverage state by its album id ("dish:<id>" and so on). */
export function coverageByAlbumId(
  view: CoverageView | null
): Map<string, CoverageState> {
  return new Map(
    (view?.slots ?? []).map((s) => [`${s.kind}:${s.slotId}`, s.state])
  )
}
