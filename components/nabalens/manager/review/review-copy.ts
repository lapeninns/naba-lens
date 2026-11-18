// Words of the Review screen (venue manager workspace and the admin Review
// page) and the contributor view. Pure: safe in Server and Client Components.
// Manager copy says "item", never "dish".

import { plural } from "@/components/nabalens/coverage/copy"
import { CHIP_STATES } from "@/components/nabalens/status-chip"
import { INBOX_COPY } from "./inbox-copy"
import { dishName } from "@/lib/menus/dish-name"

import type {
  ContributorStatus,
  QueueStatus,
  RecheckKind,
} from "@/lib/server/menu-photos/types"

export { plural }

/** "Priya" from "Priya Shah" (the same rule as the coverage screens). */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName
}

/** "November 2026" from a `YYYY-MM-01` month. */
function monthName(month: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month.slice(0, 10)}T00:00:00Z`))
}

/**
 * What accepting a photo also counts for (ORP-3b): "Starters · Priya's
 * November 2026". Null when it counts for nothing beyond the dish.
 */
export function alsoCountsText(
  counts: { tasks: string[]; month: string | null } | undefined,
  contributorName: string
): string | null {
  if (!counts) return null
  const parts = [...counts.tasks]
  if (counts.month)
    parts.push(`${firstName(contributorName)}'s ${monthName(counts.month)}`)
  return parts.length > 0 ? parts.join(" · ") : null
}

// Manager review words (S3-R13, DESIGN.md §7 manager and admin words,
// departure A-REV-1): outside Review in a thumb, a waiting photo is
// "Awaiting review" and a retake "Another photo requested", the report words
// of status-chip.tsx; the decision words are INBOX_COPY.publicUse and "Ask
// for another photo". Review in a thumb keeps Accept and Ask again.
export const REVIEW_STATUS_LABEL: Record<QueueStatus, string> = {
  pending: CHIP_STATES.coverage_pending.word,
  recheck: "Needs a recheck",
  needs_another_photo: CHIP_STATES.coverage_replacement_needed.word,
  accepted: "Accepted",
  stale_label: "Labelled for an old menu",
  unlabelled: "Unlabelled photos",
  mine: "Your photos",
  all: "All",
}

/** Filter order; "Your photos" shows only when the caller has some waiting. */
export const REVIEW_STATUS_ORDER: QueueStatus[] = [
  "pending",
  "recheck",
  "needs_another_photo",
  "accepted",
  "stale_label",
  "unlabelled",
  "mine",
  "all",
]

export const CONTRIBUTOR_CHIP: Record<ContributorStatus, string | null> = {
  here: null,
  moved: "Moved venue",
  left: "Left",
  manager: "Manager account",
}

export const CONTRIBUTOR_STATUS_LABEL: Record<ContributorStatus, string> = {
  here: "At this venue",
  moved: "Moved venue",
  left: "Left",
  manager: "Manager account",
}

export const RECHECK_LABEL: Record<RecheckKind, string> = {
  name_changed: "Name changed on the new menu",
  section_changed: "Section type changed",
  variant_removed: "Option no longer on the menu",
  presentation_changed: "Served differently now",
}

export const REVIEW_COPY = {
  title: "Review",
  adminTitle: "Review menu photos",
  summary:
    "Photos staff labelled with a menu item, oldest first. Accepting counts the photo for the item and shares it with colleagues in Photos.",
  listLabel: "Photos to review",
  filtersLabel: "Filter photos",
  statusLabel: "Status",
  sectionLabel: "Section",
  allSections: "All sections",
  contributorLabel: "Contributor",
  allContributors: "Everyone",
  // The name starts with the visible text, so voice control can say it.
  removeItemFilter: (item: string) => `Showing: ${item}. Remove filter`,
  showingItem: (item: string) => `Showing: ${item}`,
  showingThisItem: "Showing: one item",
  loadMore: "Show more",
  loadMoreFailed: "More photos could not load. Try again.",
  moreLoaded: (n: number) => `${plural(n, "more photo")} loaded`,

  // Card
  openPreview: (name: string) => `Open the photo by ${name}`,
  photoBy: (name: string) => `Photo by ${name}`,
  you: "You",
  uploaded: (date: string, age: string | null) =>
    age ? `Uploaded ${date} · waiting ${age}` : `Uploaded ${date}`,
  labelled: (item: string, variant: string | null, unspecified = false) =>
    `Labelled: ${dishName({ name: item, variantName: variant }, unspecified)}`,
  noLabel: "No label",
  labelledOld: (item: string) => `Labelled for ${item}, no longer on the menu`,
  menuItem: "Menu item",
  noMenuItem: "Not matched to a menu item yet",
  alsoCounts: "Also counts for",
  matchedByReviewer: "Matched by a reviewer",
  movedFrom: (item: string) => `Moved from ${item}`,
  reason: "Reason",
  groupHeading: (item: string, n: number) => `${item} · ${plural(n, "photo")}`,
  /** Photos sent together as one set (B02-05); each keeps its own decision. */
  set: (n: number) => `A set of ${n} photos. Each is decided on its own.`,
  moreOfItem: (n: number, item: string) =>
    `+${plural(n, "more photo")} of ${item}`,
  ownPhoto: "This is your photo. Another reviewer decides on it.",
  /** A Needs label video (S3-R8 W1): dishes take photos only. */
  videoNoDish:
    "A video can't be a dish photo. Open its details to mark it Not used.",
  variantRemovedNote: "This option is no longer on the menu",
  settled: "Decided. Change the filter to see it in its new list.",

  // State chips
  state: {
    waiting: CHIP_STATES.coverage_pending.word,
    accepted: "Accepted",
    menuPhoto: "Menu photo",
    askedAnother: CHIP_STATES.coverage_replacement_needed.word,
    recheck: "Needs a recheck",
    withdrawn: "Withdrawn",
  },

  // Actions
  accept: INBOX_COPY.publicUse.action,
  acceptPreferred: INBOX_COPY.publicUse.withMenuPhoto,
  setPreferred: "Set as menu photo",
  reaccept: INBOX_COPY.publicUse.again,
  relink: "Choose a different menu item",
  chooseItem: "Choose a menu item",
  alsoUse: "Also use for another item",
  askAnother: "Ask for another photo",
  withdraw: "Withdraw acceptance",
  moreActions: "More actions",
  saving: "Saving…",

  // Ask for another photo
  askTitle: (item: string) => `Ask for another photo of ${item}`,
  askLabel: "What should the next photo show?",
  askEmpty: "Say what the next photo should show.",
  askNote: (name: string) =>
    `${firstName(name)} sees this with the photo in their own area.`,
  followUp: {
    moved: (name: string) =>
      `${name} has moved venue and can no longer add photos here. Staff can still find this gap in Our menu.`,
    left: (name: string) =>
      `${name} has left, so they won't see this request. Staff can still find this gap in Our menu.`,
    manager: (name: string) =>
      `${name} now has a manager account and can't add photos. Staff can still find this gap in Our menu.`,
  } satisfies Record<Exclude<ContributorStatus, "here">, (n: string) => string>,

  // Withdraw
  withdrawTitle: (item: string) => `Withdraw acceptance for ${item}`,
  withdrawLabel: "Why is this photo no longer right?",
  withdrawEmpty: "Say why this photo is no longer right.",
  withdrawPrimary: (item: string) =>
    `This is the menu photo. Another accepted photo becomes the menu photo, or ${item} will need a photo again.`,
  withdrawNote: "The photo stays in Photos and on the contributor's profile.",

  // Item picker
  pickerTitle: "Choose a menu item",
  pickerSearch: "Search the menu",
  pickerPlaceholder: "Item name",
  pickerItems: "Menu items",
  pickerEmpty: "No items match. Try another word.",
  pickerLoading: "Loading items…",
  pickerFailed: "The menu could not load. Try again.",
  pickerChoose: "Choose an item.",
  pickerVariant: "Option",
  pickerNoVariant: "Any option",
  pickerSameItem: "Choose a different item or option.",
  // Fix label's one picker (S3-R13 X8): menu items, places and amenities.
  pickerKind: "What the photo shows",
  pickerKindDish: "Menu item",
  pickerKindPlace: "Place",
  pickerKindAmenity: "Amenity",
  pickerSearchSlots: "Search by name",
  pickerSlotPlaceholder: "Place or amenity",
  pickerSlotsEmpty: "Nothing matches. Try another word.",
  pickerSlotsFailed: "The places and amenities could not load. Try again.",
  pickerChooseSlot: "Choose a place or amenity.",
  pickerSameSlot: "The photo is already matched to that. Choose another.",
  confirmPickSlot: INBOX_COPY.publicUse.forChosenOne,
  relinkLabel: "Why is the staff label wrong?",
  relinkEmpty: "Say why the staff label is wrong.",
  noteLabel: "Note",
  confirmFor: INBOX_COPY.publicUse.forItem,
  confirmPick: INBOX_COPY.publicUse.forChosenItem,

  // Announcements
  announce: {
    accepted: INBOX_COPY.publicUse.done,
    acceptedPreferred: INBOX_COPY.publicUse.doneWithMenuPhoto,
    preferred: (item: string) => `Set as the menu photo for ${item}.`,
    asked: (name: string, item: string) =>
      `Asked ${firstName(name)} for another photo of ${item}.`,
    withdrawnGap: (item: string) => `Withdrawn. ${item} needs a photo again.`,
    withdrawnOther: "Withdrawn. Another accepted photo is now the menu photo.",
    withdrawnKept: (item: string) => `Withdrawn. ${item} keeps its menu photo.`,
    moved: (item: string) => `Moved to ${item} and accepted.`,
  },
  conflict: (item: string) =>
    `Someone else changed ${item} first. Here is the latest.`,
  // The reply was lost: the decision may be saved. The request id is kept.
  network:
    "We couldn't confirm the decision was saved. Check your connection, then try again or refresh to see if it was. The photo won't be decided twice.",
  refresh: "Refresh",

  // Empty states
  empty: {
    pending: "Nothing waiting for review",
    pendingGap: "See items without a photo",
    recheck: "No items need a new decision",
    stale_label: "No photos labelled for an old menu",
    unlabelled: (venue: string) => `No unlabelled photos at ${venue}`,
    mine: "None of your earlier photos are waiting",
    other: "No photos here yet",
  },
  noMenuTitle: "Menu photos will appear once your venue's menu is set up",
  noMenuBody:
    "An admin activates the menu. Staff can keep adding photos to their portfolios meanwhile.",
  emptyMenuTitle: "Your active menu has no items to photograph",
  emptyMenuBody: "Ask an admin to check the menu.",
  /**
   * Needs label while the menu is not ready (S3-R8 W2): a dish needs a ready
   * menu; Not used works now.
   */
  needsLabelMenuNotReady:
    "Choosing a dish waits for the menu. You can still open each one and mark it Not used.",

  // Contributor view
  contributorTitle: "Contributor",
  contributionsAt: (venue: string) => `Contributions at ${venue}`,
  tallies: (labelled: number, accepted: number, open: number) =>
    `${plural(labelled, "labelled photo")} · ${plural(accepted, "item")} accepted · ${plural(open, "open request")}`,
  backToReview: "Review",
} as const
