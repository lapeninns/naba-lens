import type {
  ContributionsFeedItem,
  ContributionsFeedPage,
} from "@/lib/knowledge/contract"

import {
  ACCOUNT_KINDS,
  IMPACT_EFFECTS,
  IMPACT_KINDS,
  TRIAGE_ROWS,
  type AccountKind,
  type AssetGroup,
  type DeleteImpact,
  type DeleteImpactEffect,
  type DeleteImpactKind,
  type ImpactLine,
  type LabelWork,
  type TriageRowQueue,
  type TriageRow,
  type VenueCapabilities,
} from "./contract"

type Json = Record<string, unknown>

function record(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null
}

function oneOf<T extends string>(
  values: readonly T[],
  value: unknown
): T | null {
  return typeof value === "string" &&
    (values as readonly string[]).includes(value)
    ? (value as T)
    : null
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null
}

function instant(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : null
}

// A capability that isn't exactly `true` is off: a missing or garbled key may
// hide a choice, never show one the gates would refuse.
function allowed(value: unknown): boolean {
  return value === true
}

export function parseCapabilities(value: unknown): VenueCapabilities | null {
  const raw = record(value)
  if (!raw) return null
  const accountKind = oneOf<AccountKind>(ACCOUNT_KINDS, raw.accountKind)
  // A staff member with no current venue has none.
  const venueId =
    typeof raw.venueId === "string" && raw.venueId ? raw.venueId : null
  if (!accountKind || (raw.venueId !== null && venueId === null)) return null
  const selfConfirm: Record<string, boolean> = {}
  for (const [key, flag] of Object.entries(record(raw.canSelfConfirm) ?? {}))
    selfConfirm[key] = allowed(flag)
  return {
    accountKind,
    venueId,
    canUpload: allowed(raw.canUpload),
    canLabel: allowed(raw.canLabel),
    canSendFindings: allowed(raw.canSendFindings),
    canConfirmFindings: allowed(raw.canConfirmFindings),
    canSelfConfirm: selfConfirm,
    canReviewMenuPhotos: allowed(raw.canReviewMenuPhotos),
    canDecideOwnMenuPhoto: allowed(raw.canDecideOwnMenuPhoto),
    canReviewChecklist: allowed(raw.canReviewChecklist),
    canBeAssigned: allowed(raw.canBeAssigned),
  }
}

/** Accepts the table row (`needs_labels`) or a camelCased one. */
export function parseLabelWork(value: unknown): LabelWork | null {
  const raw = record(Array.isArray(value) ? value[0] : value)
  if (!raw) return null
  const needsLabels = count(raw.needs_labels ?? raw.needsLabels)
  const needsAttention = count(raw.needs_attention ?? raw.needsAttention)
  if (needsLabels === null || needsAttention === null) return null
  return { needsLabels, needsAttention }
}

/**
 * R3 rows. Null when the read is unusable as a whole; a row for a queue this
 * client doesn't know is dropped, and each known queue appears at most once.
 */
export function parseTriage(value: unknown): TriageRow[] | null {
  if (!Array.isArray(value)) return null
  const rows = new Map<TriageRowQueue, TriageRow>()
  for (const item of value) {
    const raw = record(item)
    if (!raw) return null
    const queue = oneOf<TriageRowQueue>(TRIAGE_ROWS, raw.queue)
    if (!queue || rows.has(queue)) continue
    if (raw.available !== true) {
      rows.set(queue, { queue, available: false })
      continue
    }
    const waiting = count(raw.waiting)
    if (waiting === null) return null
    rows.set(queue, {
      queue,
      available: true,
      waiting,
      oldestWaitingAt: instant(raw.oldest_waiting_at ?? raw.oldestWaitingAt),
      ownWaiting: count(raw.own_waiting ?? raw.ownWaiting) ?? 0,
    })
  }
  return TRIAGE_ROWS.flatMap((queue) => rows.get(queue) ?? [])
}

/** R9 `my_asset_delete_impact`. Null when the read itself is unusable. */
export function parseDeleteImpact(value: unknown): DeleteImpact | null {
  const raw = record(value)
  if (!raw || !Array.isArray(raw.impacts)) return null
  const items: ImpactLine[] = []
  for (const entry of raw.impacts) {
    const item = record(entry)
    if (!item) return null
    const kind = oneOf<DeleteImpactKind>(IMPACT_KINDS, item.kind)
    const effect = oneOf<DeleteImpactEffect>(IMPACT_EFFECTS, item.effect)
    if (!kind || !effect) return { status: "unknown" }
    if (
      typeof item.venueName !== "string" ||
      typeof item.question !== "string" ||
      typeof item.yours !== "boolean"
    )
      return null
    items.push({
      kind,
      effect,
      venueName: item.venueName,
      question: item.question,
      yours: item.yours,
    })
  }
  return { status: "known", items }
}

const FEED_TYPES = ["photo", "task_send", "finding", "assignment_closed"]
const UPLOAD_STATES = ["uploading", "processing", "ready", "failed"]
const SEND_STATES = ["submitted", "accepted", "needs_another_photo"]
const DECISION_STATES = ["accepted", "better_photo_requested", "needs_recheck"]

const text = (value: unknown): value is string => typeof value === "string"

// Each type's fields the rows read; a row missing one can't be worded.
function feedItemReadable(raw: Json): boolean {
  switch (raw.type) {
    case "photo":
      return (
        text(raw.assetId) &&
        text(raw.venueName) &&
        oneOf(UPLOAD_STATES, raw.uploadState) !== null &&
        record(raw.labels) !== null &&
        Array.isArray(raw.menuDecisions) &&
        raw.menuDecisions.every((entry) => {
          const decision = record(entry)
          if (!decision || !text(decision.itemId) || !text(decision.itemName))
            return false
          // A labelled item still waiting has no decision row (no photoId).
          if (decision.state === "waiting") return decision.photoId === null
          return (
            oneOf(DECISION_STATES, decision.state) !== null &&
            text(decision.photoId)
          )
        })
      )
    case "task_send":
      return (
        text(raw.venueName) &&
        oneOf(SEND_STATES, raw.state) !== null &&
        typeof raw.revision === "number"
      )
    case "finding":
      return (
        record(raw.findingRef) !== null &&
        text(raw.checkId) &&
        text(raw.question) &&
        text(raw.state)
      )
    default:
      return text(raw.checkId) && text(raw.question)
  }
}

/**
 * R5 page. Null when the page or a row of a known type is unreadable; a row
 * of a type this client doesn't know is dropped. The server's order is kept.
 */
export function parseContributionsPage(
  value: unknown
): ContributionsFeedPage | null {
  const raw = record(value)
  if (!raw || !Array.isArray(raw.items)) return null
  if (raw.nextCursor !== null && !text(raw.nextCursor)) return null
  const items: ContributionsFeedItem[] = []
  for (const entry of raw.items) {
    const item = record(entry)
    if (!item || !text(item.key) || instant(item.at) === null) return null
    if (oneOf(FEED_TYPES, item.type) === null) continue
    if (!feedItemReadable(item)) return null
    items.push(item as unknown as ContributionsFeedItem)
  }
  return { items, nextCursor: raw.nextCursor as string | null }
}

// ---- W1 contribution groups -----------------------------------------------------

const GROUP_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `contribution_group_start`: the group's id. */
export function parseGroupId(value: unknown): { groupId: string } | null {
  return typeof value === "string" && GROUP_UUID.test(value)
    ? { groupId: value }
    : null
}

/** `contribution_group_add`: how many members the group has now. */
export function parseGroupMembers(value: unknown): { members: number } | null {
  const members = count(value)
  return members === null ? null : { members }
}

/**
 * `contribution_groups_for_assets` rows (or camelCased ones). Null when the
 * read is unusable as a whole; an asset appears at most once.
 */
export function parseAssetGroups(value: unknown): AssetGroup[] | null {
  if (!Array.isArray(value)) return null
  const groups = new Map<string, string>()
  for (const entry of value) {
    const raw = record(entry)
    if (!raw) return null
    const assetId = raw.asset_id ?? raw.assetId
    const groupId = raw.group_id ?? raw.groupId
    if (typeof assetId !== "string" || typeof groupId !== "string") return null
    if (!GROUP_UUID.test(assetId) || !GROUP_UUID.test(groupId)) return null
    if (!groups.has(assetId)) groups.set(assetId, groupId)
  }
  return [...groups].map(([assetId, groupId]) => ({ assetId, groupId }))
}
