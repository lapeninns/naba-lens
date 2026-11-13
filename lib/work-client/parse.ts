import {
  ASSET_USE_STATES,
  GROUP_MEMBER_DERIVATIVES,
  GROUP_MEMBER_LABELS,
  GROUP_MEMBER_TECHNICAL,
  GROUP_REVIEW_TARGETS,
  GROUP_SUBJECT_KINDS,
  type AssetUseSummary,
  type ContributionGroupMember,
  type ContributionGroupReplaceResult,
  type ContributionGroupView,
  type ContributionsFeedItem,
  type ContributionsFeedPage,
  type GroupReviewEntry,
  type GroupSummary,
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
    // B03-g (A1, A16): a manager account or an admin; never a guess.
    canCorrect: allowed(raw.canCorrect),
    canWithdraw: allowed(raw.canWithdraw),
    canReadHistory: allowed(raw.canReadHistory),
    // A35: who may state a policy with authority, on which basis.
    canStatePolicy: allowed(raw.canStatePolicy),
    canStateOrgPolicy: allowed(raw.canStateOrgPolicy),
    policyBasis:
      raw.policyBasis === "venue_manager" || raw.policyBasis === "admin"
        ? raw.policyBasis
        : null,
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

// ---- B05-m5 group view and replacement ------------------------------------------
//
// contribution_group gains keys over time (B05-02, B05-03). A key this client
// doesn't know is ignored and left out of the result. The keys a screen
// renders (the group, each member's identity and upload state, technical,
// replacesAssetId, summary, creatorFirstName) make the whole read unusable
// when present but wrong. labels, review, use and derivative are only passed
// on: one that can't be read is left out of its member.

const MEDIA_TYPES = ["image", "video"] as const
const MEMBER_UPLOAD_STATES = [
  "uploading",
  "processing",
  "ready",
  "failed",
] as const

const uuid = (value: unknown): value is string =>
  typeof value === "string" && GROUP_UUID.test(value)

const nullableText = (value: unknown): value is string | null =>
  value === null || typeof value === "string"

function readSummary(value: unknown): GroupSummary | null {
  const raw = record(value)
  if (!raw) return null
  const live = count(raw.live)
  const ready = count(raw.ready)
  const inProgress = count(raw.inProgress)
  const failed = count(raw.failed)
  const removed = count(raw.removed)
  const replaced = count(raw.replaced)
  if (
    live === null ||
    ready === null ||
    inProgress === null ||
    failed === null ||
    removed === null ||
    replaced === null ||
    typeof raw.finished !== "boolean"
  )
    return null
  return {
    live,
    ready,
    inProgress,
    failed,
    removed,
    replaced,
    finished: raw.finished,
  }
}

function readReview(value: unknown): GroupReviewEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries: GroupReviewEntry[] = []
  for (const entry of value) {
    const raw = record(entry)
    if (!raw) return undefined
    const target = oneOf(GROUP_REVIEW_TARGETS, raw.target)
    // A target this client can't word is skipped, not the whole list.
    if (!target) continue
    if (!nullableText(raw.id) || typeof raw.state !== "string") return undefined
    entries.push({ target, id: raw.id, state: raw.state })
  }
  return entries
}

function readUse(value: unknown): AssetUseSummary | null | undefined {
  if (value === null) return null
  const raw = record(value)
  if (!raw) return undefined
  const state = oneOf(ASSET_USE_STATES, raw.state)
  if (!state || !Array.isArray(raw.destinations)) return undefined
  if (raw.inForce === undefined) {
    if (!raw.destinations.every((d) => typeof d === "string")) return undefined
    return { state, destinations: raw.destinations as string[] }
  }
  const inForce = count(raw.inForce)
  const withdrawn = count(raw.withdrawn)
  if (inForce === null || withdrawn === null) return undefined
  const destinations: { label: string; state: string; until: string | null }[] =
    []
  for (const entry of raw.destinations) {
    const d = record(entry)
    if (
      !d ||
      typeof d.label !== "string" ||
      typeof d.state !== "string" ||
      !nullableText(d.until)
    )
      return undefined
    destinations.push({ label: d.label, state: d.state, until: d.until })
  }
  return { state, inForce, withdrawn, destinations }
}

function readMember(value: unknown): ContributionGroupMember | null {
  const raw = record(value)
  if (!raw) return null
  const position = count(raw.position)
  const mediaType = oneOf(MEDIA_TYPES, raw.mediaType)
  const uploadState = oneOf(MEMBER_UPLOAD_STATES, raw.uploadState)
  if (
    !uuid(raw.assetId) ||
    position === null ||
    position < 1 ||
    !mediaType ||
    !uploadState ||
    typeof raw.mine !== "boolean"
  )
    return null
  const member: ContributionGroupMember = {
    assetId: raw.assetId,
    position,
    mediaType,
    uploadState,
    mine: raw.mine,
  }
  if ("replacesAssetId" in raw) {
    if (raw.replacesAssetId !== null && !uuid(raw.replacesAssetId)) return null
    member.replacesAssetId = raw.replacesAssetId
  }
  if ("technical" in raw) {
    const technical = oneOf(GROUP_MEMBER_TECHNICAL, raw.technical)
    if (!technical) return null
    member.technical = technical
  }
  if ("stopped" in raw) {
    if (typeof raw.stopped !== "boolean") return null
    member.stopped = raw.stopped
  }
  // Only schedules a later read: one that can't be read is left out.
  if (raw.stoppedAt === null) member.stoppedAt = null
  else if (instant(raw.stoppedAt) !== null)
    member.stoppedAt = raw.stoppedAt as string
  const labels = oneOf(GROUP_MEMBER_LABELS, raw.labels)
  if (labels) member.labels = labels
  const review = readReview(raw.review)
  if (review) member.review = review
  const use = readUse(raw.use)
  if (use !== undefined) member.use = use
  if (raw.derivative === null) member.derivative = null
  else {
    const derivative = oneOf(GROUP_MEMBER_DERIVATIVES, raw.derivative)
    if (derivative) member.derivative = derivative
  }
  return member
}

/**
 * `contribution_group`. Null when a key the screens render is missing or
 * wrong; unknown keys are ignored and left out.
 */
export function parseGroupView(value: unknown): ContributionGroupView | null {
  const raw = record(value)
  if (!raw || !Array.isArray(raw.members)) return null
  const subject = record(raw.subject)
  const kind = oneOf(GROUP_SUBJECT_KINDS, subject?.kind)
  if (
    !uuid(raw.groupId) ||
    !uuid(raw.venueId) ||
    instant(raw.createdAt) === null ||
    typeof raw.mine !== "boolean" ||
    !subject ||
    !kind ||
    !(subject.id === null || uuid(subject.id)) ||
    !nullableText(subject.name)
  )
    return null
  const members: ContributionGroupMember[] = []
  for (const entry of raw.members) {
    const member = readMember(entry)
    if (!member) return null
    members.push(member)
  }
  const view: ContributionGroupView = {
    groupId: raw.groupId,
    venueId: raw.venueId,
    createdAt: raw.createdAt as string,
    mine: raw.mine,
    subject: { kind, id: subject.id, name: subject.name },
    members,
  }
  if ("summary" in raw) {
    const summary = readSummary(raw.summary)
    if (!summary) return null
    view.summary = summary
  }
  if ("creatorFirstName" in raw) {
    if (!nullableText(raw.creatorFirstName)) return null
    view.creatorFirstName = raw.creatorFirstName
  }
  return view
}

/** `contribution_group_replace`: the new member and the one it replaces. */
export function parseGroupReplace(
  value: unknown
): ContributionGroupReplaceResult | null {
  const raw = record(value)
  if (!raw) return null
  const position = count(raw.position)
  if (
    !uuid(raw.groupId) ||
    !uuid(raw.assetId) ||
    !uuid(raw.replacesAssetId) ||
    position === null ||
    position < 1
  )
    return null
  return {
    groupId: raw.groupId,
    assetId: raw.assetId,
    replacesAssetId: raw.replacesAssetId,
    position,
  }
}
