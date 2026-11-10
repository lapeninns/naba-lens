// Shared amenity catalogue and per-venue evidence checks: the contract between
// the database (RPCs), the server services, server actions and the UI.
// Type-only plus plain constants, so client components can import it.
//
// The catalogue (`public.amenity_catalogue`) is shared and versioned; it only
// changes through a migration generated from `supabase/seed/amenity_catalogue.csv`.
// Each venue has its own checks, answers, assignees, submissions and history.
// There is no review step: a submission that meets the evidence rule becomes the
// venue's current answer at once. Managers correct it by reopening the check.
// Amenity checks never touch Coverage tables, monthly targets or photo counts.

// ---- Enums ------------------------------------------------------------------

export const EVIDENCE_RULES = ["photo", "video", "either", "both"] as const
export type EvidenceRule = (typeof EVIDENCE_RULES)[number]

export const CHECK_STATUSES = ["active", "archived"] as const
export type CheckStatus = (typeof CHECK_STATUSES)[number]

export const CHECK_PROGRESS = [
  "needs_capture",
  "complete",
  "needs_recheck",
] as const
export type CheckProgress = (typeof CHECK_PROGRESS)[number]

export const CHECK_ANSWERS = [
  "to_check",
  "yes",
  "no",
  "not_applicable",
] as const
export type CheckAnswer = (typeof CHECK_ANSWERS)[number]

/** What a submission may record; `to_check` is only the initial state. */
export const SUBMIT_ANSWERS = ["yes", "no", "not_applicable"] as const
export type SubmitAnswer = (typeof SUBMIT_ANSWERS)[number]

export type EvidenceKind = "photo" | "video"

export const CHECK_EVENT_KINDS = [
  "added", // detail.source: "enable" | "manager"
  "assigned", // detail.assigneeId
  "unassigned", // detail.cause: "manager" | "assignee_left"
  "notes_updated",
  "submitted", // detail.submissionId, detail.answer
  "reopened", // reason, detail.preset
  "evidence_lost", // detail.submissionId, detail.assetId
  "archived",
  "restored",
] as const
export type CheckEventKind = (typeof CHECK_EVENT_KINDS)[number]

export const REOPEN_PRESETS = [
  "credentials_visible",
  "wrong_area",
  "conditions_changed",
  "evidence_unclear",
  "other",
] as const
export type ReopenPreset = (typeof REOPEN_PRESETS)[number]

// ---- Fixed catalogue facts ----------------------------------------------------

/** Created by `enableAmenities`. Must match `is_core` in the seed CSV. */
export const CORE_CHECK_KEYS = [
  "step_free_entrance",
  "onsite_parking",
  "guest_toilets",
  "guest_wifi",
] as const

/** Keys whose capture needs the staff redaction tickbox and Wi-Fi test notes. */
export const REDACTION_CONFIRM_KEYS = ["guest_wifi"] as const
export const WIFI_KEY = "guest_wifi"

/**
 * Catalogue key -> legacy Coverage amenity template keys
 * (`coverage_amenity_templates.key`) whose venue media a manager or admin may
 * attach to a new submission. Media comes from that venue's coverage items on
 * requirements with these `amenity_key`s, or its `venue_amenity_fact_media`.
 */
export const LEGACY_COVERAGE_MATCHES: Readonly<
  Record<string, readonly string[]>
> = {
  step_free_entrance: ["access_routes", "entrance"],
  accessible_toilet: ["accessible_toilet"],
  onsite_parking: ["parking"],
  street_parking: ["parking"],
  guest_toilets: ["toilets"],
  outdoor_seating: ["outdoor_seating"],
  covered_seating: ["outdoor_seating"],
  dogs_inside: ["dog_facilities"],
  dogs_outside: ["dog_facilities"],
  dog_water: ["dog_facilities"],
  high_chairs: ["family_facilities"],
  baby_changing: ["family_facilities"],
  play_area: ["family_facilities"],
  onsite_bar: ["bar_area"],
}

export const LIMITS = {
  finding: 2000,
  limitations: 2000,
  /** Required (1..500) for No and Not applicable, and for reopen preset "other". */
  reason: 500,
  notes: 2000,
  maxAssets: 10,
  maxAddKeys: 39,
  wifiTestSpot: 120,
  maxMbps: 10000,
} as const

/** Internal only: shown to the submitter, venue manager and admin, never guests. */
export type WifiMetadata = {
  testSpot: string
  /** London date "YYYY-MM-DD", not in the future. */
  testedOn: string
  downloadMbps: number
  uploadMbps: number
}

/**
 * Yes must satisfy the rule; No / Not applicable need a reason and evidence is
 * optional. `both` needs at least one photo AND one video.
 */
export function evidenceSatisfies(
  rule: EvidenceRule,
  kinds: readonly EvidenceKind[]
): boolean {
  const photo = kinds.includes("photo")
  const video = kinds.includes("video")
  switch (rule) {
    case "photo":
      return photo
    case "video":
      return video
    case "either":
      return photo || video
    case "both":
      return photo && video
  }
}

// ---- UI words (shared by UI and e2e; use these exact strings) -------------------

export const PROGRESS_LABEL: Record<CheckProgress, string> = {
  needs_capture: "Needs capture",
  complete: "Complete",
  needs_recheck: "Needs recheck",
}
export const ANSWER_LABEL: Record<CheckAnswer, string> = {
  to_check: "To check",
  yes: "Yes",
  no: "No",
  not_applicable: "Not applicable",
}
export const EVIDENCE_RULE_LABEL: Record<EvidenceRule, string> = {
  photo: "Photo",
  video: "Video",
  either: "Photo or video",
  both: "Photo and video",
}
export const REOPEN_PRESET_LABEL: Record<ReopenPreset, string> = {
  credentials_visible: "Password or QR visible",
  wrong_area: "Wrong area",
  conditions_changed: "Conditions changed",
  evidence_unclear: "Evidence unclear",
  other: "Other",
}
export const UI_TEXT = {
  navTab: "Amenities",
  enable: "Enable Amenities",
  addFromCatalogue: "Add from catalogue",
  addSelected: "Add selected",
  assign: "Assign",
  unassign: "Unassign",
  archive: "Archive",
  restore: "Restore",
  reopen: "Reopen",
  captureMyself: "Capture myself",
  submit: "Submit finding",
  retry: "Try again",
  recentlyCompleted: "Recently completed",
  archived: "Archived",
  redactionConfirm: "I have covered the Wi-Fi password and join QR code",
  staffSection: "Amenity checks",
  legacyMedia: "Earlier Coverage photos",
} as const

// ---- Routes -----------------------------------------------------------------

/** `basePath` is `/staff/manage` or `/admin/coverage/<venueId>`. */
export function amenityHrefs(basePath: string) {
  return {
    list: `${basePath}/amenities`,
    check: (checkId: string) =>
      `${basePath}/amenities/${encodeURIComponent(checkId)}`,
    capture: (checkId: string) =>
      `${basePath}/amenities/${encodeURIComponent(checkId)}/capture`,
  }
}
export const staffCaptureHref = (checkId: string) =>
  `/staff/tasks/amenities/${encodeURIComponent(checkId)}`
export const evidenceHref = (
  assetId: string,
  which: "thumb" | "preview" | "stream"
) => `/api/amenities/evidence/${encodeURIComponent(assetId)}/${which}`

// ---- View DTOs (returned by lib/server/amenities) ----------------------------

export type Instant = string
export type PersonRef = { id: string; displayName: string | null }

export type CatalogueEntry = {
  key: string
  category: string
  question: string
  captureBrief: string
  evidenceRule: EvidenceRule
  isCore: boolean
  position: number
  version: number
}

export type CheckSummary = {
  id: string
  venueId: string
  entry: CatalogueEntry
  status: CheckStatus
  progress: CheckProgress
  answer: CheckAnswer
  assignee: PersonRef | null
  answeredBy: PersonRef | null
  answeredAt: Instant | null
  recheckReason: string | null
  notes: string | null
  revision: number
  updatedAt: Instant
  /**
   * B03-c (§3.8, A19): set when the stored answer is a qualified Yes. The
   * check then reads needs_recheck with a reason for the qualifier; the
   * stored row is still complete. Absent otherwise.
   */
  qualification?: Qualification
}

/** A Yes narrowed by its knowledge detail (b03-design §3.8). */
export type Qualification =
  | "conditional"
  | "temporarily_unavailable"
  /** A39: a policy answer in use that is not complete yet. */
  | "policy_incomplete"

export type EvidenceItem = {
  assetId: string
  kind: EvidenceKind
  /** False once the asset is deleted or no longer ready; history keeps the row. */
  available: boolean
  thumbUrl: string | null
  previewUrl: string | null
  /** Video playback route, or null for photos. */
  streamUrl: string | null
}

export type SubmissionView = {
  id: string
  answer: SubmitAnswer
  finding: string | null
  limitations: string | null
  reason: string | null
  submittedBy: PersonRef
  submittedAt: Instant
  templateVersion: number
  evidenceRule: EvidenceRule
  evidence: EvidenceItem[]
  /** Only for the submitter, the venue's manager and admins. */
  wifi: WifiMetadata | null
  isCurrent: boolean
  /** B03-c: set when this answer is a qualified Yes (§3.8). */
  qualification?: Qualification
}

export type CheckEventView = {
  id: string
  kind: CheckEventKind
  actor: PersonRef | null
  at: Instant
  reason: string | null
  detail: Record<string, unknown>
}

export type AssigneeOption = {
  id: string
  displayName: string
  jobTitle: string | null
}

export type CheckPermissions = {
  canAssign: boolean
  canArchive: boolean
  canRestore: boolean
  canReopen: boolean
  canSubmit: boolean
  canAttachLegacy: boolean
}

export type CheckDetail = {
  check: CheckSummary
  submissions: SubmissionView[]
  events: CheckEventView[]
  /** Empty unless the caller can assign. */
  assigneeOptions: AssigneeOption[]
  permissions: CheckPermissions
}

export type VenueAmenitiesView = {
  venue: { id: string; name: string }
  enabled: boolean
  /** Admin only. */
  canEnable: boolean
  active: CheckSummary[]
  archived: CheckSummary[]
  /** Complete checks, newest answer first, at most 10. */
  recentlyCompleted: CheckSummary[]
  counts: Record<CheckProgress, number>
}

export type CatalogueOption = CatalogueEntry & {
  /** Present when the venue already has this key. */
  existing: { checkId: string; status: CheckStatus } | null
}

/** Assets the caller may attach to a submission for this check. */
export type SubmittableAsset = {
  assetId: string
  kind: EvidenceKind
  createdAt: Instant
  source: "own" | "legacy_coverage"
  thumbUrl: string | null
}

export type MyAmenityTask = CheckSummary // active, assigned to me, progress <> complete

// ---- Inputs ----------------------------------------------------------------

export type EnableInput = { venueId: string }
export type AddChecksInput = { venueId?: string; keys: string[] }
export type ArchiveInput = { checkId: string; revision: number }
export type RestoreInput = { checkId: string; revision: number }
export type AssignInput = {
  checkId: string
  assigneeId: string | null
  revision: number
}
export type NotesInput = { checkId: string; notes: string; revision: number }
export type ReopenInput = {
  checkId: string
  revision: number
  preset: ReopenPreset
  /** Required when preset is "other"; optional extra text otherwise. */
  reason?: string
}
export type SubmitInput = {
  checkId: string
  revision: number
  /** Client-generated UUID, kept with the draft and reused on retry. */
  idempotencyKey: string
  answer: SubmitAnswer
  finding?: string
  limitations?: string
  /** Required for no / not_applicable. */
  reason?: string
  assetIds: string[]
  /** Required for guest_wifi + yes. */
  wifi?: WifiMetadata
  /** Required true for REDACTION_CONFIRM_KEYS when the answer is Yes or any photo is attached. */
  redactionConfirmed?: boolean
}

// ---- Results and errors ------------------------------------------------------

export type AmenityErrorCode =
  | "unauthenticated"
  | "account_inactive"
  | "not_permitted"
  | "wrong_venue"
  | "not_found"
  | "invalid_input"
  | "needs_setup" // amenities not enabled for the venue
  | "revision_conflict" // stale revision: reload the check
  | "state_conflict" // archived, idempotency key reused, assignee not eligible
  | "asset_ineligible"
  | "evidence_rule_unmet"
  | "knowledge_path_required" // the question moved to the knowledge form: open it again
  | "knowledge_slot_out_of_scope" // the question left the knowledge working list
  | "unavailable"

export type AmenityFailure = {
  ok: false
  code: AmenityErrorCode
  status: 400 | 401 | 403 | 404 | 409 | 503
  message: string
  fieldErrors?: Partial<Record<string, string>>
  currentRevision?: number | null
  /** asset_ineligible: which asset and why. */
  assetId?: string
  assetReason?:
    "not_found" | "not_ready" | "other_venue" | "not_own" | "deleted"
  /** evidence_rule_unmet: the rule that was not met. */
  rule?: EvidenceRule
}

export type AmenityResult<T> = ({ ok: true } & T) | AmenityFailure

export type SubmitResult = {
  submissionId: string
  revision: number
  replayed: boolean
}

// ---- Server service and action signatures -----------------------------------
// Services: `lib/server/amenities` (actor + untrusted input).
// Actions:  `app/_amenities/actions.ts` ("use server", untrusted input only).

export type AmenityServices = {
  getVenueAmenities(input: {
    venueId?: string
  }): Promise<AmenityResult<{ view: VenueAmenitiesView }>>
  listCatalogue(input: {
    venueId?: string
  }): Promise<AmenityResult<{ options: CatalogueOption[] }>>
  getCheck(input: {
    checkId: string
  }): Promise<AmenityResult<{ detail: CheckDetail }>>
  getMyAmenityTasks(
    input: Record<string, never>
  ): Promise<AmenityResult<{ tasks: MyAmenityTask[] }>>
  listSubmittableAssets(input: {
    checkId: string
  }): Promise<AmenityResult<{ assets: SubmittableAsset[] }>>
  enableAmenities(
    input: EnableInput
  ): Promise<AmenityResult<{ created: number }>>
  addChecks(
    input: AddChecksInput
  ): Promise<AmenityResult<{ checkIds: string[] }>>
  archiveCheck(
    input: ArchiveInput
  ): Promise<AmenityResult<{ revision: number }>>
  restoreCheck(
    input: RestoreInput
  ): Promise<AmenityResult<{ revision: number }>>
  assignCheck(input: AssignInput): Promise<AmenityResult<{ revision: number }>>
  setCheckNotes(input: NotesInput): Promise<AmenityResult<{ revision: number }>>
  reopenCheck(input: ReopenInput): Promise<AmenityResult<{ revision: number }>>
  submitFinding(input: SubmitInput): Promise<AmenityResult<SubmitResult>>
}
export type AmenityServiceName = keyof AmenityServices

// ---- Database RPC contract (W1 implements, W2 calls) --------------------------
// All `security definer`, `set search_path = ''`, granted to `authenticated`
// only. Every call re-reads the caller's profile and manager grant
// (private.can_manage_venue / private.assert_can_manage_venue): JWT claims are
// never trusted. Mutations take `p_revision` and raise `amenity_conflict` with
// details `{"revision": <current>}` when stale; each successful mutation bumps
// `revision` by 1 and writes one `amenity_check_events` row.
//
// Exceptions use `raise exception '<code>' using errcode = 'P0001'` (P0002 for
// *_not_found) with these messages:
export const RPC_ERRORS = [
  "not_active_user",
  "not_active_admin",
  "not_venue_manager",
  "amenity_not_permitted",
  "venue_not_found",
  "amenity_check_not_found",
  "amenity_key_not_found",
  "amenities_not_enabled",
  "amenity_conflict",
  "amenity_check_archived",
  "idempotency_key_reused",
  "staff_not_eligible",
  "invalid_answer",
  "reason_required",
  "invalid_reason",
  "invalid_finding",
  "invalid_limitations",
  "invalid_notes",
  "invalid_asset_list",
  "invalid_key_list",
  "invalid_wifi_metadata",
  "invalid_reopen_preset",
  "redaction_not_confirmed",
  "evidence_rule_unmet", // details: the rule
  "evidence_not_eligible", // details: {"assetId": "...", "reason": AmenityFailure["assetReason"]}
  "invalid_idempotency_key",
  "venue_inactive", // writes at a deactivated venue (maps to needs_setup)
] as const
export type RpcError = (typeof RPC_ERRORS)[number]

/** One check joined to its catalogue entry and people names. */
export type CheckRow = {
  id: string
  venue_id: string
  template_key: string
  category: string
  question: string
  capture_brief: string
  evidence_rule: EvidenceRule
  is_core: boolean
  position: number
  catalogue_version: number
  status: CheckStatus
  progress: CheckProgress
  answer: CheckAnswer
  current_submission_id: string | null
  assignee_user_id: string | null
  assignee_name: string | null
  answered_by: string | null
  answered_by_name: string | null
  answered_at: string | null
  recheck_reason: string | null
  notes: string | null
  revision: number
  updated_at: string
  /** B03-c: amenity_checks_for_venue and amenity_check only (A19). */
  qualification?: Qualification | null
}

export type SubmissionRow = {
  id: string
  check_id: string
  answer: SubmitAnswer
  finding: string | null
  limitations: string | null
  reason: string | null
  submitted_by: string
  submitted_by_name: string | null
  created_at: string
  template_version: number
  evidence_rule: EvidenceRule
  /** Null unless the caller is the submitter, the venue's manager or an admin. */
  internal_metadata: Record<string, unknown> | null
  /** B03-c (§3.8). */
  qualification?: Qualification | null
}

export type SubmissionAssetRow = {
  submission_id: string
  asset_id: string
  evidence_kind: EvidenceKind
  /** media_assets is ready and not deleted. */
  available: boolean
  has_thumbnail: boolean
  has_preview: boolean
}

export type EventRow = {
  id: string
  check_id: string
  kind: CheckEventKind
  actor_id: string | null
  actor_name: string | null
  reason: string | null
  detail: Record<string, unknown>
  created_at: string
}

export type AmenityRpcs = {
  // reads
  amenity_venue_state: {
    args: { p_venue_id: string }
    returns: {
      venue_id: string
      venue_name: string
      enabled: boolean
      can_enable: boolean
    }[]
  }
  amenity_checks_for_venue: {
    args: { p_venue_id: string; p_include_archived: boolean }
    returns: CheckRow[]
  }
  amenity_my_checks: { args: Record<string, never>; returns: CheckRow[] }
  amenity_check: { args: { p_check_id: string }; returns: CheckRow[] }
  amenity_check_submissions: {
    args: { p_check_id: string }
    returns: SubmissionRow[]
  }
  amenity_check_submission_assets: {
    args: { p_check_id: string }
    returns: SubmissionAssetRow[]
  }
  amenity_check_events: { args: { p_check_id: string }; returns: EventRow[] }
  amenity_assignee_options: {
    args: { p_check_id: string }
    returns: { id: string; display_name: string; job_title: string | null }[]
  }
  amenity_catalogue_for_venue: {
    args: { p_venue_id: string }
    returns: {
      key: string
      category: string
      question: string
      capture_brief: string
      evidence_rule: EvidenceRule
      is_core: boolean
      position: number
      catalogue_version: number
      check_id: string | null
      check_status: CheckStatus | null
    }[]
  }
  amenity_submittable_assets: {
    args: { p_check_id: string }
    returns: {
      asset_id: string
      media_type: "image" | "video"
      created_at: string
      source: "own" | "legacy_coverage"
      has_thumbnail: boolean
    }[]
  }
  /** Media gate, same shape as task_evidence_asset: a row only if the caller may see this asset as amenity evidence or as a submittable asset. */
  amenity_evidence_asset: {
    args: { p_asset_id: string }
    returns: {
      asset_id: string
      media_type: "image" | "video"
      has_thumbnail: boolean
      has_preview: boolean
    }[]
  }
  // writes
  amenity_enable_venue: { args: { p_venue_id: string }; returns: number }
  amenity_add_checks: {
    args: { p_venue_id: string; p_keys: string[] }
    returns: string[]
  }
  amenity_archive_check: {
    args: { p_check_id: string; p_revision: number }
    returns: number
  }
  amenity_restore_check: {
    args: { p_check_id: string; p_revision: number }
    returns: number
  }
  amenity_assign_check: {
    args: {
      p_check_id: string
      p_assignee_id: string | null
      p_revision: number
    }
    returns: number
  }
  amenity_set_check_notes: {
    args: { p_check_id: string; p_notes: string; p_revision: number }
    returns: number
  }
  amenity_reopen_check: {
    args: {
      p_check_id: string
      p_revision: number
      p_preset: ReopenPreset
      p_reason: string | null
    }
    returns: number
  }
  amenity_submit_finding: {
    args: {
      p_check_id: string
      p_revision: number
      p_idempotency_key: string
      p_answer: SubmitAnswer
      p_finding: string | null
      p_limitations: string | null
      p_reason: string | null
      p_asset_ids: string[]
      p_internal_metadata: Record<string, unknown> | null
      p_redaction_confirmed: boolean
    }
    returns: { submission_id: string; revision: number; replayed: boolean }[]
  }
}
export type AmenityRpcName = keyof AmenityRpcs
