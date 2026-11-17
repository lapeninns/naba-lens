/*
 * Match on add (DESIGN.md §6.1, decision D9): which empty slots a photo can
 * fill, in the order Match offers them. Pure, so the browser and the server
 * share it; tests/unit/album-match-model.test.ts covers the rules.
 *
 * Only dish and area slots are matched. An amenity slot is filled by
 * answering its question first (§6.3), so Match never offers one; a search
 * that names one says so instead.
 */

import type { AlbumPlace, AlbumSlot, AlbumView } from "@/lib/album/model"
import type { ContentType } from "@/lib/menus/types"

/** What a matched photo fills. */
export type MatchTarget =
  | { kind: "dish"; itemId: string; name: string }
  | { kind: "area"; subjectId: string; name: string }

/** One empty slot Match can offer. */
export type MatchSlot = {
  /** The album slot id: "dish:<id>" or "area:<id>". */
  id: string
  name: string
  /** The section it sits under in its place ("Desserts", "The space"). */
  group: string
  /** The place's knowledge subject, or null for Not placed yet. */
  place: string | null
  placeLabel: string
  brief: string | null
  target: MatchTarget
}

/** Everything Match needs to offer slots, read once when it opens. */
export type MatchBoard = {
  slots: MatchSlot[]
  /** Empty amenity slots by name, so a search for one can say why it is missing. */
  amenities: string[]
}

/** A place key as Album writes it: the subject id, or "unplaced". */
export const placeKey = (place: string | null) => place ?? "unplaced"

const EMPTY = new Set(["needed", "retake"])

function toMatchSlot(place: AlbumPlace, slot: AlbumSlot): MatchSlot | null {
  if (!EMPTY.has(slot.state)) return null
  const base = {
    id: slot.id,
    name: slot.name,
    group: slot.group,
    place: place.subjectId,
    placeLabel: place.label,
    brief: slot.brief,
  }
  if (slot.target.kind === "dish")
    return {
      ...base,
      target: {
        kind: "dish",
        itemId: slot.target.itemId,
        name: slot.target.itemName,
      },
    }
  if (slot.target.kind === "area")
    return {
      ...base,
      target: {
        kind: "area",
        subjectId: slot.target.subjectId,
        name: slot.name,
      },
    }
  return null
}

/** The album's empty dish and area slots, place by place as Album orders them. */
export function matchBoardOf(album: AlbumView): MatchBoard {
  const places = [...album.places, ...(album.unplaced ? [album.unplaced] : [])]
  const slots: MatchSlot[] = []
  const amenities: string[] = []
  for (const place of places)
    for (const group of place.groups)
      for (const slot of group.slots) {
        if (slot.target.kind === "amenity") {
          if (EMPTY.has(slot.state)) amenities.push(slot.name)
          continue
        }
        const match = toMatchSlot(place, slot)
        if (match) slots.push(match)
      }
  return { slots, amenities }
}

/** How many suggestions Match shows before the search. */
export const SUGGESTION_LIMIT = 6

/**
 * The suggested slots for the next photo (§6.1 step 4): the empty slots of
 * the current place, then of the place the person last matched in, never
 * one already filled in this visit. Room left over goes to the other places,
 * the one with the most gaps first, as on Album.
 */
export function suggestSlots(
  board: MatchBoard,
  {
    current,
    last,
    taken,
    limit = SUGGESTION_LIMIT,
  }: {
    /** Place key ("unplaced" for Not placed yet), or null. */
    current: string | null
    last: string | null
    taken: ReadonlySet<string>
    limit?: number
  }
): MatchSlot[] {
  const open = board.slots.filter((slot) => !taken.has(slot.id))
  const counts = new Map<string, number>()
  for (const slot of open) {
    const key = placeKey(slot.place)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const rest = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)
  const order = [current, last, ...rest].filter(
    (key, i, all): key is string => !!key && all.indexOf(key) === i
  )
  const picked: MatchSlot[] = []
  for (const key of order)
    for (const slot of open)
      if (placeKey(slot.place) === key && picked.length < limit)
        picked.push(slot)
  return picked
}

const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-GB")
    .trim()

/**
 * Every empty slot whose name, section or place has every word of `query`,
 * names first. An empty query finds nothing.
 */
export function searchSlots(
  board: MatchBoard,
  query: string,
  taken: ReadonlySet<string>
): MatchSlot[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const hit = (slot: MatchSlot) => {
    const text = fold(`${slot.name} ${slot.group} ${slot.placeLabel}`)
    return words.every((word) => text.includes(word))
  }
  const byName = (slot: MatchSlot) =>
    words.every((word) => fold(slot.name).includes(word)) ? 0 : 1
  return board.slots
    .filter((slot) => !taken.has(slot.id) && hit(slot))
    .sort(
      (a, b) => byName(a) - byName(b) || a.name.localeCompare(b.name, "en-GB")
    )
}

/** True when `query` names an empty amenity slot (which Match never offers). */
export function searchNamesAmenity(board: MatchBoard, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return false
  return board.amenities.some((name) =>
    words.every((word) => fold(name).includes(word))
  )
}

/**
 * What a photo that is not for a slot shows (§6.1 step 5): one of the
 * existing content labels, so it is labelled and never waits under Match
 * later. Dishes and drinks are slots, so they are not offered here.
 */
export const SHARED_KINDS = [
  "team",
  "kitchen",
  "venue",
  "event",
  "preparation",
  "plating",
] as const satisfies readonly ContentType[]

export type SharedKind = (typeof SHARED_KINDS)[number]

/** Photos in the order they were taken (capture time; location is never read). */
export function byCaptureTime<T extends { file: File }>(photos: T[]): T[] {
  return [...photos].sort((a, b) => a.file.lastModified - b.file.lastModified)
}
