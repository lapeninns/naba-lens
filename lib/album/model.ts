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
 */

import { dayLabel } from "@/lib/server/coverage/time"

export type SlotState =
  "needed" | "sending" | "waiting" | "retake" | "accepted" | "not-here"

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
  /** One line on what the photo must show (DESIGN.md §5 Brief); filled by AL-4. */
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
  /** Waiting for review or sending. */
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
}

export type AmenityInput = {
  checkId: string
  question: string
  category: string
  progress: "needs_capture" | "complete" | "needs_recheck"
  /** The answer in use, when available: yes, no or not_applicable. */
  answer: "yes" | "no" | "not_applicable" | null
  /** My latest finding's state, if I sent one. */
  myLatestState: string | null
}

export type AreaInput = {
  subjectId: string
  label: string
  state: "needed" | "waiting" | "retake" | "accepted"
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
}

// ---- state rules -------------------------------------------------------------

/** A dish's slot state, as the viewer sees it. */
export function dishState(dish: DishInput, myRetake: boolean): SlotState {
  if (dish.covered && !dish.needsRecheck) return "accepted"
  if (dish.myWaiting > 0 || dish.reviewState !== null) return "waiting"
  if (myRetake) return "retake"
  return "needed"
}

const WAITING_FINDINGS = new Set(["submitted", "awaiting_confirmation"])

/** An amenity slot's state. No and Not applicable leave the album as Not here. */
export function amenityState(check: AmenityInput): SlotState {
  if (check.progress === "complete")
    return check.answer === "no" || check.answer === "not_applicable"
      ? "not-here"
      : "accepted"
  if (check.myLatestState === "needs_attention") return "retake"
  if (check.myLatestState && WAITING_FINDINGS.has(check.myLatestState))
    return "waiting"
  if (check.progress === "needs_recheck") return "retake"
  return "needed"
}

const isEmpty = (state: SlotState) => state === "needed" || state === "retake"
const isWaiting = (state: SlotState) =>
  state === "waiting" || state === "sending"

/** Needed slots first (with a needed-by date first of all), then retakes, waiting, accepted, not here. */
const ORDER: Record<SlotState, number> = {
  retake: 0,
  needed: 1,
  sending: 2,
  waiting: 3,
  accepted: 4,
  "not-here": 5,
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
        brief: null,
        target: { kind: "dish", itemId: dish.itemId, itemName: dish.name },
      },
    })
  }

  for (const check of input.amenities) {
    slots.push({
      place: placeOf.get(`amenity_category:${check.category}`) ?? null,
      slot: {
        id: `amenity:${check.checkId}`,
        name: check.question,
        group: check.category,
        state: amenityState(check),
        thumbnailUrl: null,
        neededBy: null,
        brief: null,
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
        thumbnailUrl: null,
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
