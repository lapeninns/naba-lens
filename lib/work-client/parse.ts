import {
  ACCOUNT_KINDS,
  IMPACT_EFFECTS,
  IMPACT_KINDS,
  TRIAGE_QUEUES,
  type AccountKind,
  type DeleteImpact,
  type DeleteImpactItem,
  type ImpactEffect,
  type ImpactKind,
  type LabelWork,
  type TriageQueue,
  type TriageQueueName,
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
  if (!accountKind || typeof raw.venueId !== "string" || !raw.venueId)
    return null
  const selfConfirm: Record<string, boolean> = {}
  for (const [key, flag] of Object.entries(record(raw.canSelfConfirm) ?? {}))
    selfConfirm[key] = allowed(flag)
  return {
    accountKind,
    venueId: raw.venueId,
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
export function parseTriage(value: unknown): TriageQueue[] | null {
  if (!Array.isArray(value)) return null
  const rows = new Map<TriageQueueName, TriageQueue>()
  for (const item of value) {
    const raw = record(item)
    if (!raw) return null
    const queue = oneOf<TriageQueueName>(TRIAGE_QUEUES, raw.queue)
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
  return TRIAGE_QUEUES.flatMap((queue) => rows.get(queue) ?? [])
}

/** R9 `my_asset_delete_impact`. Null when the read itself is unusable. */
export function parseDeleteImpact(value: unknown): DeleteImpact | null {
  const raw = record(value)
  if (!raw || !Array.isArray(raw.impacts)) return null
  const items: DeleteImpactItem[] = []
  for (const entry of raw.impacts) {
    const item = record(entry)
    if (!item) return null
    const kind = oneOf<ImpactKind>(IMPACT_KINDS, item.kind)
    const effect = oneOf<ImpactEffect>(IMPACT_EFFECTS, item.effect)
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
