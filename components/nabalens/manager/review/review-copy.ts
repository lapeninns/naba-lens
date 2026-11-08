// Words of the Review screen (venue manager workspace and the admin Review
// page) and the contributor view. Pure: safe in Server and Client Components.
// Manager copy says "item", never "dish".

import { plural } from "@/components/nabalens/coverage/copy"
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

export const REVIEW_STATUS_LABEL: Record<QueueStatus, string> = {
  pending: "Waiting",
  recheck: "Needs a recheck",
  needs_another_photo: "Asked for another",
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
}

export const REVIEW_COPY = {
  title: "Review",
  adminTitle: "Review menu photos",
  summary:
    "Photos staff labelled with a menu item, oldest first. A decision counts the photo for the item; it's already shared in Photos either way.",
  listLabel: "Photos to review",
  filtersLabel: "Filter photos",
  statusLabel: "Status",
  sectionLabel: "Section",
  allSections: "All sections",
  contributorLabel: "Contributor",
  allContributors: "Everyone",
  removeItemFilter: (item: string) => `Stop showing only ${item}`,
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
  matchedByReviewer: "Matched by a reviewer",
  movedFrom: (item: string) => `Moved from ${item}`,
  reason: "Reason",
  groupHeading: (item: string, n: number) => `${item} · ${plural(n, "photo")}`,
  moreOfItem: (n: number, item: string) =>
    `+${plural(n, "more photo")} of ${item}`,
  ownPhoto: "This is your photo. Another reviewer decides on it.",
  variantRemovedNote: "This option is no longer on the menu",
  settled: "Decided. Change the filter to see it in its new list.",

  // State chips
  state: {
    waiting: "Waiting",
    accepted: "Accepted",
    menuPhoto: "Menu photo",
    askedAnother: "Asked for another photo",
    recheck: "Needs a recheck",
    withdrawn: "Withdrawn",
  },

  // Actions
  accept: "Accept for this item",
  acceptPreferred: "Accept and set as menu photo",
  setPreferred: "Set as menu photo",
  reaccept: "Accept again for this menu",
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
  relinkLabel: "Why is the staff label wrong?",
  relinkEmpty: "Say why the staff label is wrong.",
  noteLabel: "Note",
  confirmFor: (item: string) => `Accept for ${item}`,
  confirmPick: "Accept for the chosen item",

  // Announcements
  announce: {
    accepted: (item: string) =>
      `Accepted for ${item}. ${item} now has a photo.`,
    acceptedPreferred: (item: string) =>
      `Accepted for ${item}. Set as the menu photo for ${item}.`,
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
  network:
    "Could not reach the server. Try again; the photo will not be decided twice.",
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

  // Contributor view
  contributorTitle: "Contributor",
  contributionsAt: (venue: string) => `Contributions at ${venue}`,
  tallies: (labelled: number, accepted: number, open: number) =>
    `${plural(labelled, "labelled photo")} · ${plural(accepted, "item")} accepted · ${plural(open, "open request")}`,
  backToReview: "Review",
} as const
