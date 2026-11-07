// Types of the manager-facing menu photo module (Overview, Menu, Review, item
// and contributor screens). Types only, no runtime code, so client components
// can import them with `import type`. The services live beside this file and
// are server-only.

import type { CoverageFailure } from "@/lib/server/coverage/types"

export type ManagerMenuState = "no_menu" | "empty" | "ready"

/** An item's headline: the same for every caller (manager or admin). */
export type MenuItemStatus = "covered" | "awaiting_review" | "needs_photo"

/** Menu list filter: a headline, or "Needs a recheck" / "New photo waiting". */
export type MenuStatusFilter = MenuItemStatus | "recheck" | "replacement"

export type ContributorStatus = "here" | "moved" | "left" | "manager"

export type QueueStatus =
  | "pending"
  | "recheck"
  | "needs_another_photo"
  | "accepted"
  | "stale_label"
  | "unlabelled"
  | "mine"
  | "all"

export type PhotoState = "accepted" | "better_photo_requested" | "needs_recheck"

export type RecheckKind = "name_changed" | "section_changed" | "variant_removed"

export type PhotoBasis = "staff_label" | "reviewer"

export type SectionKind = "food" | "drinks"

/** Scoped item-photo routes (signed per request); null without a derivative. */
export type PhotoAsset = {
  assetId: string
  thumbnailUrl: string | null
  previewUrl: string | null
  width: number | null
  height: number | null
}

export type OverviewSection = {
  sectionId: string
  name: string
  kind: SectionKind
  position: number
  eligible: number
  covered: number
  awaitingReview: number
  needsPhoto: number
}

export type ManagerOverview = {
  venueId: string
  venueName: string
  menuState: ManagerMenuState
  menu: { versionId: string; title: string; activatedAt: string | null } | null
  eligible: number
  covered: number
  /** Not covered, with a waiting photo (anyone's). */
  awaitingReviewItems: number
  /** Not covered, nothing waiting. */
  needsPhotoItems: number
  /** Covered, with a newer photo waiting. */
  replacementPendingItems: number
  /** Items with a recheck the caller can act on. */
  needsRecheckItems: number
  /** Photos the caller can decide on now (the Review badge). */
  pendingPhotos: number
  /** A manager's own earlier photos, waiting for another reviewer. */
  ownWaitingPhotos: number
  oldestPendingAt: string | null
  carriedItems: number
  newItems: number
  sections: OverviewSection[]
}

export type ManagerMenuItem = {
  itemId: string
  name: string
  description: string | null
  section: { id: string; name: string; kind: SectionKind; position: number }
  entryPosition: number
  variants: { variantId: string; name: string }[]
  status: MenuItemStatus
  hasPendingReplacement: boolean
  needsRecheck: boolean
  /** The caller's own photos of this item waiting for another reviewer. */
  ownWaiting: number
  /** Photos the caller cannot act on that are not theirs ("Waiting for an admin"). */
  othersWaiting: number
  acceptedCount: number
  /** Photos of this item the caller can decide on. */
  candidateCount: number
  preferred: PhotoAsset | null
  itemRevision: number
}

/** One staff label tuple of a photo; `onMenu` false for an item no longer on the menu. */
export type StaffLabel = {
  itemId: string
  variantId: string | null
  itemName: string
  variantName: string | null
  onMenu: boolean
}

export type QueueCardKind = "labelled" | "unlabelled" | "stale" | "decided"

export type QueueCard = {
  /** Stable card key (label, photo or asset id); also the paging key. */
  key: string
  kind: QueueCardKind
  labelId: string | null
  photoId: string | null
  asset: PhotoAsset
  uploadedAt: string
  labelledAt: string | null
  contributor: {
    id: string
    name: string
    status: ContributorStatus
    canFollowUp: boolean
  }
  isSelf: boolean
  /** The menu item the card is for; null on stale and unlabelled cards. */
  item: null | {
    itemId: string
    name: string
    sectionId: string
    sectionName: string
    variantId: string | null
    variantName: string | null
    covered: boolean
  }
  staffLabels: StaffLabel[]
  state: PhotoState | null
  isPrimary: boolean
  isEffectivePrimary: boolean
  basis: PhotoBasis | null
  reason: string | null
  recheckKind: RecheckKind | null
  correctsItemId: string | null
  correctsVariantId: string | null
  correctsItemName: string | null
  /**
   * The card item's revision. 0 on stale and unlabelled cards (no item):
   * their decisions use the picked item's `ManagerMenuItem.itemRevision`.
   */
  itemRevision: number
  /** Other cards of the same item in this status set. */
  groupCount: number
}

export type ItemPhoto = {
  photoId: string
  asset: PhotoAsset
  state: PhotoState
  basis: PhotoBasis
  isPrimary: boolean
  isEffective: boolean
  variantId: string | null
  variantName: string | null
  recheckKind: RecheckKind | null
  reason: string | null
  decidedAt: string
  decidedByName: string | null
  author: {
    id: string
    name: string
    status: ContributorStatus
    canFollowUp: boolean
  }
  isSelf: boolean
  correctsItemId: string | null
  correctsVariantId: string | null
  correctsItemName: string | null
}

export type ManagerItemDetail = {
  item: ManagerMenuItem
  /** The menu photo; `fallback` when no photo is flagged and the earliest accepted one shows. */
  preferred: (ItemPhoto & { fallback: boolean }) | null
  alternatives: ItemPhoto[]
  askedForAnother: ItemPhoto[]
  recheck: ItemPhoto[]
  /** The first page of this item's waiting photos the caller can decide on. */
  waiting: Page<QueueCard>
}

export type ItemEventAction =
  | "accepted"
  | "better_photo_requested"
  | "withdrawn"
  | "primary_set"
  | "primary_cleared"
  | "invalidated"
  | "needs_recheck"
  | "carried"

export type ItemEvent = {
  id: string
  action: ItemEventAction
  photoId: string
  actorName: string | null
  actorRole: "staff" | "manager" | "admin" | "system"
  reason: string | null
  basis: PhotoBasis | null
  correctsItemName: string | null
  recheckKind: RecheckKind | null
  createdAt: string
}

export type Contributor = {
  id: string
  name: string
  status: ContributorStatus
  labelledPhotos: number
  acceptedItems: number
  openFollowUps: number
  lastUploadAt: string | null
}

export type DecisionAction =
  | "accept"
  | "accept_preferred"
  | "set_preferred"
  | "ask_another"
  | "withdraw"
  | "reaccept"
  | "relink"
  | "assign_stale"
  | "assign_unlabelled"

export type DecideInput = {
  /** Stable per attempt: a retry with the same id replays the committed decision. */
  requestId: string
  action: DecisionAction
  assetId: string
  /** The target item (the picked item for relink and assign). */
  itemId: string
  variantId?: string | null
  /** Required for set_preferred and withdraw. */
  photoId?: string
  /** The target item's revision. */
  expectedRevision: number
  reason?: string
  /** relink / assign_stale: the staff label being corrected; reaccept of a reviewer row: its stored value. */
  correctsItemId?: string
  correctsVariantId?: string | null
  /** reaccept: the card's basis; "reviewer" re-accepts through the assign path. */
  basis?: PhotoBasis | null
  /** Admins name the venue; a manager's venue always comes from their scope. */
  venueId?: string
}

export type DecisionOutcome = {
  action: DecisionAction
  itemId: string
  itemRevision: number
  replayed: boolean
  itemCovered: boolean
  preferredAssetId: string | null
  /**
   * The corrected (source) item's new head after a relink or a correction:
   * its other loaded cards need this revision for the next decision.
   */
  correctsItem?: { itemId: string; itemRevision: number } | null
  /** Fresh cards of this item for the current status (the asset's own cards on stale and unlabelled views). */
  cards: QueueCard[]
}

export type Page<T> = { items: T[]; nextCursor: string | null }

export type MenuPhotoFailure = CoverageFailure & {
  /** revision_conflict: the item's latest cards for the current status. */
  current?: QueueCard[]
  /** state_conflict: the screen is out of date; offer Refresh. */
  needsRefresh?: boolean
}

export type MenuPhotoResult<T = object> = ({ ok: true } & T) | MenuPhotoFailure
