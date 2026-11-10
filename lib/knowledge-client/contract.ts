// The knowledge screens' view models. The shared values, finding refs,
// recognition, outcomes, decisions and error codes are the knowledge server's
// (lib/knowledge/contract.ts, the source of truth) and are re-exported here;
// the screen shapes below are what lib/knowledge-client/adapt.ts makes of the
// server's DTOs, so screens read one stable shape.

import type {
  AmenityResult,
  CheckProgress,
  CheckSummary,
  EvidenceItem,
  EvidenceRule,
  Instant,
  PersonRef,
  SubmitAnswer,
  WifiMetadata,
} from "@/lib/amenities/contract"
import type {
  ConfirmationState,
  ContributionKind,
  Decision,
  FindingRef,
  KnowledgeAnswer,
  KnowledgeAsset,
  KnowledgeErrorCode,
  KnowledgeResult,
  ObservedOnSource,
  Recognition,
  SlotReason,
  SubmitOutcome,
  UnknownPreset,
} from "@/lib/knowledge/contract"

export {
  PLACE_KINDS,
  CONTRIBUTION_KINDS as FINDING_KINDS,
  KNOWLEDGE_ANSWERS,
  UNKNOWN_PRESETS,
} from "@/lib/knowledge/contract"
export type {
  ObservedOnSource,
  PlaceKind,
  PlaceRef,
  QuestionFeature,
  SubjectView as Place,
  QuestionView as RegistryQuestion,
  QuestionLifecycle,
  ValueSchemaName,
} from "@/lib/knowledge/contract"
export type {
  ConfirmationState,
  FindingRef,
  KnowledgeAnswer,
  KnowledgeAsset,
  KnowledgeErrorCode,
  KnowledgeFailure,
  KnowledgeResult,
  MyPending,
  Recognition,
  SlotReason,
  UnknownPreset,
} from "@/lib/knowledge/contract"

export type FindingKind = ContributionKind
export type KnowledgeOutcome = SubmitOutcome

/** Stable string key for a finding (React keys, URL fragments). */
export function findingKey(ref: FindingRef): string {
  return `${ref.type}:${ref.id}`
}

export function sameFinding(a: FindingRef, b: FindingRef): boolean {
  return a.type === b.type && a.id === b.id
}

// ---- The venue's answer (resolver, state model §4.5) ------------------------

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
  /** B03: the answer in use is qualified; see `AnswerInUse.qualified`. */
  | "qualified_answer"
  /** A detail from a newer server this build doesn't know: needs checking. */
  | "unrecognised"

/**
 * A current answer stored as Yes whose detail narrows it (b03-design §3.8):
 * a policy allowed with conditions, or something temporarily unavailable.
 * Read from `answerInUse.qualified`; the B01 fields then say needs checking.
 */
export type QualifiedAnswer = {
  qualifier: "conditional" | "temporarily_unavailable"
  /** Temporarily unavailable: the London date it's back, when given. */
  until: string | null
  /** Temporarily unavailable: what's happening, when given (internal). */
  note: string | null
}

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
  /**
   * The real answer behind a `qualified_answer` status (B03); absent or null
   * otherwise, and on servers before B03.
   */
  qualified?: QualifiedAnswer | null
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
  | "archived"
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
  /** A request for more detail, or why it wasn't confirmed. */
  managerNote: string | null
  /** The open request for more detail this finding answers. */
  detailRequestId: string | null
  unknownPreset: UnknownPreset | null
  /** Closed assignments: who answered, and when (never this person's send). */
  answeredBy: string | null
  answeredAt?: Instant | null
  sentAt: Instant | null
  savedAt: Instant | null
  decidedAt: Instant | null
  recognition: Recognition
  /** Drafts only: false once the author can't send it (moved venue). */
  sendable?: boolean
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
  latestAttempt: { preset: UnknownPreset | null; at: Instant } | null
  /** Staff see only the assignee's first name. */
  assignee: { firstName: string | null; isMe: boolean } | null
  mode: WorkingMode
  requiresConfirmation: boolean
  myLatest: FindingSummary | null
  myDraft: { savedAt: Instant } | null
  /** Other people's undecided findings: a count, never names. */
  othersPending: number
  closedAssignment: {
    eventId: number
    answeredBy: string | null
    at: Instant
  } | null
  /**
   * My latest send on this question (B02 R11), on a question read for the
   * capture screen: the base its draft saves send. Absent from an older
   * server, which saves without it.
   */
  mySentAt?: Instant | null
}

export type WorkingList = {
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
  /** Answers in use needing a decision: when the answer was recorded. */
  recordedAt?: Instant | null
  evidence: EvidenceItem[]
  /** Only for the sender, the venue's manager and admins. */
  wifi: WifiMetadata | null
  /** Its answer differs from the answer in use. */
  disputes: boolean
  /** A manager asked for more detail and the reply hasn't come yet. */
  /** The manager asked for more detail; the request's note and id when known. */
  detailRequest: {
    decisionId: string | null
    note: string | null
    at: Instant | null
  } | null
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

/**
 * What the capture screen and form need of a check. The amenity read gives a
 * full CheckSummary; for staff on a working-list question it comes from the
 * knowledge read instead, which anyone at the venue may make (F1).
 */
export type CaptureCheck = Pick<
  CheckSummary,
  | "id"
  | "venueId"
  | "status"
  | "progress"
  | "recheckReason"
  | "revision"
  | "qualification"
> & {
  entry: Pick<
    CheckSummary["entry"],
    "key" | "category" | "question" | "captureBrief" | "evidenceRule"
  >
}

export type QuestionView =
  | { inScope: false }
  | {
      inScope: true
      slot: WorkingSlot
      /** The check as the capture screen shows it (F1). */
      capture: CaptureCheck
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
  /**
   * B03-b: structured detail for the question's schema, and the day the
   * person says they checked with whether it was the form's date or chosen.
   * Sent only by forms for detail schemas; the database checks the shape.
   */
  detail?: Record<string, unknown> | null
  observedOn?: string
  observedOnSource?: ObservedOnSource
}

export type SubmittedFinding = {
  findingRef: FindingRef
  slotRevision: number
  replayed: boolean
  outcome: KnowledgeOutcome
  replacedOwn: { findingRef: FindingRef; sentAt: Instant | null } | null
  recognition: Recognition
  /** This send's time (B02 R11): the next draft base for the same form. */
  sentAt?: Instant
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
  /** B03-b detail forms: the detail as it would be sent, and Checked on. */
  detail?: Record<string, unknown> | null
  checkedOn?: { date: string | null; source: ObservedOnSource | null } | null
}

export type ServerDraft = {
  draftRevision: number
  savedAt: Instant
  payload: DraftPayload
  assetIds: string[]
  idempotencyKey: string
  /** False once the author can't send it (moved venue). */
  sendable?: boolean
}

export type SaveDraftInput = {
  checkId: string
  /** Null for the first save. */
  draftRevision: number | null
  payload: DraftPayload
  assetIds: string[]
  idempotencyKey: string
  /**
   * My latest send the form knows of (B02 R11); null when none. Omitted
   * against an older server, which saves without the already-sent test.
   */
  baseSentAt?: Instant | null
}

// ---- S5 history, S6 to confirm, S14 pending --------------------------------------

export type FindingsPage = {
  items: FindingSummary[]
  nextCursor: string | null
  /** Empty under the history-kept default. */
  hiddenEarlierVenues: { name: string }[]
}

export type ToConfirmRow = {
  checkId: string
  question: string
  kind: PendingKind
  sender: PersonRef | null
  sentAt: Instant | null
  answer: KnowledgeAnswer | null
  /** More than one undecided finding disagrees. */
  conflict: boolean
  /** It disputes the answer in use (readers are told it's being checked). */
  disputes: boolean
  slotRevision: number
  /**
   * When it started waiting, and the list's order (B02 R4): the send time, or
   * the withdrawal or revoke time. Null before the B02 migrations.
   */
  waitingSince?: Instant | null
}

export type ToConfirmList = { items: ToConfirmRow[]; count: number }

// ---- S7-S11 decisions -------------------------------------------------------------

export type DecisionKind = Exclude<Decision, "revoke">

export type DecideInput = {
  findingRef: FindingRef
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

/**
 * Only `unavailable` may be retried with the same request. Every knowledge
 * code is a definite refusal: retrying it can only be refused again.
 */
export function isRetryable(code: KnowledgeErrorCode | (string & {})): boolean {
  return code === "unavailable"
}

/** The legacy submit refused a working-list question (SQLSTATE NLK01). */
/**
 * Which state conflict a knowledge send met. WS1 reports these by message
 * only (lib/server/amenities/errors.ts); a test pins the mapping to WS1's
 * mapper, so a changed message fails there rather than here.
 */
export function stateConflictKind(failure: {
  code: string
  message: string
}): "reused_key" | "archived" | "other" | null {
  if (failure.code !== "state_conflict") return null
  if (failure.message.startsWith("This submission was already used"))
    return "reused_key"
  if (failure.message.startsWith("This check is archived")) return "archived"
  return "other"
}

/**
 * Staff's own attachable media on a working-list question (F1), in the
 * capture form's list shape. Its failures are amenity codes but for the
 * knowledge-only ones, which can't come from this read; they read as a state
 * conflict if they ever do. The form shows only the message.
 */
export function knowledgeAssetsResult(
  result: KnowledgeResult<{ assets: KnowledgeAsset[] }>
): AmenityResult<{ assets: KnowledgeAsset[] }> {
  if (result.ok) return { ok: true, assets: result.assets }
  const { code } = result
  return {
    ...result,
    code:
      code === "already_decided" ||
      code === "self_confirmation_not_permitted" ||
      code === "draft_conflict" ||
      code === "draft_already_sent"
        ? "state_conflict"
        : code,
  }
}

export function isKnowledgePathRequired(failure: { code: string }): boolean {
  return failure.code === "knowledge_path_required"
}
