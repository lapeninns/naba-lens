import { CONTENT_TYPE_LABELS } from "@/lib/menus/types"

import type { SharedKind } from "./model"

/*
 * Match's words (DESIGN.md §6.1, §7): British English, sentence case, no
 * "upload", "label this photo", "skip" or "discard".
 */
export const MATCH_COPY = {
  title: "Match your photos",
  photoOf: (n: number, total: number) => `Photo ${n} of ${total}`,
  question: "Which empty slot is this?",
  suggested: "Suggested",
  searchLabel: "Search all empty slots",
  searchCount: (n: number) =>
    n === 0 ? "" : n === 1 ? "1 empty slot" : `${n} empty slots`,
  searchNone: (query: string) => `No empty slot matches "${query}".`,
  amenityNote:
    "Amenities are not matched here: open the amenity in the album and answer its question first.",
  noSuggestions:
    "Nothing is empty here. Search for the slot, or choose Match later.",
  loading: "Finding the empty slots",
  loadFailed: "The empty slots could not be loaded.",
  tryAgain: "Try again",
  matchLater: "Match later",
  notForSlot: "Not for a slot",
  sharedQuestion: "What does it show?",
  sharedHint: "It is shared with the team with no slot.",
  sharedKind: (kind: SharedKind) => CONTENT_TYPE_LABELS[kind],
  back: "Back",
  closeRest: "Match the rest later",
  close: "Close",
  /** The strip's names for each photo. */
  stripLabel: "Your photos",
  stripPhoto: (n: number, total: number, outcome: string | null) =>
    outcome
      ? `Photo ${n} of ${total}: ${outcome}`
      : `Photo ${n} of ${total}: not matched yet`,
  matchedTo: (slot: string) => `in ${slot}`,
  laterWord: "under Match later",
  sharedWord: "shared, no slot",
  sending: "Sending",
  waiting: "Waiting",
  notSent: "Not sent",
  savedOnPhone: "Saved on this phone",
  tooMany: (max: number, extra: number) =>
    extra === 1
      ? `You can match ${max} photos at a time. 1 photo was left in your gallery.`
      : `You can match ${max} photos at a time. ${extra} photos were left in your gallery.`,
  // The end (§6.1 step 6).
  filled: (n: number) => (n === 1 ? "1 slot filled" : `${n} slots filled`),
  noneFilled: "No slots filled",
  next: "Each one shows as Waiting in the album until your manager has looked at it.",
  laterLine: (n: number) =>
    n === 1
      ? "1 photo is under Match later on Album."
      : `${n} photos are under Match later on Album.`,
  sharedLine: (n: number) =>
    n === 1
      ? "1 photo is shared with the team with no slot."
      : `${n} photos are shared with the team with no slot.`,
  failedLine: (n: number) =>
    n === 1
      ? "1 photo didn't send. Open Add photos to send it again."
      : `${n} photos didn't send. Open Add photos to send them again.`,
  seeAlbum: "See the album",
} as const

/** Match later (DESIGN.md §2.8, §5a step 5). */
export const MATCH_LATER_COPY = {
  title: "Match later",
  row: (n: number) => (n === 1 ? "1 photo to match" : `${n} photos to match`),
  rowAction: "Match",
  empty: "Every photo you added is matched to a slot.",
  intro:
    "These photos were added without a slot. Match each one, or say it is not for a slot.",
  saveFailed: "This photo could not be matched. Try again.",
  refused:
    "This photo can no longer be matched here. It stays on your profile.",
  back: "Album",
} as const
