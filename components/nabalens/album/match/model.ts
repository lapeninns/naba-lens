/*
 * Match on add (DESIGN.md §6.1, decision D9): which empty slots a photo can
 * fill, in the order Match offers them. Pure, so the browser and the server
 * share it; tests/unit/album-match-model.test.ts covers the rules.
 *
 * Only dish and area slots are matched. An amenity slot is filled by
 * answering its question first (§6.3), so Match never offers one; a search
 * that names one says so instead.
 *
 * S3-R12 (X4, X5): a slot is never hidden because it already has a photo.
 * Suggestions are empty slots only, but a slot matched earlier in this visit,
 * one still sending, one waiting for review and one already in the album
 * (or needing its check) are all found by search and offered under Recent,
 * marked so: another photo of the same dish is welcome (spec §5.4, §6 S1).
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
  /**
   * The menu's approved other names for a dish ("momos"), so search finds
   * it by them (spec §5.3). Absent for areas or when the menu was not read.
   */
  aliases?: readonly string[]
  /**
   * A photo of it is already waiting for review: another one is welcome but
   * it is not an empty slot (spec §6 S1). Only in `MatchBoard.waiting`.
   */
  waiting?: boolean
  /**
   * The slot already has an accepted photo ("accepted") or one whose check
   * is due ("check-due"): a better or newer photo is welcome (spec §6), so
   * search finds it. Only in `MatchBoard.filled`.
   */
  filled?: "accepted" | "check-due"
}

/** Everything Match needs to offer slots, read once when it opens. */
export type MatchBoard = {
  slots: MatchSlot[]
  /** Empty amenity slots by name, so a search for one can say why it is missing. */
  amenities: string[]
  /**
   * Dish and area slots with a photo already waiting (spec §6 S1, §5.3):
   * found by search and kept as recent choices, never suggested as empty.
   */
  waiting?: MatchSlot[]
  /**
   * Dish and area slots already in the album, or due their check (spec §5.3,
   * §6, X5): found by search and kept as recent choices, never suggested.
   */
  filled?: MatchSlot[]
  /** The venue these slots belong to (spec §5.1, AC11), when known. */
  venue?: { id: string; name: string } | null
}

/** A place key as Album writes it: the subject id, or "unplaced". */
export const placeKey = (place: string | null) => place ?? "unplaced"

const EMPTY = new Set(["needed", "retake"])
const WAITING = new Set(["waiting", "sending"])
const FILLED = new Set(["accepted", "check-due"])

function toMatchSlot(
  place: AlbumPlace,
  slot: AlbumSlot,
  aliases: ReadonlyMap<string, readonly string[]> | undefined
): MatchSlot | null {
  const waiting = WAITING.has(slot.state)
  const filled = FILLED.has(slot.state)
    ? (slot.state as "accepted" | "check-due")
    : null
  if (!EMPTY.has(slot.state) && !waiting && !filled) return null
  const base = {
    id: slot.id,
    name: slot.name,
    group: slot.group,
    place: place.subjectId,
    placeLabel: place.label,
    brief: slot.brief,
    ...(waiting ? { waiting: true } : {}),
    ...(filled ? { filled } : {}),
  }
  if (slot.target.kind === "dish") {
    const names = aliases?.get(slot.target.itemId)
    return {
      ...base,
      ...(names?.length ? { aliases: names } : {}),
      target: {
        kind: "dish",
        itemId: slot.target.itemId,
        name: slot.target.itemName,
      },
    }
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

/**
 * The album's empty dish and area slots, place by place as Album orders them,
 * and (apart) the ones with a photo already waiting and the ones already in
 * the album. `aliases` are the menu's other names by dish item id.
 */
export function matchBoardOf(
  album: AlbumView,
  {
    aliases,
    venue = null,
  }: {
    aliases?: ReadonlyMap<string, readonly string[]>
    venue?: { id: string; name: string } | null
  } = {}
): MatchBoard {
  const places = [...album.places, ...(album.unplaced ? [album.unplaced] : [])]
  const slots: MatchSlot[] = []
  const waiting: MatchSlot[] = []
  const filled: MatchSlot[] = []
  const amenities: string[] = []
  for (const place of places)
    for (const group of place.groups)
      for (const slot of group.slots) {
        if (slot.target.kind === "amenity") {
          if (EMPTY.has(slot.state)) amenities.push(slot.name)
          continue
        }
        const match = toMatchSlot(place, slot, aliases)
        if (match?.waiting) waiting.push(match)
        else if (match?.filled) filled.push(match)
        else if (match) slots.push(match)
      }
  return { slots, amenities, waiting, filled, venue }
}

/**
 * Every slot Match can take a photo for: the empty ones, then the waiting
 * ones, then the ones already in the album.
 */
export function allSlots(board: MatchBoard): MatchSlot[] {
  return [...board.slots, ...(board.waiting ?? []), ...(board.filled ?? [])]
}

/** How many recent slots Match offers above the suggestions. */
export const RECENT_LIMIT = 3

/**
 * The slots the person matched most recently (spec §5.3 "recent subjects"),
 * newest first, that are still on the board: the caller puts this visit's
 * own choices before the phone's older ones, so the second and third photo
 * of a dish take one tap (§5.4, X4). Offered as choices, never applied.
 */
export function recentSlots(
  board: MatchBoard,
  recent: readonly string[],
  limit = RECENT_LIMIT
): MatchSlot[] {
  const byId = new Map(allSlots(board).map((slot) => [slot.id, slot]))
  const picked: MatchSlot[] = []
  for (const id of recent) {
    const slot = byId.get(id)
    if (slot && !picked.includes(slot)) picked.push(slot)
    if (picked.length >= limit) break
  }
  return picked
}

/**
 * How a slot Match offers is marked (X4, X5): "taken" when a photo of this
 * visit (or one still sending) went to it, "waiting" with a photo already
 * waiting for review, "accepted" or "check-due" when it is already in the
 * album; null for an empty slot. Each still welcomes another photo.
 */
export type SlotMark = "taken" | "waiting" | "accepted" | "check-due"

export function slotMark(
  slot: MatchSlot,
  taken: ReadonlySet<string>
): SlotMark | null {
  if (taken.has(slot.id)) return "taken"
  if (slot.waiting) return "waiting"
  return slot.filled ?? null
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

/** One word without a plural ending: "momos" and "momo" meet. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`
  if (word.length > 4 && /(ches|shes|xes|ses|oes)$/.test(word))
    return word.slice(0, -2)
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1)
  return word
}

/** True when a and b differ by at most one letter (added, lost or changed). */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
      continue
    }
    edits += 1
    if (edits > 1) return false
    if (a.length > b.length) i += 1
    else if (b.length > a.length) j += 1
    else {
      i += 1
      j += 1
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/**
 * How well one query word meets a text (spec §5.3: spelling variants and
 * approved aliases): 0 contained, 1 a plural or one-letter slip of a whole
 * word (words of four letters or more), -1 not at all.
 */
function wordScore(word: string, text: string, words: readonly string[]) {
  if (text.includes(word)) return 0
  const base = stem(word)
  if (base.length >= 3 && words.some((w) => stem(w).startsWith(base))) return 1
  if (word.length >= 4 && words.some((w) => oneEditApart(stem(w), base)))
    return 1
  return -1
}

/**
 * Every slot whose name, other names, section or place has every word of
 * `query` (spelling slips and plurals forgiven), names first: the empty
 * ones, then those with a photo already on its way or waiting (`taken` in
 * this visit, or waiting for review), then those already in the album. None
 * is left out for having a photo (X4, X5). An empty query finds nothing.
 */
export function searchSlots(
  board: MatchBoard,
  query: string,
  taken: ReadonlySet<string>
): MatchSlot[] {
  const words = fold(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (words.length === 0) return []
  const scored = allSlots(board).flatMap((slot) => {
    const names = [slot.name, ...(slot.aliases ?? [])].map(fold)
    const text = fold(`${names.join(" ")} ${slot.group} ${slot.placeLabel}`)
    const textWords = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    let score = 0
    for (const word of words) {
      const s = wordScore(word, text, textWords)
      if (s < 0) return []
      score += s
    }
    const own = fold(slot.name)
    const byName = words.every((word) => own.includes(word)) ? 0 : 1
    const band = slot.filled ? 2 : slot.waiting || taken.has(slot.id) ? 1 : 0
    return [{ slot, rank: [band, score > 0 ? 1 : 0, byName] }]
  })
  return scored
    .sort(
      (a, b) =>
        a.rank[0] - b.rank[0] ||
        a.rank[1] - b.rank[1] ||
        a.rank[2] - b.rank[2] ||
        a.slot.name.localeCompare(b.slot.name, "en-GB")
    )
    .map(({ slot }) => slot)
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

/**
 * The photos a choice applies to (spec §5.4 "Use for the next N photos"):
 * the shown photo and then the next `count - 1` photos without an answer, in
 * strip order. Never more than were asked for; never one already decided.
 */
export function groupKeys(
  photos: readonly { key: string }[],
  decided: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  shownKey: string,
  count: number
): string[] {
  const start = photos.findIndex((p) => p.key === shownKey)
  if (start < 0 || decided.has(shownKey)) return []
  const keys = [shownKey]
  for (let i = start + 1; i < photos.length && keys.length < count; i += 1)
    if (!decided.has(photos[i].key)) keys.push(photos[i].key)
  return keys
}

/** How many photos after the shown one still have no answer. */
export function openAfter(
  photos: readonly { key: string }[],
  decided: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  shownKey: string
): number {
  const start = photos.findIndex((p) => p.key === shownKey)
  if (start < 0) return 0
  return photos.slice(start + 1).filter((p) => !decided.has(p.key)).length
}

/** Photos in the order they were taken (capture time; location is never read). */
export function byCaptureTime<T extends { file: File }>(photos: T[]): T[] {
  return [...photos].sort((a, b) => a.file.lastModified - b.file.lastModified)
}
