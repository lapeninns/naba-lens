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

/** One live menu decision on a photo: its own review line. */
export type MenuReviewLine = {
  photoId: string
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
  | PhotoContributionRow
  | TaskSendContributionRow
  | FindingContributionRow

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
    items: [...new Set(item.menuDecisions.map((d) => d.itemName))],
    sentAt: item.sentAt ?? item.at,
    upload: UPLOAD[item.uploadState],
    labels: labelsOf(item.labels),
    reviews: item.menuDecisions.map((decision) => ({
      photoId: decision.photoId,
      item: itemName(decision),
      state: decision.state,
      reason: decision.reason,
      offMenu:
        decision.state === "better_photo_requested" &&
        offMenu.has(decision.photoId),
    })),
    menuUseAccepted: item.menuUseAccepted === true,
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
  return rows.map((row, index) => {
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
