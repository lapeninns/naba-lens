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
  /** FA-4, spec §5.3: the manager chooses the slot. */
  notSure: "I'm not sure",
  notSureHint: "Your manager will choose the slot.",
  /** The venue these photos go to (spec §5.1, AC11). */
  venueLine: (venue: string) => `For ${venue}`,
  /** Spec §5.4: how many photos still have no answer. */
  openCount: (n: number) =>
    n === 1 ? "1 not matched yet" : `${n} not matched yet`,
  venueChanged: (venue: string, n: number) =>
    n === 0
      ? `You are now adding photos for ${venue}. The slots below are ${venue}'s.`
      : n === 1
        ? `You are now adding photos for ${venue}. Choose the slot again for 1 photo.`
        : `You are now adding photos for ${venue}. Choose the slot again for ${n} photos.`,
  recent: "Recent",
  /** A slot with a photo already waiting (spec §6 S1). */
  waitingMeta: "Waiting · another photo is welcome",
  // "Use for the next N photos" (spec §5.4, FA-3).
  groupLabel: "Same slot for the next photos too?",
  groupPhoto: (n: number) => `Photo ${n} too`,
  groupAll: (n: number) => `All ${n} left`,
  groupJustThis: "Just this one",
  groupNone: "Tap the last photo of the same thing to group them.",
  groupHint: (n: number) =>
    n <= 1
      ? ""
      : n === 2
        ? "This photo and the next one get the same answer."
        : `This photo and the next ${n - 1} get the same answer.`,
  // The optional note (spec §5.1).
  noteToggle: "Add a note",
  noteLabel: "Note for your manager (optional)",
  noteHint: "A few words, if it helps. Nobody has to write one.",
  noteSaved: (n: number) => (n === 1 ? "1 note added" : `${n} notes added`),
  // Advisory checks (spec §5.5): never a reason not to send.
  qualityDark: "This photo looks dark. You can still send it.",
  qualityBlurry: "This photo looks blurred. You can still send it.",
  qualitySmall:
    "This photo is small (under 1600 pixels). Fine to send; it may be kept for reference.",
  duplicateWord: "Sent before: it won't count twice",
  // A dish not on the menu (S1-MENUS): suggest it as a local special.
  specialQuestion: (name: string) =>
    `Not on the menu? Suggest "${name}" to your manager as a special:`,
  specialKind: (kind: "food" | "drinks") =>
    kind === "food" ? "It's food" : "It's a drink",
  specialDone: (name: string) =>
    `"${name}" is suggested to your manager. For this photo, choose I'm not sure.`,
  specialFailed: "It could not be suggested.",
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
  /** Uploaded, the server still processing it (spec §5.6). */
  checking: "Checking",
  waiting: "Waiting",
  /** Processed, but its slot was not saved with it. */
  sentWord: "Sent",
  /** The server had it and could not finish it (Processing failed). */
  unfinishedWord: "Couldn't finish",
  notSent: "Not sent",
  savedOnPhone: "Saved on this phone",
  notAddedWord: "Not added",
  photosOnly: "Only photos can be matched.",
  /** Photos Match left in the gallery, each group with the queue's reason. */
  notAdded: (reasons: readonly string[]) => {
    const groups = new Map<string, number>()
    for (const reason of reasons)
      groups.set(reason, (groups.get(reason) ?? 0) + 1)
    return [...groups]
      .map(([reason, n]) =>
        n === 1
          ? `1 photo was left in your gallery. ${reason}`
          : `${n} photos were left in your gallery. ${reason}`
      )
      .join(" ")
  },
  tooMany: (max: number, extra: number) =>
    extra === 1
      ? `You can match ${max} photos at a time. 1 photo was left in your gallery.`
      : `You can match ${max} photos at a time. ${extra} photos were left in your gallery.`,
  // The end (§6.1 step 6).
  filled: (n: number) => (n === 1 ? "1 slot filled" : `${n} slots filled`),
  noneFilled: "No slots filled",
  /** The end while every matched photo is still on the phone (§6.8, AC09). */
  savedHeading: (n: number) =>
    n === 1 ? "1 photo saved on this phone" : `${n} photos saved on this phone`,
  heldLine: "They send when the signal returns.",
  next: "Each one shows as Waiting in the album until your manager has looked at it.",
  /** The end's heading line (spec §6 S2): venue and how many photos. */
  summaryVenue: (venue: string, n: number) =>
    n === 1 ? `1 photo for ${venue}` : `${n} photos for ${venue}`,
  summaryPhotos: (n: number) => (n === 1 ? "1 photo" : `${n} photos`),
  /** One slot's chip on the end: name and how many photos went to it. */
  slotChip: (name: string, n: number) => (n === 1 ? name : `${name} × ${n}`),
  unsureLine: (n: number) =>
    n === 1
      ? "1 photo is with your manager, who will choose its slot."
      : `${n} photos are with your manager, who will choose their slots.`,
  unsureWord: "With your manager",
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
  unfinishedLine: (n: number) =>
    n === 1
      ? "1 photo arrived but couldn't be finished. Open Add photos and choose Retry; it won't be sent twice."
      : `${n} photos arrived but couldn't be finished. Open Add photos and choose Retry; they won't be sent twice.`,
  refusedLine: (n: number) =>
    n === 1
      ? "1 photo could not be added. It is still in your gallery."
      : `${n} photos could not be added. They are still in your gallery.`,
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
