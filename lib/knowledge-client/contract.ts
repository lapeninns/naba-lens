// The knowledge contract as the staff and manager screens use it: the WS1
// server operations S1-S14 (docs/knowledge/b01-design.md §13), their DTOs,
// inputs, results and error codes. Type-only plus plain constants, so client
// components can import it. Field names follow the server design; adapters in
// `lib/knowledge-client/services.ts` map the server layer onto these types.

import type {
  AmenityErrorCode,
  AmenityFailure,
  CheckProgress,
  EvidenceItem,
  EvidenceRule,
  Instant,
  PersonRef,
  SubmitAnswer,
  WifiMetadata,
} from "@/lib/amenities/contract"

// ---- Values -----------------------------------------------------------------

/** What a finding may record. `unknown` is "Couldn't establish": never the answer. */
export const KNOWLEDGE_ANSWERS = [
  "yes",
  "no",
  "not_applicable",
  "unknown",
] as const
export type KnowledgeAnswer = (typeof KNOWLEDGE_ANSWERS)[number]

export const UNKNOWN_PRESETS = [
  "no_one_sure",
  "could_not_access",
  "needs_access",
  "other",
] as const
export type UnknownPreset = (typeof UNKNOWN_PRESETS)[number]

export const FINDING_KINDS = ["finding", "change_report", "detail"] as const
export type FindingKind = (typeof FINDING_KINDS)[number]

/**
 * A finding: a contribution sent through the knowledge path, or (only for
 * answers recorded before B01) an amenity submission.
 */
export type FindingRef = { type: "contribution" | "submission"; id: string }

/** Stable string key for a finding (React keys, URL fragments). */
export function findingKey(ref: FindingRef): string {
  return `${ref.type}:${ref.id}`
}

export function sameFinding(a: FindingRef, b: FindingRef): boolean {
  return a.type === b.type && a.id === b.id
}

// ---- The venue's answer (resolver, state model §4.5) ------------------------

export type SlotReason =
  "unknown" | "withdrawn" | "disputed" | "stale" | "not_confirmed"

export type SlotDetail =
  | "not_enabled"
  | "answer_withdrawn"
  | "confirmation_revoked"
  | "evidence_withdrawn"
  | "conflict"
  | "recheck_requested"
  | "evidence_lost"
  | "expired"
  | "pending"
  | "declined"
  | "unable_to_establish"
  | "not_checked"

export type ConfirmationState =
  "not_required" | "pending" | "confirmed" | "revoked"

export type AnswerInUse = {
  /** `available` is the only status a reader may present as an answer. */
  status: "available" | "unavailable"
  reason: SlotReason | null
  detail: SlotDetail | null
  /** The selected (recorded) answer, also while disputed or withdrawn; null when none. */
  value: SubmitAnswer | null
  /** When the current answer was saved (never an observation time). */
  savedAt: Instant | null
  /** When its finding was sent, if known. */
  sentAt: Instant | null
  confirmation: {
    state: ConfirmationState
    self: boolean
    at: Instant | null
    /** Managers only; null for staff and when not recorded. */
    by: PersonRef | null
  }
}

export type WorkingMode = "answer" | "add" | "change" | "recheck" | "none"

// ---- Findings and recognition -----------------------------------------------

export type Recognition =
  | { kind: "scored"; period: string }
  | { kind: "not_scored" }
  | { kind: "pending" }
  | { kind: "none" }

export const FINDING_STATES = [
  "saved",
  "submitted",
  "awaiting_confirmation",
  "current",
  "needs_attention",
  "not_confirmed",
  "no_longer_used",
  "assignment_closed",
] as const
export type FindingState = (typeof FINDING_STATES)[number]

/** Why a finding is no longer used. */
export type NoLongerUsedReason =
  | "replaced_by_newer_answer"
  | "reopened"
  | "evidence_deleted"
  | "replaced_by_detail"
  | "replaced_by_own"

export type FindingSummary = {
  /** Null for drafts and closed assignments. */
  findingRef: FindingRef | null
  checkId: string
  question: string
  venue: { id: string; name: string }
  answer: KnowledgeAnswer | null
  kind: FindingKind | "legacy" | "draft" | "assignment"
  state: FindingState
  noLongerUsed: NoLongerUsedReason | null
  /** Reason given by the manager (not confirmed, reopened). */
  stateReason: string | null
  /** A request for more detail. */
  managerNote: string | null
  unknownPreset: UnknownPreset | null
  /** Closed assignments: who answered. */
  answeredBy: string | null
  sentAt: Instant | null
  savedAt: Instant | null
  decidedAt: Instant | null
  recognition: Recognition
}

// ---- S1 working list ----------------------------------------------------------

export type WorkingSlot = {
  checkId: string
  key: string
  question: string
  category: string
  evidenceRule: EvidenceRule
  progress: CheckProgress
  slotRevision: number
  answerInUse: AnswerInUse
  previousAnswer: SubmitAnswer | null
  latestAttempt: { preset: UnknownPreset; at: Instant } | null
  /** Staff see only the assignee's first name. */
  assignee: { firstName: string | null; isMe: boolean } | null
  mode: WorkingMode
  requiresConfirmation: boolean
  myLatest: FindingSummary | null
  myDraft: { savedAt: Instant } | null
  /** Other people's undecided findings: a count, never names. */
  othersPending: number
  closedAssignment: {
    eventId: string
    answeredBy: string | null
    at: Instant
  } | null
}

export type WorkingListView = {
  venue: { id: string; name: string }
  slots: WorkingSlot[]
}

// ---- S2 one question -----------------------------------------------------------

export type PendingKind =
  | FindingKind
  /** A current answer whose key needs confirmation and has none. */
  | "answer_unconfirmed"
  /** A current No or Not applicable whose evidence was deleted. */
  | "evidence_removed"

export type PendingFinding = {
  findingRef: FindingRef
  kind: PendingKind
  answer: KnowledgeAnswer
  finding: string | null
  limitations: string | null
  reason: string | null
  unknownPreset: UnknownPreset | null
  triedText: string | null
  changeReason: string | null
  /** Managers see who sent it; staff only ever get their own. */
  sender: PersonRef | null
  senderIsAssignee: boolean
  mine: boolean
  sentAt: Instant
  evidence: EvidenceItem[]
  /** Only for the sender, the venue's manager and admins. */
  wifi: WifiMetadata | null
  /** Its answer differs from the answer in use. */
  disputes: boolean
  /** A manager asked for more detail and the reply hasn't come yet. */
  detailRequest: { decisionId: string; note: string; at: Instant } | null
  /** Evidence removed: photos deleted from the answer in use. */
  removedEvidence: number
}

export type KnowledgePermissions = {
  canContribute: boolean
  canReportChange: boolean
  canConfirm: boolean
  canSelfConfirm: boolean
  canRequestDetail: boolean
  canDecline: boolean
}

export type KnowledgeEventLine = {
  id: string
  at: Instant
  text: string
}

export type KnowledgeCheckView =
  | { inScope: false }
  | {
      inScope: true
      slot: WorkingSlot
      venue: { id: string; name: string }
      pending: PendingFinding[]
      permissions: KnowledgePermissions
      history: KnowledgeEventLine[]
    }

// ---- S3 submit ------------------------------------------------------------------

export type SubmitKnowledgeInput = {
  checkId: string
  slotRevision: number
  idempotencyKey: string
  kind: FindingKind
  answer: KnowledgeAnswer
  finding?: string
  limitations?: string
  /** Required for No and Not applicable. */
  reason?: string
  /** Required for `unknown`. */
  unknownPreset?: UnknownPreset
  triedText?: string
  /** Required for change reports. */
  changeReason?: string
  /** Decision id of a request for more detail (kind `detail`). */
  respondsTo?: string
  assetIds: string[]
  wifi?: WifiMetadata
  redactionConfirmed?: boolean
  /** Managers on a confirmation-required key: confirm it themselves now. */
  confirmOwn?: boolean
}

export type KnowledgeOutcome = "current" | "awaiting_confirmation" | "recorded"

export type SubmitKnowledgeResult = {
  findingRef: FindingRef
  slotRevision: number
  replayed: boolean
  outcome: KnowledgeOutcome
  replacedOwn: { findingRef: FindingRef; sentAt: Instant } | null
  recognition: Recognition
}

// ---- S4 drafts --------------------------------------------------------------------

/** What a server draft holds; every field optional, nothing validated. */
export type DraftPayload = {
  answer: KnowledgeAnswer | null
  finding: string
  limitations: string
  reason: string
  unknownPreset: UnknownPreset | null
  triedText: string
  changeReason: string
  wifi: {
    testSpot: string
    testedOn: string
    downloadMbps: string
    uploadMbps: string
  }
  /** Set once a send was attempted: replays resend the same revision. */
  sentSlotRevision: number | null
}

export type ServerDraft = {
  draftRevision: number
  savedAt: Instant
  payload: DraftPayload
  assetIds: string[]
  idempotencyKey: string
}

export type SaveDraftInput = {
  checkId: string
  /** Null for the first save. */
  draftRevision: number | null
  payload: DraftPayload
  assetIds: string[]
  idempotencyKey: string
}

// ---- S5 history, S6 to confirm, S14 pending --------------------------------------

export type MyFindingsPage = {
  items: FindingSummary[]
  nextCursor: string | null
  /** Empty under the history-kept default. */
  hiddenEarlierVenues: { name: string }[]
}

export type ToConfirmItem = {
  checkId: string
  question: string
  kind: PendingKind
  sender: PersonRef | null
  sentAt: Instant
  answer: KnowledgeAnswer
  /** More than one undecided finding disagrees. */
  conflict: boolean
  /** It disputes the answer in use (readers are told it's being checked). */
  disputes: boolean
  slotRevision: number
}

export type ToConfirmView = { items: ToConfirmItem[]; count: number }

export type MyPending = {
  awaitingConfirmation: number
  unknownRecorded: number
}

// ---- S7-S11 decisions -------------------------------------------------------------

export type DecisionKind =
  "confirm" | "reaffirm" | "request_detail" | "decline" | "seen"

export type DecideInput = {
  target: FindingRef
  decision: DecisionKind
  slotRevision: number
  idempotencyKey: string
  /** Required for request_detail and decline. */
  note?: string
}

export type ResolveConflictInput = {
  checkId: string
  slotRevision: number
  idempotencyKey: string
  choose: FindingRef | "keep_in_use"
  reason: string
}

export type DecisionResult = {
  slotRevision: number
  replayed: boolean
  replacedAnswer: SubmitAnswer | null
}

// ---- Errors -----------------------------------------------------------------------

export const KNOWLEDGE_ONLY_ERRORS = [
  "knowledge_path_required",
  "knowledge_slot_out_of_scope",
  "already_decided",
  "self_confirmation_not_permitted",
  "draft_conflict",
] as const
export type KnowledgeOnlyErrorCode = (typeof KNOWLEDGE_ONLY_ERRORS)[number]
export type KnowledgeErrorCode = AmenityErrorCode | KnowledgeOnlyErrorCode

export type KnowledgeFailure = Omit<AmenityFailure, "code"> & {
  code: KnowledgeErrorCode
}

export type KnowledgeResult<T> = ({ ok: true } & T) | KnowledgeFailure

/**
 * Only `unavailable` may be retried with the same request. Every knowledge
 * code is a definite refusal: retrying it can only be refused again.
 */
export function isRetryable(code: KnowledgeErrorCode | (string & {})): boolean {
  return code === "unavailable"
}

/** The legacy submit refused a working-list question (SQLSTATE NLK01). */
export function isKnowledgePathRequired(failure: { code: string }): boolean {
  return failure.code === "knowledge_path_required"
}
