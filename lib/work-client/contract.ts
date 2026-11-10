// B02 work views (docs/knowledge/b02-design.md, WS1): what the staff and
// manager screens read about the caller's capabilities, label work, triage
// queues and a photo's delete impact. The server answers in jsonb, so
// ./parse.ts checks every value before a screen sees it; anything it can't
// read becomes null and the screen keeps its B01 behaviour.

export const ACCOUNT_KINDS = [
  "staff",
  "staff_with_grant",
  "manager",
  "admin",
] as const
export type AccountKind = (typeof ACCOUNT_KINDS)[number]

/** R8 `my_venue_capabilities`. It never grants anything; it hides choices. */
export type VenueCapabilities = {
  accountKind: AccountKind
  venueId: string
  canUpload: boolean
  canLabel: boolean
  canSendFindings: boolean
  canConfirmFindings: boolean
  /** Per question key; a missing key reads as not allowed. */
  canSelfConfirm: Readonly<Record<string, boolean>>
  canReviewMenuPhotos: boolean
  canDecideOwnMenuPhoto: boolean
  canReviewChecklist: boolean
  canBeAssigned: boolean
}

/** R1 `my_label_work`. */
export type LabelWork = { needsLabels: number; needsAttention: number }

export const TRIAGE_QUEUES = ["menu_photos", "findings", "checklist"] as const
export type TriageQueueName = (typeof TRIAGE_QUEUES)[number]

/** R3 `manager_triage_summary`: one row per queue, never summed (D6). */
export type TriageQueue =
  | { queue: TriageQueueName; available: false }
  | {
      queue: TriageQueueName
      available: true
      waiting: number
      oldestWaitingAt: string | null
      /** Menu photos only: the caller's own, never part of `waiting`. */
      ownWaiting: number
    }

export const IMPACT_KINDS = [
  "answer_in_use",
  "pending_finding",
  "earlier_answer",
] as const
export type ImpactKind = (typeof IMPACT_KINDS)[number]

export const IMPACT_EFFECTS = [
  "needs_recheck",
  "withdrawn",
  "none",
  "pending_loses_evidence",
] as const
export type ImpactEffect = (typeof IMPACT_EFFECTS)[number]

/**
 * One R9 item. Only the venue name, question text, effect and whether it is
 * the caller's own: never a name, answer value, finding text or note.
 */
export type DeleteImpactItem = {
  kind: ImpactKind
  effect: ImpactEffect
  venueName: string
  question: string
  yours: boolean
}

/** R9 read: `unknown` when an item uses a kind or effect this client can't word. */
export type DeleteImpact =
  { status: "known"; items: DeleteImpactItem[] } | { status: "unknown" }
