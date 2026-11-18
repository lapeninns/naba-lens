// Words of the manager review inbox (Full App v1 S2-REVIEW; spec §7 M2).
// Managers see the spec's action names (decision FA-7): "Approve for public
// use", "Keep as reference". Staff never see this file's words. Pure: safe
// in Server and Client Components.

import { plural } from "@/components/nabalens/coverage/copy"

import type { CapturedSource } from "@/lib/review/inbox"

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
})

/** "12 Nov 2026"; the input is an ISO instant. */
export function dayOf(iso: string): string {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? "" : DAY.format(new Date(t))
}

/** "Taken 12 Nov 2026", "Taken 12 Nov 2026 (corrected)" or "Taken: unknown". */
export function takenWords(
  capturedAt: string | null,
  source: CapturedSource
): string {
  if (!capturedAt || source === "unknown") return INBOX_COPY.takenUnknown
  const day = dayOf(capturedAt)
  if (source === "supplied") return `Taken ${day} (corrected)`
  if (source === "estimated") return `Taken about ${day}`
  return `Taken ${day}`
}

export const INBOX_COPY = {
  // Card flags
  needsLabel: "Needs label",
  /** Why a Needs label card waits (FA-4, the one unlabelled rule). */
  unlabelledWhy: {
    not_sure: "Sent as I'm not sure",
    no_dish: "Marked food or drink, no dish chosen",
    unmatched: "No slot chosen for 7 days",
  },
  video: "Video",
  possibleDuplicate: "Possible duplicate",
  belowPublic: "Small: reference use only",
  belowPublicHelp:
    "Under 1600 px on the long edge. Fine to keep as reference; a larger photo is better for public use.",
  takenUnknown: "Taken: unknown",
  note: "Note",
  details: "Details",
  detailsFor: (who: string) => `Details of the photo by ${who}`,

  // Filters
  narrowLabel: "Narrow",
  category: { food: "Food", drinks: "Drinks" },
  media: { photo: "Photos", video: "Videos" },
  age: { 2: "Waiting 2+ days", 7: "Waiting 7+ days" },
  duplicates: "Possible duplicates",
  neededBy: "Has a needed-by date",
  otherQueues:
    "Place and amenity photos are listed under the menu photos, with their own decisions.",

  // Detail
  title: "Photo review",
  back: "Back to Review",
  provenance: "Where it came from",
  contributor: "Taken by",
  uploaded: "Uploaded",
  size: "Size",
  sizeWords: (w: number, h: number) => `${w} × ${h} px`,
  sizeUnknown: "Unknown",
  noteNone: "No note",
  group: "Sent with",
  groupNone: "Sent on its own",
  sameFile: "Same file already here",
  duplicateLinked: "Matched to an earlier photo when it was sent",
  slots: "What it is for",
  dishSlot: "Menu item",
  placeSlot: "Place",
  amenitySlot: "Amenity",
  noSlots:
    "Not matched to a menu item, place or amenity yet. Use Fix label to choose one.",
  compare: "Already in the album",
  compareNone: "Nothing in the album for this yet",
  primary: "Main photo",
  presentation: (rev: number, note: string | null) =>
    note ? `Presentation ${rev}: ${note}` : `Presentation ${rev}`,
  neededByDay: (day: string) => `Needed by ${day}`,
  history: "History",
  historyNone: "No decisions yet",
  ownPhoto: "This is your photo. Another reviewer decides on it.",

  // Slot states
  state: {
    pending: "Waiting",
    accepted: "In the album",
    reference: "Kept as reference",
    needs_another_photo: "Another photo asked for",
    better_photo_requested: "Another photo asked for",
    needs_recheck: "Needs a recheck",
    not_used: "Not used",
    withdrawn: "Withdrawn",
  } as Record<string, string>,

  // Actions
  approve: "Approve for public use",
  keepReference: "Keep as reference",
  askAnother: "Ask for another photo",
  fixLabel: "Fix label",
  fixLabelHelp:
    "Choose the right menu item. The photo is accepted for it in the same step, the staff label is kept in the history, and the contributor is told.",
  markDuplicate: "Mark duplicate",
  notUsed: "Not used",
  restore: "Use again",
  withdraw: "Withdraw",
  withdrawFirst:
    "This photo has a decision. Withdraw it first to mark the photo Not used or a duplicate.",
  saving: "Saving…",
  reasonsLabel: "What should the next photo show?",
  reasonOther: "Something else",
  reasonNote: "Add a short note (optional)",
  reasonRequired: "Choose a reason or write one.",
  notUsedTitle: "Not used",
  notUsedLabel: "Why is this photo not used?",
  notUsedHelp:
    "The photo leaves the queue and earns nothing. The file is kept under the retention rules, and you can use it again later.",
  duplicateTitle: "Mark duplicate",
  duplicateHelp:
    "Choose the photo already in the album that this one repeats. It leaves the queue without adding coverage or credit; the contributor stays on record.",
  duplicateNone:
    "No photo of this is in the album yet, so this cannot be a duplicate of one. Use Not used instead.",
  withdrawTitle: "Withdraw",
  withdrawLabel: "Why is this photo no longer right?",
  cancel: "Cancel",
  confirm: "Confirm",

  // Set aside
  setAside: {
    not_used: (by: string | null, day: string) =>
      by ? `Not used, by ${by} on ${day}` : `Not used on ${day}`,
    duplicate: (by: string | null, day: string) =>
      by ? `Marked duplicate by ${by} on ${day}` : `Marked duplicate on ${day}`,
  },

  // Results
  done: "Saved.",
  conflictTitle: "Someone else decided this photo first",
  conflictLatest: (action: string, by: string | null, day: string | null) =>
    [action, by ? `by ${by}` : null, day ? `on ${day}` : null]
      .filter(Boolean)
      .join(" "),
  conflictBody:
    "Here is the latest. Check it before you decide again; nothing was changed.",
  refresh: "Show the latest",
  failed: "This photo could not load.",
  failedWhat: "this photo",

  // Batch
  batch: {
    start: "Decide several",
    cancel: "Stop choosing",
    heading: "Choose photos to decide together",
    help: "Only photos waiting for a decision can be chosen. Each one is still checked on its own.",
    selected: (n: number) => `${plural(n, "photo")} chosen`,
    none: "Choose at least one photo.",
    choose: (who: string, item: string | null) =>
      item ? `${item}, photo by ${who}` : `Photo by ${who}`,
    confirmTitle: (action: string, n: number) =>
      `${action}: ${plural(n, "photo")}`,
    confirmBody:
      "These are exactly the photos that will be decided. Each one is checked on its own, so one that changed since you chose it is left for you to review again.",
    reasonLabel: "Why are these photos not used?",
    result: (done: number, failed: number) =>
      failed === 0
        ? `${plural(done, "photo")} decided.`
        : `${plural(done, "photo")} decided. ${plural(failed, "photo")} need another look.`,
    tooMany: (max: number) => `Choose at most ${max} photos at a time.`,
  },

  // Amenity photos on Review
  amenities: {
    heading: "Amenity photos",
    empty: "No amenity photos waiting",
    failed: "Amenity photos could not load.",
    by: (who: string, day: string) => `Photo by ${who} · ${day}`,
    more: "More are waiting. Decide these first.",
  },

  // History action words
  history_action: {
    accepted: "Accepted",
    level_set: "Level changed",
    better_photo_requested: "Another photo asked for",
    needs_another_photo: "Another photo asked for",
    withdrawn: "Withdrawn",
    primary_set: "Made the main photo",
    primary_cleared: "No longer the main photo",
    invalidated: "No longer counts",
    needs_recheck: "Sent for a recheck",
    carried: "Carried to the new menu",
    not_used: "Not used",
    duplicate: "Marked duplicate",
    restored: "Used again",
  } as Record<string, string>,
} as const

/** The history line's words for an action; the raw action when unknown. */
export function historyWords(action: string, level: string | null): string {
  const base = INBOX_COPY.history_action[action] ?? action.replaceAll("_", " ")
  if (action === "accepted" || action === "level_set") {
    if (level === "reference") return `${base}: kept as reference`
    if (level === "public") return `${base}: approved for public use`
  }
  return base
}
