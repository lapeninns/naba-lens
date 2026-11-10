// My contributions on Me (UI design §6.1): one row per R5 feed item, in the
// server's send-time order. Each dimension (upload, labels, review, use) is
// its own field so the screen says them on separate lines, never merged.

import type {
  ContributionsFeedItem,
  FeedMenuDecision,
  FeedPhotoItem,
  FeedTaskSendItem,
} from "@/lib/knowledge/contract"
import { adaptClosed, adaptFinding } from "@/lib/knowledge-client/adapt"
import type { FindingSummary } from "@/lib/knowledge-client/contract"

export type UploadDimension = "saving" | "not_finished" | "saved"
export type LabelsDimension = "needs_labels" | "labelled" | "needs_attention"

/**
 * One menu review line on a photo: a live decision, or a labelled item still
 * waiting for one (no photoId). `key` is stable within the photo's row.
 */
export type MenuReviewLine = {
  key: string
  itemId: string
  photoId: string | null
  item: string
  state: FeedMenuDecision["state"]
  reason: string | null
  /**
   * A better photo was asked for but the item is off the current menu (D13):
   * no new photo is needed and no action is offered.
   */
  offMenu: boolean
}

export type PhotoContributionRow = {
  type: "photo"
  key: string
  assetId: string
  venueId: string
  venueName: string
  mediaType: FeedPhotoItem["mediaType"]
  /** Menu item names from its decisions; empty means the row is "Photo". */
  items: string[]
  sentAt: string
  upload: UploadDimension
  labels: LabelsDimension | null
  reviews: MenuReviewLine[]
  /** R7, OD-6: the only use claim. Never a revision for a menu photo. */
  menuUseAccepted: boolean
  /** W1: the photo's contribution group; null when single or unknown. */
  groupId: string | null
  /** Loaded rows next to this one in the same group, itself included. */
  setSize: number | null
}

export type TaskSendContributionRow = {
  type: "task_send"
  key: string
  title: string | null
  venueId: string
  venueName: string
  sentAt: string
  review: "waiting" | "accepted" | "needs_another_photo"
  reason: string | null
  /** R6: set only when this send replaced an earlier one (revision > 1). */
  revision: { number: number; replacesSentAt: string | null } | null
}

export type FindingContributionRow = {
  type: "finding"
  key: string
  finding: FindingSummary
  /** The send time of my earlier finding on the question that this replaced. */
  replacedEarlierAt: string | null
}

export type ContributionRow =
  PhotoContributionRow | TaskSendContributionRow | FindingContributionRow

const UPLOAD: Record<FeedPhotoItem["uploadState"], UploadDimension> = {
  uploading: "saving",
  processing: "saving",
  ready: "saved",
  failed: "not_finished",
}

const REVIEW: Record<
  FeedTaskSendItem["state"],
  TaskSendContributionRow["review"]
> = {
  submitted: "waiting",
  accepted: "accepted",
  needs_another_photo: "needs_another_photo",
}

function labelsOf(labels: FeedPhotoItem["labels"]): LabelsDimension | null {
  if (labels.needsAttention) return "needs_attention"
  if (labels.needsLabels) return "needs_labels"
  return labels.hasLabels ? "labelled" : null
}

const itemName = (decision: FeedMenuDecision) =>
  decision.variantName
    ? `${decision.itemName} (${decision.variantName})`
    : decision.itemName

// One title per menu item. A waiting row carries the item's current name and
// a decided row the name at decision time, so a renamed item is matched by
// its id, keeping the first name (live decisions come first).
function titlesOf(decisions: readonly FeedMenuDecision[]): string[] {
  const names = new Map<string, string>()
  for (const decision of decisions)
    if (!names.has(decision.itemId))
      names.set(decision.itemId, decision.itemName)
  return [...names.values()]
}

function photoRow(
  item: FeedPhotoItem,
  offMenu: ReadonlySet<string>
): PhotoContributionRow {
  return {
    type: "photo",
    key: item.key,
    assetId: item.assetId,
    venueId: item.venueId,
    venueName: item.venueName,
    mediaType: item.mediaType,
    items: titlesOf(item.menuDecisions),
    sentAt: item.sentAt ?? item.at,
    upload: UPLOAD[item.uploadState],
    labels: labelsOf(item.labels),
    reviews: item.menuDecisions.map((decision, index) => ({
      key: `${index}:${decision.photoId ?? decision.itemId}`,
      itemId: decision.itemId,
      photoId: decision.photoId,
      item: itemName(decision),
      state: decision.state,
      reason: decision.reason,
      offMenu:
        decision.state === "better_photo_requested" &&
        offMenu.has(decision.photoId),
    })),
    menuUseAccepted: item.menuUseAccepted === true,
    groupId: item.groupId ?? null,
    setSize: null,
  }
}

function taskSendRow(item: FeedTaskSendItem): TaskSendContributionRow {
  return {
    type: "task_send",
    key: item.key,
    title: item.requirementTitle,
    venueId: item.venueId,
    venueName: item.venueName,
    sentAt: item.sentAt ?? item.at,
    review: REVIEW[item.state],
    reason: item.reason,
    revision:
      item.revision > 1
        ? { number: item.revision, replacesSentAt: item.replacesSentAt }
        : null,
  }
}

/**
 * "One of a set of {n}" (§6.1, §7): photo rows next to each other in the
 * server's order with the same group. Counted from the loaded rows only;
 * rows are never merged or moved.
 */
function withSetSizes(rows: ContributionRow[]): ContributionRow[] {
  const sizes = new Map<number, number>()
  let start = 0
  for (let i = 1; i <= rows.length; i++) {
    const group = (row: ContributionRow | undefined) =>
      row?.type === "photo" ? row.groupId : null
    const current = group(rows[start])
    if (i < rows.length && current && group(rows[i]) === current) continue
    if (current && i - start > 1)
      for (let at = start; at < i; at++) sizes.set(at, i - start)
    start = i
  }
  return rows.map((row, index) =>
    row.type === "photo" && sizes.has(index)
      ? { ...row, setSize: sizes.get(index)! }
      : row
  )
}

/**
 * Rows for the loaded feed items, newest first as the server sent them.
 * `offMenuPhotoIds`: menu photos whose better-photo request is for an item no
 * longer on the menu (R2 `canRetake: false`).
 */
export function contributionRows(
  items: readonly ContributionsFeedItem[],
  offMenuPhotoIds: ReadonlySet<string> = new Set()
): ContributionRow[] {
  // A closed assignment has no venue name of its own; borrow it from another
  // row at the same venue.
  const venueNames = new Map<string, string>()
  for (const item of items)
    if ("venueName" in item && item.venueName)
      venueNames.set(item.venueId, item.venueName)

  const rows = items.map((item): ContributionRow => {
    switch (item.type) {
      case "photo":
        return photoRow(item, offMenuPhotoIds)
      case "task_send":
        return taskSendRow(item)
      case "finding":
        return {
          type: "finding",
          key: item.key,
          finding: adaptFinding(item),
          replacedEarlierAt: null,
        }
      case "assignment_closed":
        return {
          type: "finding",
          key: item.key,
          finding: adaptClosed(item, venueNames.get(item.venueId) ?? ""),
          replacedEarlierAt: null,
        }
    }
  })

  // A finding that my newer one replaced is the next older finding of mine
  // on the same question; only rows already loaded can say so, and an
  // unknown time is left out.
  return withSetSizes(rows).map((row, index) => {
    if (row.type !== "finding" || !row.finding.findingRef) return row
    const earlier = rows
      .slice(index + 1)
      .find(
        (other): other is FindingContributionRow =>
          other.type === "finding" &&
          other.finding.findingRef !== null &&
          other.finding.checkId === row.finding.checkId
      )
    return earlier?.finding.noLongerUsed === "replaced_by_own" &&
      earlier.finding.sentAt
      ? { ...row, replacedEarlierAt: earlier.finding.sentAt }
      : row
  })
}
