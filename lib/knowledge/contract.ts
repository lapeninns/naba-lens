// Knowledge contract (docs/knowledge/b01-design.md §4.1, §5, §13): the values,
// view DTOs, error codes and RPC signatures shared by lib/server/knowledge and
// the screens. Database names are WS1's; the server builds nothing the
// database did not return.

import type {
  AmenityFailure,
  CheckProgress,
  CheckStatus,
  EvidenceRule,
  SubmitAnswer,
  WifiMetadata,
} from "@/lib/amenities/contract"

export const KNOWLEDGE_ANSWERS = [
  "yes",
  "no",
  "not_applicable",
  "unknown",
] as const
export type KnowledgeAnswer = (typeof KNOWLEDGE_ANSWERS)[number]

export const CONTRIBUTION_KINDS = [
  "finding",
  "change_report",
  "detail",
] as const
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number]

/** Couldn't establish: why not (WS2 §3.4). "other" needs the tried text only. */
export const UNKNOWN_PRESETS = [
  "no_one_sure",
  "could_not_access",
  "needs_access",
  "other",
] as const
export type UnknownPreset = (typeof UNKNOWN_PRESETS)[number]

export const DECISIONS = [
  "confirm",
  "reaffirm",
  "request_detail",
  "decline",
  "seen",
  "revoke",
] as const
export type Decision = (typeof DECISIONS)[number]

export const SUBMIT_OUTCOMES = [
  "current",
  "awaiting_confirmation",
  "recorded",
] as const
export type SubmitOutcome = (typeof SUBMIT_OUTCOMES)[number]

/** B01-era findings are contributions; only pre-B01 answers are submissions. */
export type FindingRef = { type: "contribution" | "submission"; id: string }

export const KNOWLEDGE_LIMITS = {
  finding: 2000,
  limitations: 2000,
  reason: 500,
  triedText: 500,
  changeReason: 500,
  note: 500,
  maxAssets: 10,
  maxReaderKeys: 50,
  maxPageSize: 20,
  /** Bytes of the draft payload as JSON text. */
  draftPayload: 16384,
} as const

// ---- Resolver state (§5.2) ---------------------------------------------------

export type SlotStatus = "available" | "unavailable"
/** WS5's reason vocabulary, in precedence order. */
export type SlotReason =
  | "not_enabled"
  | "withdrawn"
  | "disputed"
  | "stale"
  | "not_confirmed"
  | "unknown"
export type ConfirmationState =
  "not_required" | "pending" | "confirmed" | "revoked"
export type EvidenceState = "complete" | "withdrawn" | "none_attached"
export type ContributionSource = "contribution" | "submission"

/** One row of `knowledge_reader_answers_v1` (§5.3; service role only). */
export type KnowledgeReaderRow = {
  question_key: string
  status: SlotStatus
  reason: SlotReason | null
  detail: string | null
  revision: number
  question_version: number
  value: SubmitAnswer | null
  finding: string | null
  limitations: string | null
  reason_text: string | null
  source_basis: "staff" | "venue_manager" | "admin" | null
  current_contribution_id: string | null
  current_submission_id: string | null
  contribution_kind: ContributionSource | null
  confirmation_required: boolean
  confirmation_state: ConfirmationState | null
  confirmation_basis: "venue_manager" | "admin" | "self" | "rule" | null
  confirmation_self: boolean | null
  confirmation_saved_at: string | null
  evidence_photos: number | null
  evidence_videos: number | null
  redaction_proof: "recorded" | "not_recorded" | "not_applicable" | null
  saved_at: string | null
  observed_at: string | null
  next_check_due: string | null
  freshness_state: string | null
}

// ---- Screen DTOs (§13) -------------------------------------------------------

export type Recognition =
  | { kind: "scored"; period: string }
  | { kind: "not_scored" }
  | { kind: "pending" }
  | { kind: "none" }

export type ContributionState =
  | "current"
  | "no_longer_used"
  | "not_confirmed"
  | "submitted"
  | "needs_attention"
  | "awaiting_confirmation"

/** One of the caller's own findings (S5 history, `myLatest`). */
export type MyFindingView = {
  findingRef: FindingRef
  checkId: string
  venueId: string
  venueName: string
  questionKey: string
  question: string
  kind: ContributionKind
  answer: KnowledgeAnswer
  unknownPreset?: UnknownPreset | null
  sentAt: string
  decidedAt?: string | null
  state: ContributionState
  stateReason?:
    "archived" | "replaced_by_newer" | "reopened" | "replaced_by_own" | null
  managerNote?: string | null
  detailRequestId?: string | null
  recognition: Recognition
}

export type ClosedAssignmentView = {
  kind: "assignment_closed"
  state: "assignment_closed"
  checkId: string
  venueId: string
  questionKey: string
  question: string
  answeredBy: string | null
  sentAt: string
}

export type SlotMode = "none" | "answer" | "change" | "add" | "recheck"

export type KnowledgeSlotView = {
  checkId: string
  venueId: string
  questionKey: string
  question: string
  category: string
  evidenceRule: EvidenceRule
  captureBrief: string | null
  inScope: boolean
  slotRevision: number
  status: SlotStatus
  reason: SlotReason | null
  detail: string | null
  progress: CheckProgress
  checkStatus: CheckStatus
  answerInUse: {
    value: SubmitAnswer
    available: boolean
    reason: SlotReason | null
    savedAt: string | null
    sentAt: string | null
    /** Always null in B01: there is no observation time yet. */
    lastCheckedAt: null
    confirmed: boolean
    confirmationState: ConfirmationState | null
    evidenceState: EvidenceState | null
    /** Managers and admins only (absent for staff); null until confirmed. */
    confirmedByFirstName?: string | null
    confirmedAt?: string | null
    /** The confirmer was also the person who sent the finding. */
    confirmedSelf?: boolean | null
  } | null
  previousAnswer: SubmitAnswer | null
  requiresConfirmation: boolean
  latestAttempt: {
    outcome: "unknown"
    preset: UnknownPreset | null
    at: string
  } | null
  /** `id` for managers and admins only; staff see the first name (D3). */
  assignee: { id?: string; firstName: string; isMe: boolean } | null
  mode: SlotMode
  othersPending: number
  myLatest: MyFindingView | null
  myDraft: { savedAt: string; draftRevision: number } | null
  closedAssignment: {
    eventId: number
    answeredBy: string | null
    at: string
  } | null
}

export type PendingFindingView = {
  findingRef: FindingRef
  kind: ContributionKind
  answer: KnowledgeAnswer
  finding: string | null
  limitations: string | null
  reason: string | null
  unknownPreset: UnknownPreset | null
  triedText: string | null
  changeReason: string | null
  sentAt: string
  senderId: string
  senderName: string
  senderAssigned: boolean
  isMine: boolean
  detailRequested: boolean
  /** The latest request for more detail; managers and admins only (else null). */
  detailRequest: {
    decisionId: string
    note: string | null
    requestedAt: string
  } | null
  wifi: WifiMetadata | null
  evidence: { assetId: string; kind: "photo" | "video"; available: boolean }[]
}

export type KnowledgeCheckView = KnowledgeSlotView & {
  permissions: {
    canContribute: boolean
    canReportChange: boolean
    canConfirm: boolean
    canSelfConfirm: boolean
    canRequestDetail: boolean
    canDecline: boolean
  }
  pending: PendingFindingView[]
}

export type WorkingListView = {
  venue: { id: string; name: string } | null
  items: KnowledgeSlotView[]
}

export type ToConfirmItem = {
  checkId: string
  questionKey: string
  question: string
  findingRef: FindingRef
  kind: ContributionKind | "answer_awaiting_confirmation" | "evidence_withdrawn"
  answer: KnowledgeAnswer | null
  senderName: string | null
  sentAt: string | null
  slotRevision: number
  conflict: boolean
  /** This finding disputes the answer in use (the resolver's dispute test). */
  disputes: boolean
}

export type DraftView = {
  checkId: string
  venueId: string
  draftRevision: number
  payload: Record<string, unknown>
  assetIds: string[]
  idempotencyKey: string
  savedAt: string
  /** False once the author can no longer contribute at the draft's venue. */
  sendable: boolean
}

export type MyFindingsPage = {
  items: (MyFindingView | ClosedAssignmentView)[]
  /** Opaque; pass it back as `cursor` for the next page. */
  nextCursor: string | null
  drafts: {
    checkId: string
    venueId: string
    venueName: string
    questionKey: string
    question: string
    savedAt: string
    sendable: boolean
  }[]
  /** Always empty while history is kept across venues. */
  hiddenEarlierVenues: never[]
}

export type MyPending = {
  awaitingConfirmation: number
  unknownRecorded: number
}

export type PilotPreviewRow = {
  questionKey: string
  checkId: string | null
  checkStatus: CheckStatus | null
  progress: CheckProgress | null
  inScope: boolean
  status: SlotStatus
  reason: SlotReason | null
  detail: string | null
  revision: number
  submissions: number
  wifiWithoutRedactionProof: number | null
  relatedLegacyFacts: number
}

// ---- Command results -----------------------------------------------------------

export type SubmitKnowledgeResult = {
  findingRef: FindingRef
  submissionId: string | null
  outcome: SubmitOutcome
  replacedOwn: string | null
  /** When the replaced own finding was sent (it was never the answer in use). */
  replacedOwnSentAt: string | null
  slotRevision: number
  replayed: boolean
  recognition: Recognition
}

export type DecideResult = {
  decisionId: string
  submissionId: string | null
  replacedAnswer: SubmitAnswer | null
  slotRevision: number
  replayed: boolean
}

export type ResolveConflictResult = {
  submissionId: string | null
  settled: number
  slotRevision: number
  replayed: boolean
}

// ---- Errors (§4.1) -------------------------------------------------------------

/**
 * Knowledge failures: the amenity codes (which include
 * `knowledge_path_required` and `knowledge_slot_out_of_scope`) plus the
 * knowledge-only ones. None is retryable; only `unavailable` is.
 */
export type KnowledgeErrorCode =
  | AmenityFailure["code"]
  | "already_decided"
  | "self_confirmation_not_permitted"
  | "draft_conflict"

export type KnowledgeFailure = Omit<AmenityFailure, "code"> & {
  code: KnowledgeErrorCode
  /** draft_conflict: the draft revision now stored (null: none). */
  draftRevision?: number | null
}

export type KnowledgeResult<T> = ({ ok: true } & T) | KnowledgeFailure

/** SQLSTATEs in the NabaLens knowledge class; unlisted NL codes are state_conflict. */
export const KNOWLEDGE_SQLSTATES = {
  NLK01: "knowledge_path_required",
  NLK02: "knowledge_slot_out_of_scope",
  NLK03: "already_decided",
  NLK04: "self_confirmation_not_permitted",
  NLK05: "draft_conflict",
  NLK06: "knowledge_venue_not_found",
  NLK07: "knowledge_not_adoptable",
  NLK08: "knowledge_not_current",
} as const

// ---- RPC signatures ------------------------------------------------------------

type SubmitArgs = {
  p_check_id: string
  p_slot_revision: number
  p_idempotency_key: string
  p_kind: ContributionKind
  p_answer: KnowledgeAnswer
  p_finding: string | null
  p_limitations: string | null
  p_reason: string | null
  p_unknown_preset: UnknownPreset | null
  p_tried_text: string | null
  p_change_reason: string | null
  p_responds_to: string | null
  p_asset_ids: string[]
  p_internal_metadata: WifiMetadata | null
  p_redaction_confirmed: boolean | null
  p_confirm_own: boolean
}

export type KnowledgeRpcs = {
  knowledge_working_list: {
    args: Record<string, never>
    returns: WorkingListView
  }
  knowledge_check: { args: { p_check_id: string }; returns: KnowledgeCheckView }
  knowledge_to_confirm: {
    args: { p_venue_id: string | null }
    returns: { count: number; items: ToConfirmItem[] }
  }
  knowledge_my_contributions: {
    args: { p_cursor: string | null; p_limit: number }
    returns: MyFindingsPage
  }
  knowledge_my_pending: {
    args: { p_period: string | null }
    returns: MyPending | null
  }
  knowledge_get_draft: {
    args: { p_check_id: string }
    returns: DraftView | null
  }
  knowledge_pilot_preview: {
    args: { p_venue_id: string }
    returns: PilotPreviewRow[]
  }
  knowledge_reader_answers_v1: {
    args: { p_venue_id: string; p_keys: string[] }
    returns: KnowledgeReaderRow[]
  }
  knowledge_submit: {
    args: SubmitArgs
    returns: Omit<SubmitKnowledgeResult, "findingRef"> & {
      contributionId: string
    }
  }
  knowledge_decide: {
    args: {
      p_target_type: FindingRef["type"]
      p_target_id: string
      p_decision: Decision
      p_slot_revision: number
      p_idempotency_key: string
      p_note: string | null
    }
    returns: DecideResult
  }
  knowledge_resolve_conflict: {
    args: {
      p_check_id: string
      p_slot_revision: number
      p_idempotency_key: string
      /** A contribution id, or null to keep the answer in use. */
      p_choose: string | null
      p_reason: string
    }
    returns: ResolveConflictResult
  }
  knowledge_set_working_list: {
    args: {
      p_venue_id: string
      p_keys: string[]
      p_enabled: boolean
      p_reason: string | null
    }
    returns: number
  }
  knowledge_save_draft: {
    args: {
      p_check_id: string
      p_draft_revision: number | null
      p_payload: Record<string, unknown>
      p_asset_ids: string[]
      p_idempotency_key: string
    }
    returns: { draftRevision: number; savedAt: string }
  }
  knowledge_discard_draft: { args: { p_check_id: string }; returns: boolean }
  knowledge_dismiss_outcome: { args: { p_event_id: number }; returns: boolean }
}
export type KnowledgeRpcName = keyof KnowledgeRpcs
