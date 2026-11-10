// B02 work views (docs/knowledge/b02-design.md, WS1): what the staff and
// manager screens read about the caller's capabilities, label work, triage
// queues and a photo's delete impact. The database answers in jsonb, so
// ./parse.ts checks every value before a screen sees it; anything it can't
// read becomes null and the screen keeps its B01 behaviour. The server's own
// shapes are lib/knowledge/contract's and are re-exported here.

import type {
  DeleteImpactEffect,
  DeleteImpactKind,
  GroupSubjectKind,
  TriageQueue,
} from "@/lib/knowledge/contract"

export { TRIAGE_QUEUES } from "@/lib/knowledge/contract"
export type {
  AccountKind,
  DeleteImpactEffect,
  DeleteImpactKind,
  LabelWork,
  TriageQueue,
  VenueCapabilities,
} from "@/lib/knowledge/contract"

export const ACCOUNT_KINDS = [
  "staff",
  "staff_with_grant",
  "manager",
  "admin",
] as const

/** One R3 queue as a screen shows it: numbers only when it is available. */
export type TriageRow =
  | { queue: TriageQueue; available: false }
  | {
      queue: TriageQueue
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
] as const satisfies readonly DeleteImpactKind[]

export const IMPACT_EFFECTS = [
  "needs_recheck",
  "withdrawn",
  "none",
  "pending_loses_evidence",
] as const satisfies readonly DeleteImpactEffect[]

/**
 * One R9 item as the dialog words it: only the venue name, question text,
 * effect and whether it is the caller's own.
 */
export type ImpactLine = {
  kind: DeleteImpactKind
  effect: DeleteImpactEffect
  venueName: string
  question: string
  yours: boolean
}

/** R9 read: `unknown` when an item uses a kind or effect this client can't word. */
export type DeleteImpact =
  { status: "known"; items: ImpactLine[] } | { status: "unknown" }

/** W1: which group a listed photo is in (photos the caller may already see). */
export type AssetGroup = { assetId: string; groupId: string }

/** W1: what a set of photos is of; `id` is null for "Just photos". */
export type GroupSubjectRef = {
  kind: GroupSubjectKind
  id: string | null
}

/**
 * A contribution-group call as Add and Review need it (W1). `missing`: the
 * database predates groups, or they are switched off, so photos stay single;
 * `failed` with `retry` when a later try may work (the service was down, or
 * the session needs signing in again).
 */
export type PhotoSetReply<T> =
  | ({ status: "ok" } & T)
  | { status: "missing" }
  | { status: "failed"; retry: boolean }
