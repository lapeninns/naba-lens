// B05-06 asset search screen: every word the screen says, in one place
// (contracts/b05-search-screen-scope.md; brief §4). British English. The use
// words are coordinator decision SS-1 (owner sign-off pending).

import type {
  MenuDecisionState,
  SearchRights,
} from "@/lib/server/media/search/types"
import type { MediaKind } from "@/lib/server/media/types"

import { ERROR_COPY } from "../error-state"

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

/** "Uploaded before use records" and the rest (SS-1). Never an approval word. */
export const RIGHTS_LABEL: Record<SearchRights, string> = {
  legacy_unknown: "Uploaded before use records",
  not_granted: "No use agreed",
  in_force: "In use",
  expired: "Use ended",
  withdrawn: "Use withdrawn",
}

/** Today's menu decision on a photo (wording from Review and Menu). */
export const DECISION_LABEL: Record<MenuDecisionState, string> = {
  accepted: "Accepted",
  better_photo_requested: "Another photo asked for",
  needs_recheck: "Sent for a recheck",
  withdrawn: "Withdrawn",
  invalidated: "Label no longer valid",
}

export const MEDIA_WORD: Record<MediaKind, string> = {
  image: "Photo",
  video: "Video",
}

export const SEARCH_COPY = {
  title: "Search photos and videos",
  /** The link to this screen from the library, Overview and Manage. */
  entry: "Search photos and videos",
  introManager: (venue: string) => `Find photos and videos from ${venue}.`,
  introAdmin: "Find photos and videos from every venue.",
  allVenues: "All venues",
  order: "newest first",

  filtersLabel: "Search filters",
  venue: "Venue",
  anyVenue: "All venues",
  mediaType: "Photo or video",
  mediaBoth: "Both",
  mediaPhotos: "Photos",
  mediaVideos: "Videos",
  item: "Menu item",
  anyItem: "Any menu item",
  chooseVenueFirst: "Choose a venue first",
  chooseVenueHint: "Choose a venue to filter by menu item.",
  menuLoading: "Loading this venue's menu…",
  itemsLabel: "Menu items",
  noItemsMatch: "No menu items match.",
  keepTyping: (n: number) => `Keep typing to see more (${n} match).`,
  itemNotOnMenu: "Item not on this venue's menu",
  clearItem: "Clear menu item",
  variant: "Option",
  anyVariant: "Any option",
  rights: "Use",
  anyRights: "Any use",
  destination: "Where it's used",
  anyDestination: "Anywhere",
  menuState: "Menu decision",
  anyDecision: "Any decision",
  uploaded: "Uploaded",
  uploadedFrom: "Uploaded from",
  uploadedTo: "Uploaded to",
  datesHint: "Upload dates, London time.",
  moreFilters: "More filters",
  fewerFilters: "Fewer filters",
  moreOn: "on",
  clearFilters: "Clear filters",

  resultsHeading: "Results",
  /** The filter summary: "Showing: Soup, In use, uploaded from 1 Nov." */
  showing: "Showing:",
  pillName: (value: string) => `Showing: ${value}. Remove filter`,
  pillFrom: (day: string) => `uploaded from ${day}`,
  pillTo: (day: string) => `uploaded to ${day}`,
  pillItem: "the chosen menu item",
  pillVariant: "the chosen option",
  pillCheck: "the chosen check",
  pillGroup: "the chosen set",
  pillSubmission: "the chosen submission",
  pillVenue: "the chosen venue",
  pillDestination: "the chosen place",

  shown: (n: number) => `${n} shown`,
  shownMore: (n: number) => `Showing ${n}. More available.`,
  searching: "Searching…",
  stillSearching: "Still searching. Keep this page open.",
  showMore: "Show more",
  loadingMore: "Loading more…",
  allShown: (n: number) => `All ${n} shown`,
  moreFailed: "More photos and videos couldn't load. Try again.",
  moreLoaded: (n: number) =>
    `${plural(n, "more photo or video", "more photos and videos")} shown.`,

  emptyManager: (venue: string) => `No photos or videos at ${venue} yet.`,
  emptyManagerBody:
    "Accepted menu photos and check evidence appear here once they're uploaded.",
  emptyAdmin: "No photos or videos yet.",
  emptyFiltered: "Nothing matches these filters.",
  widenVenue: "Try all venues.",
  widenDates: "Try removing a filter or widening the dates.",
  widen: "Try removing a filter.",

  couldNotLoad: `${ERROR_COPY.couldNotLoad("these photos and videos")}.`,
  tryAgain: ERROR_COPY.tryAgain,
  reload: ERROR_COPY.reload,
  checkFilters: "Check the search filters.",
  dateOrder: "The start date must be before the end date.",
  badDate: "Enter a date like 3 Nov 2026.",
  expired: "This page link has expired. Search again.",
  searchAgain: "Search again",
  notManager: "Only venue managers and admins can search photos and videos.",
  wrongVenue: "You can search your own venue only.",
  venueNotFound: "This venue could not be found.",
  signedOut: "Sign in to continue.",
  signIn: "Sign in",

  // A card: read-only, never a link to a viewer.
  uploadedAt: (when: string) => `Uploaded ${when}`,
  by: (firstName: string) => `By ${firstName}`,
  forItem: (item: string, variant: string | null) =>
    variant ? `For ${item} · ${variant}` : `For ${item}`,
  amenityCheck: "Amenity check evidence",
  venueQuestion: "Venue question evidence",
  checklistPhoto: "Checklist photo",
  inSet: "Sent as part of a set",
  menuPhoto: "Menu photo",
  inUseOn: (where: string, until: string | null) =>
    until ? `In use on ${where} until ${until}` : `In use on ${where}`,
  endedOn: (where: string, ended: string | null) =>
    ended ? `Use on ${where} ended ${ended}` : `Use on ${where} ended`,
  thumbAlt: (media: string, subject: string) => `${media} for ${subject}`,
  thumbAltPlain: (media: string, when: string) => `${media} uploaded ${when}`,
  noThumb: "No preview",
  useHeading: "Use",
  decisionsHeading: "Menu decisions",
} as const

/** The word the card shows for an asset-level use state with no place named. */
export const ASSET_USE_LINE = {
  granted: RIGHTS_LABEL.in_force,
  not_granted: RIGHTS_LABEL.not_granted,
  legacy_unknown: RIGHTS_LABEL.legacy_unknown,
  withdrawn: RIGHTS_LABEL.withdrawn,
} as const

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/London",
})
const DAY_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
})
const YEAR = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  timeZone: "Europe/London",
})
const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/London",
})

/** "3 Nov, 14:05" this year, "3 Nov 2025, 14:05" before (London time). */
export function uploadedWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "on an unknown date"
  const sameYear = YEAR.format(date) === YEAR.format(now)
  return `${(sameYear ? DAY : DAY_YEAR).format(date)}, ${TIME.format(date)}`
}

/** "3 Nov 2026" for a period end (London time). */
export function dayOf(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "" : DAY_YEAR.format(date)
}

/** A YYYY-MM-DD filter day as "1 Nov" (or "1 Nov 2025" in another year). */
export function filterDay(day: string, now: Date = new Date()): string {
  const date = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return (YEAR.format(date) === YEAR.format(now) ? DAY : DAY_YEAR).format(date)
}
