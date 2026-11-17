// Copy and small display helpers for Our menu: menu items with an accepted
// photo. A separate measure from the monthly targets and section coverage, so
// its words never say "target", "coverage" or "task". Pure: safe in Server
// and Client Components.

import { plural } from "@/components/nabalens/coverage/copy"

import { dayLabel } from "@/lib/server/coverage/time"
import type { ItemPhotoState, NeededBy } from "@/lib/server/coverage/types"

export const OUR_MENU_COPY = {
  title: "Our menu",
  loading: "Loading our menu…",
  /** Exact wording from the proposal: no active menu yet. */
  noMenu: "Menu photos will appear once your venue’s menu is set up",
  noMenuText:
    "An admin publishes each venue’s menu. Your photos stay in your portfolio meanwhile.",
  emptyTitle: "Your venue’s menu has no dishes or drinks yet",
  emptyText: "Once the menu lists food or drinks, they appear here.",
  unavailableTitle: "We couldn't load our menu",
  needsVenue: "You need to be assigned to a venue first",
  needsVenueText:
    "An admin can add you to your venue. Then its menu appears here.",
  /**
   * Opens the phone's photos with the dish applied as a label (gallery
   * first, DESIGN.md §2; there is no in-app camera, §9).
   */
  addPhotos: "Add photos of this dish",
  gaps: "Still needs a photo",
  allDishes: "All dishes",
  allSections: "All sections",
  search: "Search the menu",
  searchPlaceholder: "Dish or drink",
  find: "Search",
  // Not "Clear search": that names the cross inside the search box, which
  // only empties it. This link reloads the list without the search.
  clear: "Stop searching",
  hasPhoto: "Has an accepted photo",
  recheck: "Being checked after a menu change",
  /** UP-25: the person's own photos of this dish still to be decided. */
  myWaiting: (n: number) =>
    n === 1
      ? "Your photo is waiting for review"
      : `${n} of your photos are waiting for review`,
  noMatches: "No dishes match",
  noMatchesText: "Try another word, or clear the search.",
  allCovered: "Every dish here has an accepted photo.",
  howItCounts:
    "A dish counts once a manager accepts a photo labelled with it for menu use. Your photos are saved to your portfolio either way.",
} as const

export const ITEM_REVIEW_COPY = {
  title: "Our menu",
  summary:
    "Labelled photos waiting for a decision, oldest first. Accepting a photo for a dish counts it for Our menu; it's already shared in Photos either way.",
  labellingNote:
    "Only photos labelled with a dish appear here. Unlabelled photos need labelling by whoever added them first; managers can't label a colleague's photo.",
  toReview: "To review",
  allDishes: "All dishes",
  emptyQueue:
    "Nothing to review. Labelled photos appear here once they're ready.",
  emptyItem: "No labelled photos of this dish yet.",
  accept: "Accept for this dish",
  makePrimaryOnAccept: "Use as the dish's main photo",
  /** A reviewer's "needs another photo" decision (v0.5 §2 Retake note). */
  askBetter: "Ask for another photo",
  /** Under the reason field; the photo's author sees the reason. */
  askReasonHelp: "Say what the next photo needs.",
  askReasonMissing: "Add a reason. Say what the next photo needs.",
  undo: "Undo acceptance",
  makePrimary: "Make main photo",
  primary: "Main photo",
  accepted: "Accepted for menu use",
  betterRequested: "Needs another photo",
  recheck: "Check after a menu change",
  waiting: "Waiting for a decision",
  variantRemoved:
    "This option is no longer on the menu, so the photo can't be accepted for it again. Undo the acceptance to clear the check.",
  variantGone: "No longer on the menu",
  selfNote:
    "You took this photo. You can review it; the decision is recorded as a self-review.",
  backToQueue: "Back to photos to review",
  allPhotosOfDish: "All photos of this dish",
} as const

/** "12 of 40 menu items have an accepted photo". */
export function itemsWithPhoto(covered: number, eligible: number): string {
  return `${covered} of ${plural(eligible, "menu item")} ${eligible === 1 ? "has" : "have"} an accepted photo`
}

/** "3 of 8" with an accepted photo, for one section. */
export function sectionCount(covered: number, eligible: number): string {
  return `${covered} of ${eligible} with an accepted photo`
}

export const ITEM_PHOTO_STATE_LABEL: Record<
  Exclude<ItemPhotoState, "withdrawn" | "invalidated">,
  string
> = {
  accepted: ITEM_REVIEW_COPY.accepted,
  better_photo_requested: ITEM_REVIEW_COPY.betterRequested,
  needs_recheck: ITEM_REVIEW_COPY.recheck,
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long a photo has waited, from `since` to `now` (both ISO instants, so
 * server and browser render the same words): "under an hour", "5 hours",
 * "3 days". Null for an unknown time.
 */
export function waitingFor(since: string | null, now: string): string | null {
  if (!since) return null
  const ms = Date.parse(now) - Date.parse(since)
  if (Number.isNaN(ms)) return null
  if (ms < HOUR) return "under an hour"
  if (ms < DAY) return plural(Math.floor(ms / HOUR), "hour")
  return plural(Math.floor(ms / DAY), "day")
}

/**
 * G-7: a manager's "needed by" date on a still-needed dish (v0.5 rule 24).
 * Never Overdue: after the date the word is "Needed".
 */
export const NEEDED_BY_COPY = {
  /** The heading over dishes with a date, which lead the list. */
  groupTitle: "Needed soon",
  label: (neededBy: NeededBy) =>
    neededBy.passed ? "Needed" : `Needed by ${dayLabel(neededBy.date)}`,
}

/** G-7: the manager's and admin's control for one dish's date. */
export const NEEDED_BY_CONTROL_COPY = {
  title: "Needed by",
  intro:
    "Put a date on this dish to show it first in Still needed for everyone at the venue. The date clears when a photo of the dish is accepted.",
  date: "Date",
  hint: "From today to a year ahead. After the date the dish stays first and shows Needed.",
  save: "Save date",
  saving: "Saving",
  clear: "Clear date",
  clearing: "Clearing",
  saved: (name: string, label: string) => `${name}: ${label}.`,
  cleared: (name: string) => `Cleared the date on ${name}.`,
  network: "Could not reach NabaLens. Check your connection and try again.",
}
