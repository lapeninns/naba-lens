// Knowledge contract (docs/knowledge/b01-design.md §4.1, §5, §13): the values,
// view DTOs, error codes and RPC signatures shared by lib/server/knowledge and
// the screens. Database names are WS1's; the server builds nothing the
// database did not return.

import type {
  AmenityFailure,
  CheckProgress,
  CheckStatus,
  EvidenceRule,
  ReopenPreset,
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
/**
 * B03-g: a "correction" contribution is recorded by knowledge_correct only and
 * is adopted at once, so it is never pending; the corrector's own history and
 * feed can show it. Screens widen their kind maps with this when they adopt
 * B03-g (kept separate so existing exhaustive maps still compile).
 */
export type ContributionKindB03 = ContributionKind | "correction"

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
  /** Bytes of a finding's structured detail as JSON text (B03-b). */
  detail: 16384,
  /** An observation date is today or up to this many days back (OD-15 default). */
  observedOnDays: 30,
  placeLabel: 80,
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
    /**
     * B03-b: the answer's structured detail (null when none was recorded),
     * whether a detail row exists, and the observation date. Always returned
     * once the B03-b migration is applied.
     */
    detail?: KnowledgeDetail | null
    detailRecorded?: boolean
    observedOn?: string | null
    /**
     * B03-c (§3.8): a qualified answer's real value. When set, the B01 fields
     * read as needs checking unless another reason applies (A22).
     */
    qualified?: QualifiedAnswer | null
    /** B03-c (A5): policy keys only; empty means complete. */
    policyMissing?: PolicyMissing[]
    /** B03-d (A25): the schedule version in use, for a schedule exception. */
    scheduleId?: string | null
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
  /** A10: one entry per use; `unrated` until B03-e. Returned from B03-b. */
  freshness?: FreshnessEntry[]
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
  /** B03-b: structured detail and observation date, null when none. */
  detail?: KnowledgeDetail | null
  observedOn?: string | null
  /** B03-c (A5): policy findings only, as if adopted (content, not who confirms). */
  policyMissing?: PolicyMissing[]
  /** B03-f (A12): where the finding came from. */
  source?: FindingSource
  /** B03-f: imports only, the source's label. */
  sourceLabel?: string
  /** B03-f (A23): imports only; false while the check has an answer in use. */
  adoptable?: boolean
}

export type FindingSource =
  "staff_finding" | "manager_statement" | "legacy_fact" | "external_source"

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
  /**
   * The caller's own latest send on this question (B02 R11): the draft base.
   * Always returned once the B02 migration is applied.
   */
  mySentAt?: string | null
  /** B03-d (A6): the venue's IANA timezone for schedules (OD-16 default). */
  timezone?: string
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
  /**
   * When it started waiting, the order of the list: the send time, or the
   * withdrawal or revoke time for evidence_withdrawn and revoked rows (B02 R4).
   * Always returned once the B02 migration is applied.
   */
  waitingSince?: string
  /** B03-c (A5): policy items only. */
  policyMissing?: PolicyMissing[]
  /** B03-f (A12, A23): the source; imports also carry their label and adoptable. */
  source?: FindingSource
  sourceLabel?: string
  adoptable?: boolean
}

/**
 * A photo or video the caller may attach to a finding on a working-list
 * question: their own ready upload at the question's venue (the rule
 * knowledge_submit applies to staff). Shaped like the amenity
 * `SubmittableAsset`, so the capture form takes either; `thumbUrl` is the
 * own-media route, which serves an uploader's own assets of any purpose.
 */
export type KnowledgeAsset = {
  assetId: string
  kind: "photo" | "video"
  createdAt: string
  source: "own"
  thumbUrl: string | null
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

// ---- B02 reads (docs/knowledge/b02-design.md §3, §3a) --------------------------

/** R1. The caller's own label work. Only active staff label their uploads today. */
export type LabelWork = { needsLabels: number; needsAttention: number }

export const TRIAGE_QUEUES = ["menu_photos", "findings", "checklist"] as const
export type TriageQueue = (typeof TRIAGE_QUEUES)[number]
/** B03-e (§7.4): open recheck tasks, returned beside the B02 queues. */
export type TriageRow = TriageQueue | "rechecks" | "suggestions"

/**
 * R3. One manager queue. A queue the caller can't act on is `available: false`
 * with null numbers. Queues are shown side by side and never summed.
 */
export type TriageQueueSummary = {
  queue: TriageQueue
  available: boolean
  waiting: number | null
  oldestWaitingAt: string | null
  /** Menu photos only: the caller's own photos waiting for another reviewer. */
  ownWaiting: number | null
}

type FeedKeys = {
  /** Opaque, unique across types; the cursor's tie-break. */
  key: string
  /** Creation (send) time: the order, which never changes. */
  at: string
}

export type FeedMenuDecision =
  | {
      photoId: string
      itemId: string
      itemName: string
      variantName: string | null
      state: "accepted" | "better_photo_requested" | "needs_recheck"
      reason: string | null
      decidedAt: string
    }
  | {
      /** A labelled item and variant of the photo with no decision yet. */
      photoId: null
      itemId: string
      itemName: string
      variantName: string | null
      state: "waiting"
      reason: null
      decidedAt: null
    }

/** R5 `photo`: one of the caller's own general-purpose uploads. */
export type FeedPhotoItem = FeedKeys & {
  type: "photo"
  assetId: string
  venueId: string
  venueName: string
  mediaType: "image" | "video"
  uploadState: "uploading" | "processing" | "ready" | "failed"
  /**
   * The role recorded at upload (null before B02-c). A manager account's feed
   * lists only its "manager" uploads. Always returned once the
   * 20261110095909 migration is applied.
   */
  uploaderRole?: "staff" | "manager" | "admin" | null
  sentAt: string
  labels: { hasLabels: boolean; needsLabels: boolean; needsAttention: boolean }
  /**
   * Live decisions, then labelled items still waiting for a first decision
   * (`state: "waiting"`). Withdrawn and invalidated decisions are history.
   */
  menuDecisions: FeedMenuDecision[]
  /** R7: a live accepted menu decision. The only use claim in B02. */
  menuUseAccepted: boolean
  /** W1: the photo's contribution group; left out if it could not be read. */
  groupId?: string | null
}

/** R5 `task_send`: one of the caller's own task photo sends. */
export type FeedTaskSendItem = FeedKeys & {
  type: "task_send"
  itemId: string
  submissionId: string
  requirementId: string | null
  requirementTitle: string | null
  venueId: string
  venueName: string
  assetId: string
  assetAvailable: boolean
  state: "submitted" | "accepted" | "needs_another_photo"
  reason: string | null
  decidedAt: string | null
  archived: boolean
  sentAt: string
  replacesItemId: string | null
  replacesSentAt: string | null
  /** R6: position in the replacement chain, 1 for an original. */
  revision: number
}

export type FeedFindingItem = FeedKeys & MyFindingView & { type: "finding" }
export type FeedClosedAssignmentItem = FeedKeys &
  ClosedAssignmentView & { type: "assignment_closed" }

export type ContributionsFeedItem =
  FeedPhotoItem | FeedTaskSendItem | FeedFindingItem | FeedClosedAssignmentItem

export type ContributionsFeedPage = {
  items: ContributionsFeedItem[]
  /** Opaque; pass it back as `cursor` for the next page. */
  nextCursor: string | null
}

export type AccountKind = "manager" | "staff" | "staff_with_grant" | "admin"

/**
 * R8. What the caller may do at the venue, computed from the write gates'
 * own predicates. It hides choices; it never grants one.
 */
export type VenueCapabilities = {
  accountKind: AccountKind
  /** Grant venue (manager, staff with grant), own venue (staff), the named venue (admin). */
  venueId: string | null
  canUpload: boolean
  canLabel: boolean
  canSendFindings: boolean
  canConfirmFindings: boolean
  /** Per working-list question key. */
  canSelfConfirm: Record<string, boolean>
  canReviewMenuPhotos: boolean
  canDecideOwnMenuPhoto: boolean
  canReviewChecklist: boolean
  canBeAssigned: boolean
  /** B03-b (A1): manager or admin at the venue. */
  canManagePlaces?: boolean
  /** B03-g (A1, §9.1): a manager account or an admin, never staff with a grant. */
  canCorrect?: boolean
  canWithdraw?: boolean
  /** B03-g (A16): manager or admin at the venue. */
  canReadHistory?: boolean
}

export type DeleteImpactKind =
  "answer_in_use" | "pending_finding" | "earlier_answer"
export type DeleteImpactEffect =
  "withdrawn" | "needs_recheck" | "none" | "pending_loses_evidence"

/**
 * R9. One answer or finding a photo's deletion would affect. Never names a
 * person or carries an answer value, finding text or note.
 */
export type DeleteImpactItem = {
  kind: DeleteImpactKind
  effect: DeleteImpactEffect
  venueId: string
  venueName: string
  checkId: string
  questionKey: string
  question: string
  /** The answer or finding is the caller's own. */
  yours: boolean
  /** The caller's own pending finding only. */
  findingRef?: FindingRef
}

export type AssetDeleteImpact = { assetId: string; impacts: DeleteImpactItem[] }

/** R11. Why a draft save was refused as already sent. */
export type DraftSentReason = "key_sent" | "newer_send"
// ---- B02-b contribution groups (docs/knowledge/b02-design.md W1) -------------

export const GROUP_SUBJECT_KINDS = [
  "menu_item",
  "task",
  "question",
  "none",
] as const
export type GroupSubjectKind = (typeof GROUP_SUBJECT_KINDS)[number]

/** OD-7 default (owner to confirm): one group per asset, at most 10 members. */
export const GROUP_LIMITS = { maxMembers: 10, maxLookup: 100 } as const

/**
 * One group with the members the viewer may already see, each with its own
 * state. A group adds no state, visibility or credit.
 */
export type ContributionGroupView = {
  groupId: string
  venueId: string
  createdAt: string
  /** The viewer started it. */
  mine: boolean
  subject: {
    kind: GroupSubjectKind
    /** Menu item, task (coverage requirement) or check id; null for "none". */
    id: string | null
    name: string | null
  }
  members: {
    assetId: string
    position: number
    mediaType: "image" | "video"
    uploadState: "uploading" | "processing" | "ready" | "failed"
    mine: boolean
  }[]
}
// ---- B03-a question registry (docs/knowledge/b03-design.md §3) --------------

export const QUESTION_LIFECYCLES = [
  "supported",
  "presence_only",
  "unsupported",
  "superseded",
  "retired",
] as const
export type QuestionLifecycle = (typeof QUESTION_LIFECYCLES)[number]

export type QuestionFamily =
  | "presence"
  | "facility"
  | "accessibility"
  | "policy"
  | "service"
  | "schedule_event"
  | "connectivity"

export type ValueSchemaName =
  | "presence"
  | "facility"
  | "accessibility"
  | "policy"
  | "service"
  | "schedule_event"
  | "connectivity.wifi"

/** One version of a question: what it asks and the rules it is answered under. */
export type QuestionView = {
  key: string
  family: QuestionFamily
  subjectType: "venue"
  ownerRole: "venue_manager" | "admin"
  version: number
  latestVersion: number
  catalogueVersion: number
  /** The knowledge_question_rules version it restates; null when none exists. */
  ruleVersion: number | null
  valueSchema: { name: ValueSchemaName; version: number }
  guidance: {
    question: string
    captureBrief: string
    staffHelp: string | null
    publicLabel: string | null
  }
  evidenceRule: "photo" | "video" | "either" | "both" | "none"
  confirmation: "none" | "venue_manager" | "admin" | "policy_authority"
  selfConfirmationAllowed: boolean
  sensitivity: "ordinary" | "sensitive_claim" | "restricted_detail"
  freshness: { internal: string | null; public: string | null }
  publishableFields: string[]
  /**
   * K3 (A30): whether an answer may be illustrated publicly. Every version 1
   * is "never". Returned from B03-c.
   */
  publicMedia?: "never" | "with_grant"
  /** A33: the accessibility features this version asks about (empty on v1). */
  features?: QuestionFeature[]
  /** Fields whose change invalidates a confirmation; the headline always does. */
  materialFields: string[]
  requiresZones: boolean
  lifecycle: QuestionLifecycle
  supersededBy: string[] | null
  effectiveFrom: string | null
  changeKind: "initial" | "wording" | "rule" | "schema" | "lifecycle"
  changeNote: string | null
}

// ---- Places and structured detail (B03-b, b03-design §4) ----------------------

export const PLACE_KINDS = [
  "entrance",
  "route",
  "area",
  "room",
  "facility_point",
] as const
export type PlaceKind = (typeof PLACE_KINDS)[number]

/**
 * A place at a venue. Staff get active places only, without the who and
 * when; managers and admins also get retired places, `addedBy` (a first
 * name for managers, the full name for admins) and the dates.
 */
export type SubjectView = {
  subjectId: string
  kind: PlaceKind
  label: string
  active: boolean
  addedOn?: string
  addedBy?: string
  retiredOn?: string | null
}

/** A place a finding names: a known place, or a label as written (A3). */
export type PlaceRef = { subjectId: string } | { label: string }

/**
 * Structured detail as the database stored it (facility and accessibility
 * shapes, b03-design §4.2, §4.3). Read-only to the server.
 */
export type KnowledgeDetail = Record<string, unknown>

export const OBSERVED_ON_SOURCES = ["form_default", "chosen"] as const
export type ObservedOnSource = (typeof OBSERVED_ON_SOURCES)[number]

/** B03-c (§3.8): a Yes narrowed by its detail. */
export type QualifiedAnswer = {
  qualifier: "conditional" | "temporarily_unavailable"
  detail: KnowledgeDetail
}

/** B03-c (A5): what a policy answer still needs, in this order. */
export type PolicyMissing =
  "stance" | "conditions" | "zones" | "authority" | "stated_on"

export const VALUE_LISTS = [
  "policy_condition_types",
  "policy_exception_types",
  "broadcasters",
] as const
export type ValueListName = (typeof VALUE_LISTS)[number]

/** A4, A9: one closed list, active items in the owner's order. */
export type ValueListView = {
  list: ValueListName
  items: {
    code: string
    label: string
    needsValue: boolean
    valueKind: "number" | "text" | "time" | null
  }[]
}

/** A33: an accessibility feature a question version asks about. */
export type QuestionFeature = {
  key: string
  label: string
  measurable: boolean
}

/** B03-d (§6.1): one occurrence of a schedule; instants are UTC. */
export type OccurrenceRow = {
  local_date: string
  starts_at: string
  ends_at: string
  state: "scheduled" | "cancelled" | "changed" | "extra"
}

export const SCHEDULE_EXCEPTION_KINDS = [
  "cancelled",
  "changed_window",
  "extra",
] as const
export type ScheduleExceptionKind = (typeof SCHEDULE_EXCEPTION_KINDS)[number]

export type FreshnessEntry = {
  use: "internal" | "public"
  state: "current" | "due_soon" | "expired" | "basis_missing" | "unrated"
  nextCheckDue: string | null
  basis: "observed_on" | "stated_on" | "event_end" | null
  basisDate: string | null
}

/** A refused value: the field path (b03-design §14.3) and a short problem code. */
export type ValueFieldProblem = {
  path: string
  problem:
    | "required"
    | "not_allowed"
    | "invalid"
    | "too_long"
    | "out_of_range"
    | "no_entrances_listed"
    | "unknown_subject"
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
  /**
   * The finding's send time (B02 R11): the next draft base for this form.
   * Always returned once the B02 migration is applied.
   */
  sentAt?: string
  /** B03-b, when detail or an observation date was sent. */
  detail?: KnowledgeDetail | null
  observedOn?: string | null
  /** A24: the recheck tasks this send closed (none on a replay). */
  rechecksClosed?: RecheckClosed[]
}

export type DecideResult = {
  decisionId: string
  submissionId: string | null
  replacedAnswer: SubmitAnswer | null
  slotRevision: number
  replayed: boolean
  /** B03-e (A24): the recheck tasks this decision closed. */
  rechecksClosed?: RecheckClosed[]
}

export type ResolveConflictResult = {
  submissionId: string | null
  settled: number
  slotRevision: number
  replayed: boolean
  /** B03-e (A24): the recheck tasks this decision closed. */
  rechecksClosed?: RecheckClosed[]
}

export type RecheckClosed = { taskId: string; use: "internal" | "public" }

export type RecheckCause =
  | "due_soon"
  | "expired"
  | "basis_missing"
  | "schedule_ended"
  | "temporary_until_passed"
  | "evidence_lost"
  | "schema_changed"
  | "scope_changed"

/** B03-e (A11): an open recheck task; its assignee is the check's. */
export type RecheckTaskView = {
  taskId: string
  checkId: string
  venueId: string
  questionKey: string
  question: string
  cause: RecheckCause
  use: "internal" | "public"
  dueAt: string
}

// ---- Corrections and history (B03-g, b03-design §9, A15, A16) -------------------

/**
 * B03-g (A15): stateReason also reads "corrected" or "withdrawn" when a
 * material correction or a withdrawal took the author's answer out of use
 * (managerNote carries the reason). Screens widen their stateReason maps with
 * this when they adopt B03-g.
 */
export type StateReasonB03 =
  NonNullable<MyFindingView["stateReason"]> | "corrected" | "withdrawn"

export type CorrectionValue = {
  headline: SubmitAnswer
  detail: KnowledgeDetail | null
}

export type CorrectResult = {
  decisionId: string
  /** False: a detail fix on the answer in use; no new submission. */
  material: boolean
  submissionId: string | null
  slotRevision: number
  replayed: boolean
  rechecksClosed?: RecheckClosed[]
}

export type SlotHistoryView = {
  checkId: string
  at: string
  answerInUse: {
    submissionId: string
    answer: SubmitAnswer
    sentAt: string
    confirmationState: ConfirmationState
    withdrawn: boolean
    detail: KnowledgeDetail | null
    questionVersion: number
    selectionRule:
      | "adopted"
      | "confirmation"
      | "conflict_choice"
      | "correction"
      | "withdrawal"
  } | null
}

export type SlotEventView = {
  eventId: number
  at: string
  kind: string
  actor: { id: string; name: string | null; basis: string | null } | null
  answer: KnowledgeAnswer | null
  before: CorrectionValue | null
  after: CorrectionValue | null
  material: boolean | null
  selectionRule: string | null
  reason: string | null
}

// ---- Reconciliation (B03-f, b03-design §8, A13) -------------------------------

export const SOURCE_KINDS = [
  "venue_website",
  "google_business_profile",
  "booking_site",
  "operator_document",
  "other",
] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]
export type MappingKind = "exact" | "candidate" | "none"

export type SourceView = {
  sourceId: string
  kind: SourceKind
  label: string
  venueId: string | null
  declaredAt: string
  declaredBy: string
  retiredAt: string | null
  latestRevision: string | null
}

export type SourceAssertionInput = {
  venueId: string
  questionKey: string
  headline: KnowledgeAnswer
  detail?: KnowledgeDetail
  excerpt?: string
}

export type LegacyMappingsView = {
  items: {
    legacyFactId: string
    legacyRevision: number
    legacyKey: string
    venueId: string
    presence: "present" | "absent" | "unknown"
    mappings: {
      questionKey: string
      kind: MappingKind
      reason: string
      reviewedBy: string
      reviewedAt: string
    }[]
  }[]
  nextCursor: string | null
}

export type ReconcileCounts = {
  candidates: number
  proposals: number
  corroborating: number
  conflicting: number
  alreadyApplied: number
  skipped: number
}

export type ReconcileProposal = {
  venueId: string
  questionKey: string
  answer: KnowledgeAnswer
  state: "proposal" | "corroborates" | "conflicts"
  source: string
  legacyFactId: string | null
  legacyRevision: number | null
  assertionId: string | null
}

export type ReconcileResult = {
  runId: string
  mode: "dry_run" | "apply"
  counts: ReconcileCounts
  wouldCreate?: ReconcileProposal[]
  dryRunId?: string
  created?: number
  conflicts: Pick<
    ReconcileProposal,
    "venueId" | "questionKey" | "answer" | "source"
  >[]
  sourceRevisions: Record<string, string | number>
}

export type ReconciliationRunView = {
  runId: string
  kind: "legacy" | "external"
  mode: "dry_run" | "apply"
  venueId: string | null
  dryRunId: string | null
  startedAt: string
  counts: ReconcileCounts
  wouldCreate: ReconcileProposal[]
  conflicts: ReconcileResult["conflicts"]
  sourceRevisions: Record<string, string | number>
}

/** §8.2 L5: a legacy fact as narrative, never a knowledge confirmation. */
export type LegacyNarrativeItem = {
  legacyKey: string
  label: string
  presence: "present" | "absent" | "unknown"
  facts: string | null
  policy: string | null
  savedAsConfirmedAt: string | null
  updatedAt: string
}

/** B03-e (§7.3): what naming a policy would do, per venue and use. */
export type FreshnessPreviewView = {
  key: string
  items: {
    venueId: string
    use: "internal" | "public"
    answers: number
    dueSoon: number
    expired: number
    basisMissing: number
  }[]
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
  | "draft_already_sent"

export type KnowledgeFailure = Omit<AmenityFailure, "code"> & {
  code: KnowledgeErrorCode
  /** draft_conflict: the draft revision now stored (null: none). */
  draftRevision?: number | null
  /** draft_already_sent: why, and the send time (the next draft base). */
  sentReason?: DraftSentReason
  sentAt?: string | null
  /** place_exists: the active place with the same kind and label. */
  subjectId?: string
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
  NLK09: "draft_already_sent",
  NLK12: "reconcile_source_changed",
  NLK13: "place_exists",
  NLK14: "import_slot_has_answer",
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
  /** B03-b: present (all three) selects the 19-argument overload. */
  p_detail?: KnowledgeDetail | null
  p_observed_on?: string | null
  p_observed_on_source?: ObservedOnSource | null
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
      /** Present: the B02 overload, which refuses a save of work already sent. */
      p_base_sent_at?: string | null
    }
    returns: { draftRevision: number; savedAt: string }
  }
  knowledge_discard_draft: { args: { p_check_id: string }; returns: boolean }
  knowledge_dismiss_outcome: { args: { p_event_id: number }; returns: boolean }
  my_label_work: {
    args: Record<string, never>
    returns: { needs_labels: number; needs_attention: number }[]
  }
  manager_triage_summary: {
    args: { p_venue_id: string | null }
    returns: {
      queue: TriageRow
      available: boolean
      waiting: number | null
      oldest_waiting_at: string | null
      own_waiting: number | null
    }[]
  }
  my_contributions_feed: {
    args: { p_cursor: string | null; p_limit: number }
    returns: ContributionsFeedPage
  }
  my_venue_capabilities: {
    args: { p_venue_id: string | null }
    returns: VenueCapabilities
  }
  my_asset_delete_impact: {
    args: { p_asset_id: string }
    returns: AssetDeleteImpact
  }
  contribution_group_start: {
    args: {
      p_key: string
      p_subject_kind: GroupSubjectKind
      p_subject_id: string | null
    }
    returns: string
  }
  contribution_group_add: {
    args: { p_group_id: string; p_asset_ids: string[] }
    returns: number
  }
  contribution_groups_for_assets: {
    args: { p_asset_ids: string[] }
    returns: { asset_id: string; group_id: string }[]
  }
  contribution_group: {
    args: { p_group_id: string }
    returns: ContributionGroupView
  }
  knowledge_question: {
    args: { p_key: string; p_version: number | null }
    returns: QuestionView
  }
  knowledge_registry: {
    args: { p_lifecycle: QuestionLifecycle[] | null }
    returns: { items: QuestionView[] }
  }
  knowledge_value_list: {
    args: { p_list: ValueListName }
    returns: ValueListView
  }
  knowledge_correct: {
    args: {
      p_check_id: string
      p_slot_revision: number
      p_idempotency_key: string
      p_headline: SubmitAnswer
      p_detail: KnowledgeDetail | null
      p_reason: string
    }
    returns: CorrectResult
  }
  knowledge_withdraw: {
    args: {
      p_check_id: string
      p_slot_revision: number
      p_idempotency_key: string
      p_reason: string
    }
    returns: { decisionId: string; slotRevision: number; replayed: boolean }
  }
  knowledge_upgrade_run: {
    args: { p_key: string; p_mode: "dry_run" | "apply" }
    returns: Record<string, unknown> & {
      runId: string
      mode: "dry_run" | "apply"
    }
  }
  knowledge_slot_history: {
    args: { p_check_id: string; p_at: string }
    returns: SlotHistoryView
  }
  knowledge_slot_events: {
    args: { p_check_id: string; p_cursor: string | null; p_limit: number }
    returns: { items: SlotEventView[]; nextCursor: string | null }
  }
  knowledge_source_declare: {
    args: {
      p_kind: SourceKind
      p_label: string
      p_venue_id: string | null
      p_idempotency_key: string
    }
    returns: { sourceId: string; replayed: boolean }
  }
  knowledge_source_retire: {
    args: { p_source_id: string; p_reason: string; p_idempotency_key: string }
    returns: { sourceId: string; retired: true; replayed: boolean }
  }
  knowledge_source_import: {
    args: {
      p_source_id: string
      p_source_revision: string
      p_retrieved_at: string
      p_assertions: SourceAssertionInput[]
      p_idempotency_key: string
    }
    returns: { sourceId: string; imported: number; replayed: boolean }
  }
  knowledge_mapping_review: {
    args: {
      p_legacy_fact_id: string
      p_legacy_revision: number
      p_question_key: string
      p_kind: MappingKind
      p_reason: string
      p_idempotency_key: string
    }
    returns: { mappingId: string; replayed: boolean }
  }
  knowledge_reconcile: {
    args: {
      p_kind: "legacy" | "external"
      p_mode: "dry_run" | "apply"
      p_venue_id: string | null
    }
    returns: ReconcileResult
  }
  knowledge_sources: {
    args: { p_include_retired: boolean }
    returns: { items: SourceView[] }
  }
  knowledge_legacy_mappings: {
    args: { p_venue_id: string | null; p_cursor: string | null }
    returns: LegacyMappingsView
  }
  knowledge_reconciliation_runs: {
    args: { p_cursor: string | null }
    returns: {
      items: Pick<
        ReconciliationRunView,
        "runId" | "kind" | "mode" | "venueId" | "startedAt" | "counts"
      >[] &
        { startedBy: string }[]
      nextCursor: string | null
    }
  }
  knowledge_reconciliation_run: {
    args: { p_run_id: string }
    returns: ReconciliationRunView
  }
  knowledge_legacy_narrative: {
    args: { p_venue_id: string | null }
    returns: { venueId: string; items: LegacyNarrativeItem[] }
  }
  my_rechecks: {
    args: Record<string, never>
    returns: { items: RecheckTaskView[] }
  }
  knowledge_check_rechecks: {
    args: { p_check_id: string }
    returns: { count: number; items: RecheckTaskView[] }
  }
  knowledge_freshness_preview: {
    args: {
      p_key: string
      p_policy: { internal?: string | null; public?: string | null }
    }
    returns: FreshnessPreviewView
  }
  knowledge_occurrences: {
    args: { p_check_id: string; p_from: string; p_to: string }
    returns: OccurrenceRow[]
  }
  knowledge_schedule_preview: {
    args: {
      p_schedule: Record<string, unknown>
      p_timezone: string | null
      p_from: string
      p_to: string
    }
    returns: OccurrenceRow[]
  }
  knowledge_schedule_exception: {
    args: {
      p_check_id: string
      p_slot_revision: number
      p_idempotency_key: string
      p_schedule_id: string
      p_local_date: string
      p_kind: ScheduleExceptionKind
      p_windows: { start: string; end: string }[] | null
      p_note: string | null
    }
    returns: { exceptionId: string; slotRevision: number; replayed: boolean }
  }
  knowledge_subjects: {
    args: { p_venue_id: string | null }
    returns: { venueId: string; items: SubjectView[] }
  }
  knowledge_subject_add: {
    args: {
      p_venue_id: string | null
      p_kind: PlaceKind
      p_label: string
      p_idempotency_key: string
    }
    returns: { subjectId: string; replayed: boolean }
  }
  knowledge_subject_retire: {
    args: { p_subject_id: string; p_reason: string; p_idempotency_key: string }
    returns: { subjectId: string; retired: true; replayed: boolean }
  }
}
export type KnowledgeRpcName = keyof KnowledgeRpcs

/**
 * R10. Keyed overloads of the legacy check writes. A repeated key from the
 * same person with the same request returns the first result with
 * `replayed: true`; the old signatures (AmenityRpcs) are unchanged.
 */
type KeyedResult = { revision: number; replayed: boolean }
export type AmenityKeyedRpcs = {
  amenity_assign_check: {
    args: {
      p_check_id: string
      p_assignee_id: string | null
      p_revision: number
      p_idempotency_key: string
    }
    returns: KeyedResult
  }
  amenity_set_check_notes: {
    args: {
      p_check_id: string
      p_notes: string
      p_revision: number
      p_idempotency_key: string
    }
    returns: KeyedResult
  }
  amenity_reopen_check: {
    args: {
      p_check_id: string
      p_revision: number
      p_preset: ReopenPreset
      p_reason: string | null
      p_idempotency_key: string
    }
    returns: KeyedResult
  }
  amenity_archive_check: {
    args: { p_check_id: string; p_revision: number; p_idempotency_key: string }
    returns: KeyedResult
  }
  amenity_restore_check: {
    args: { p_check_id: string; p_revision: number; p_idempotency_key: string }
    returns: KeyedResult
  }
  amenity_add_checks: {
    args: { p_venue_id: string; p_keys: string[]; p_idempotency_key: string }
    returns: { checkIds: string[]; replayed: boolean }
  }
}
export type AmenityKeyedRpcName = keyof AmenityKeyedRpcs
