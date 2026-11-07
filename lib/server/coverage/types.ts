// Staff portfolios and venue coverage: the DTOs the coverage services return.
// Type-only, so client components can `import type` from here. People appear
// only as narrow projections (name, avatar, team, job title, active): no email,
// auth or account fields. Periods are Europe/London calendar months and every
// label is preformatted in Europe/London, so the UI never does time-zone math.

import type { Department } from "@/lib/config/departments"

/** London calendar month, "YYYY-MM". */
export type PeriodKey = string
/** London calendar date, "YYYY-MM-DD". */
export type LocalDate = string
/** UTC instant, ISO 8601. */
export type Instant = string

export type PeriodView = {
  key: PeriodKey
  /** "November 2026" */
  label: string
  /** London midnight on the 1st, as a UTC instant. */
  startsAt: Instant
  /** Exclusive: London midnight on the 1st of the next month. */
  endsAt: Instant
  isCurrent: boolean
  timeZone: "Europe/London"
}

export type DueView = {
  dueOn: LocalDate
  /** Exclusive: London midnight after `dueOn` (overdue from this instant). */
  dueAt: Instant
  /** "Due 30 Nov 2026" */
  label: string
  /** Display only: overdue work stays open and can still be completed. */
  overdue: boolean
}

/** Narrow roster projection. Never carries email, auth or account data. */
export type CoveragePerson = {
  id: string
  displayName: string
  /** Authorised avatar route, or null. */
  avatarUrl: string | null
  department: Department | null
  jobTitle: string | null
  /** Active staff (in a venue roster: currently at that venue). */
  active: boolean
}

/** A person named on a record. `displayName` is null when the caller cannot see it. */
export type PersonRef = { id: string; displayName: string | null }

export type CoverageVenue = { id: string; name: string }

// ---- Scope --------------------------------------------------------------------

export type ProfileSetupGap = "venue" | "team"

export type CoverageScope = {
  /** Managers have no coverage surface: no submitting, no legacy manage tools. */
  role: "staff" | "manager" | "admin"
  /** Staff profile setup (venue, FOH/BOH team). Always complete for admins. */
  setup: { complete: boolean; missing: ProfileSetupGap[] }
  /** The venue a staff member works at now, or null. */
  venue: (CoverageVenue & { active: boolean }) | null
  /**
   * The venue of a staff account's effective (legacy, staff-held) manager
   * grant, or null. Always null for admins and for manager accounts, whose
   * workspace is /manager.
   */
  managedVenue: CoverageVenue | null
  /** Active staff assigned to an active venue (the database's submit rule). */
  canSubmit: boolean
  /** Effective venue manager, or admin (admins pass `venueId`). */
  canManageVenue: boolean
  canManageGrants: boolean
  canViewGroupOverview: boolean
}

// ---- Monthly targets ----------------------------------------------------------

export type MonthlyTargetSource =
  "manager" | "copied" | "placeholder" | "admin_correction"

export type MonthlySetupGap = "team" | "target"

export type MonthlyProgress = {
  /** Null when the person has no target row for this period ("missing period"). */
  targetId: string | null
  period: PeriodView
  venue: CoverageVenue
  person: CoveragePerson
  /** Active staff currently at this venue (false for history after a transfer). */
  isCurrentMember: boolean
  isManager: boolean
  /** `needs_setup` when the target or the FOH/BOH team is missing. Never complete then. */
  status: "needs_setup" | "set"
  setupMissing: MonthlySetupGap[]
  targetCount: number | null
  source: MonthlyTargetSource | null
  /** Pass as `expectedRevision` when changing the target; null when there is no row. */
  revision: number | null
  /** Distinct accepted own photos uploaded and submitted in the period at this venue. */
  accepted: number
  pending: number
  needsAnotherPhoto: number
  /** Accepted after the period ended, credited to it. */
  lateAcceptances: number
  /** Credited, then deleted after the period ended. */
  evidenceRemoved: number
  complete: boolean
  due: DueView | null
}

// ---- Requirements -------------------------------------------------------------

export type RequirementKind =
  "menu_section" | "amenity" | "service" | "venue_specific"

export type RequirementStatus =
  "needs_setup" | "active" | "not_applicable" | "retired"

export type RequirementSetupIssue =
  /** Applicability and photo target not confirmed yet. */
  | "unconfirmed"
  /** Amenity presence is unknown: needs verification. */
  | "fact_unknown"
  /** Amenity presence set but not confirmed. */
  | "fact_unconfirmed"
  /** Amenity is absent: mark the requirement not applicable with a reason. */
  | "fact_absent"
  /** Active with nobody assigned (a warning; never blocks activation). */
  | "no_assignees"
  /** Assignees left (transfer or deactivation) before it was satisfied. */
  | "needs_reassignment"

export type CoverageTemplateKey =
  | "exterior_signage"
  | "entrance"
  | "bar_area"
  | "dining_area"
  | "service_area"
  | "toilets"
  | "access_routes"
  | "accessible_toilet"
  | "outdoor_seating"
  | "parking"
  | "dog_facilities"
  | "family_facilities"

export type CoverageTemplate = {
  key: CoverageTemplateKey
  kind: "amenity" | "service"
  title: string
  defaultGuidance: string | null
  suggestedPhotoTarget: number
  /** Amenity templates need a confirmed presence fact before activation. */
  needsFact: boolean
}

export type MenuPlanStatus = "draft" | "confirmed" | "superseded" | "discarded"

/** Display snapshot taken when the plan was made. Never used as identity. */
export type MenuSectionRef = {
  menuPlanId: string
  menuPlanStatus: MenuPlanStatus | null
  menuVersionId: string
  sectionName: string
  sectionSlug: string | null
  sectionKind: string | null
  position: number | null
  itemCount: number | null
}

export type AmenityPresence = "present" | "absent" | "unknown"

export type RequirementProgress = {
  target: number
  /** Distinct accepted photos with available evidence (any upload month). */
  accepted: number
  pending: number
  needsAnotherPhoto: number
  evidenceRemoved: number
  satisfied: boolean
  overdue: boolean
}

export type RequirementView = {
  id: string
  venueId: string
  kind: RequirementKind
  title: string
  guidance: string | null
  photoTarget: number
  due: DueView | null
  status: RequirementStatus
  /** Required for not_applicable and retired. */
  statusReason: string | null
  /** Active, and for a menu section, part of the confirmed plan: takes submissions. */
  isCurrent: boolean
  setupIssues: RequirementSetupIssue[]
  templateKey: CoverageTemplateKey | null
  menuSection: MenuSectionRef | null
  amenity: { presence: AmenityPresence | null; confirmed: boolean } | null
  assigneeIds: string[]
  /** Resolved names for `assigneeIds` the caller can see. */
  assignees: CoveragePerson[]
  needsReassignment: boolean
  progress: RequirementProgress
  /** Pass as `expectedRevision` on updates and status changes. */
  revision: number
}

// ---- Submissions (one per photo) and review ----------------------------------

export type SubmissionState = "submitted" | "accepted" | "needs_another_photo"
/** `submitted`: by the author. `attached`: by a manager/admin. `reconciled`: carried across menus. */
export type SubmissionOrigin = "submitted" | "attached" | "reconciled"
export type ReviewDecision = "accept" | "needs_another_photo"

export type EvidenceAsset = {
  id: string
  /** Scoped evidence route (signs a 60 s URL per request), or null. */
  thumbnailUrl: string | null
  previewUrl: string | null
  width: number | null
  height: number | null
  /** False when the photo was deleted or is no longer ready. */
  available: boolean
}

export type SubmissionView = {
  /** The photo's coverage item id. */
  id: string
  /** Pass as `expectedRevision` when reviewing, withdrawing or moving it. */
  revision: number
  state: SubmissionState
  origin: SubmissionOrigin
  venueId: string
  /** London month of submission: the period it can be credited to. */
  period: PeriodKey
  uploadedPeriod: PeriodKey
  requirement: { id: string; title: string | null } | null
  asset: EvidenceAsset
  /** The uploader. Authorship never transfers. */
  author: { id: string; displayName: string; active: boolean }
  submittedById: string
  submittedAt: Instant
  /** Own photo, submitted by the author, uploaded and submitted in the same month. */
  countsTowardMonthly: boolean
  decision: {
    decision: ReviewDecision
    /** Required for needs_another_photo. */
    reason: string | null
    decidedAt: Instant
    decidedBy: PersonRef
    /** The reviewer is the photo's author. */
    selfReview: boolean
    /** Accepted after the submission period ended (credited to that period). */
    lateAcceptance: boolean
  } | null
  /** Retired or reconciled requirement: kept as history. */
  archived: boolean
  replacesSubmissionId: string | null
}

export type AssetIneligibleReason =
  | "not_found"
  | "not_ready"
  | "not_image"
  | "wrong_venue"
  | "uploader_inactive"
  | "already_submitted"
  | "counted_elsewhere"
  | "declined_here"
  | "outside_period"
  | "evidence_removed"

/** A ready photo the caller could submit (own) or attach (manager/admin). */
export type SubmittablePhoto = {
  assetId: string
  /** Existing authorised media routes. */
  thumbnailUrl: string | null
  previewUrl: string | null
  width: number | null
  height: number | null
  uploadedAt: Instant
  uploadedPeriod: PeriodKey
  uploader: { id: string; displayName: string; active: boolean }
  /** Uploaded this month: submitting it by its author can earn monthly credit. */
  countsTowardMonthly: boolean
  /** The photo's live (submitted or accepted) item, if any. */
  live: {
    submissionId: string
    state: "submitted" | "accepted"
    requirementId: string | null
  } | null
  eligible: boolean
  reason: AssetIneligibleReason | null
}

export type SkippedPhoto = { assetId: string; reason: AssetIneligibleReason }

/** One photo written by submit or attach. Reload views for the full record. */
export type SubmittedPhoto = {
  submissionId: string
  assetId: string
  state: SubmissionState
  revision: number
  /** Already live on this task: nothing new was written. */
  reused: boolean
}

export type ReviewedSubmission = {
  submissionId: string
  state: SubmissionState
  revision: number
  selfReview: boolean
}

// ---- Staff views ------------------------------------------------------------------

export type MyAssignment = {
  requirement: RequirementView
  /** An open assignment: only then can the caller submit photos to it. */
  assigned: boolean
  /** Assigned and the task is current. */
  canSubmit: boolean
  /** Newest first, including "needs another photo" reasons. */
  mySubmissions: SubmissionView[]
  myAccepted: number
  myPending: number
}

export type MyTasksView = {
  scope: CoverageScope
  period: PeriodView
  /** The current venue's monthly target, or null without a venue. */
  monthly: MonthlyProgress | null
  /** Open assignments at the current venue: overdue first, then by due date. */
  assignments: MyAssignment[]
  /** Open "needs another photo" requests not yet answered by a replacement. */
  needsAnotherPhoto: SubmissionView[]
  pendingReview: number
}

export type MyMonthView = {
  period: PeriodView
  /** One per venue with a target or credit that month (a transfer can give two). */
  monthly: MonthlyProgress[]
  /** Newest first (at most 100). */
  submissions: SubmissionView[]
}

export type StaffMonthView = {
  period: PeriodView
  monthly: MonthlyProgress | null
  /** Photos at this venue only; a transferred person's old-venue history stays there. */
  submissions: SubmissionView[]
}

// ---- Amenity facts --------------------------------------------------------------

export type AmenityFactView = {
  id: string | null
  templateKey: CoverageTemplateKey
  title: string
  presence: AmenityPresence
  facts: string | null
  policy: string | null
  confirmed: boolean
  confirmedBy: PersonRef | null
  confirmedAt: Instant | null
  supportingAssets: EvidenceAsset[]
  /** Pass as `expectedRevision`; null before the first save. */
  revision: number | null
  requirementId: string | null
}

// ---- Venue coverage and menus ---------------------------------------------------

export type MenuState =
  | "no_menu"
  | "needs_setup"
  | "menu_changed"
  | "reconciliation_pending"
  | "current"

export type VenueCoverageSummary = {
  venue: CoverageVenue & { active: boolean }
  applicable: number
  satisfied: number
  needsSetup: number
  notApplicable: number
  pendingReview: number
  overdue: number
  needsReassignment: number
  amenityUnknown: number
  menuState: MenuState
  pendingReconciliation: number
  /** Every applicable requirement satisfied, nothing needs setup, menu coverage current. */
  complete: boolean
}

export type MenuPlanView = {
  id: string
  status: MenuPlanStatus
  menuVersionId: string
  revision: number
  reconciliationRequired: boolean
  reconciledAt: Instant | null
  confirmedAt: Instant | null
  createdAt: Instant
}

export type MenuSectionOption = {
  sectionId: string
  name: string
  kind: string
  position: number
}

export type MenuCoverageView = {
  venue: CoverageVenue
  menuState: MenuState
  activeVersion: {
    id: string
    title: string
    activatedAt: Instant | null
    sections: MenuSectionOption[]
  } | null
  draftPlan: MenuPlanView | null
  currentPlan: MenuPlanView | null
  /** Requirements of the draft plan, being configured. */
  draft: RequirementView[]
  /** Requirements of the confirmed plan. */
  current: RequirementView[]
  /** Superseded-plan requirements waiting for explicit reconciliation. */
  superseded: RequirementView[]
}

export type VenueCoverageView = {
  summary: VenueCoverageSummary
  period: PeriodView
  /** Every requirement except retired ones; group by `kind` in the UI. */
  requirements: RequirementView[]
}

// ---- Grants, preparation, oversight ---------------------------------------------

export type GrantRevokeKind =
  "revoked" | "venue_changed" | "deactivated" | "role_changed"

export type ManagerGrantView = {
  id: string
  staff: { id: string; displayName: string; active: boolean }
  /** The person's current venue (a mismatch makes the grant ineffective). */
  staffVenueId: string | null
  venue: CoverageVenue
  grantedBy: PersonRef
  grantedAt: Instant
  grantReason: string | null
  revokedAt: Instant | null
  /** Null for automatic revocations (transfer, deactivation, role change). */
  revokedByName: string | null
  revokeKind: GrantRevokeKind | null
  revokeReason: string | null
  effective: boolean
  /**
   * Held by a staff account (made before venue manager accounts existed).
   * Still in effect during the transition; converting the person replaces it.
   */
  legacyStaffGrant?: boolean
}

export type PreparationRunView = {
  id: string
  period: PeriodKey
  /** Null: every active venue. */
  venueId: string | null
  trigger: "scheduled" | "manual"
  startedAt: Instant
  finishedAt: Instant
  status: "succeeded" | "failed"
  staffConsidered: number
  targetsCopied: number
  placeholdersCreated: number
  alreadyPresent: number
  /** Template checklist requirements added (every in-scope active venue). */
  candidatesAdded: number
  /** SQLSTATE only; never raw database text. */
  errorCode: string | null
}

export type PreparationStatusView = {
  period: PeriodView
  lastRunAt: Instant | null
  lastStatus: "succeeded" | "failed" | null
  lastSuccessAt: Instant | null
  lastFailureAt: Instant | null
  lastErrorCode: string | null
  staffWithoutTarget: number
  targetsNeedingSetup: number
}

export type MissingPeriod = {
  venue: CoverageVenue
  period: PeriodKey
  staffWithoutTarget: number
}

export type GroupOverviewRow = {
  venue: CoverageVenue
  /** Effective grants only. */
  managers: PersonRef[]
  coverage: {
    applicable: number
    satisfied: number
    needsSetup: number
    pendingReview: number
    overdue: number
    needsReassignment: number
    amenityUnknown: number
    menuState: MenuState
    complete: boolean
  }
  participation: {
    staff: number
    targetsSet: number
    targetsNeedingSetup: number
    staffWithoutTarget: number
    complete: number
    acceptedPhotos: number
  }
  selfReviews: number
  lastPreparation: { at: Instant; status: "succeeded" | "failed" } | null
}

export type SelfReviewView = {
  eventId: string
  submissionId: string
  venue: CoverageVenue
  author: PersonRef
  decision: ReviewDecision | "reconciled"
  reason: string | null
  decidedAt: Instant
  asset: EvidenceAsset
}

// ---- Our menu: menu items with an accepted photo ----------------------------------
// A separate measure from monthly targets and section coverage. Eligible items
// are the active menu's food and drinks items that are not archived; an item is
// covered when a reviewer accepted at least one ready, undeleted still image
// labelled with it.

/**
 * `no_menu`: the venue has no active menu. `empty`: an active menu without
 * food or drinks items. `ready`: totals and sections are filled. (The app adds
 * its own `unavailable` state for a load failure.)
 */
export type OurMenuState = "no_menu" | "empty" | "ready"

/** Review state of one photo for one item. `withdrawn` and `invalidated` are final. */
export type ItemPhotoState =
  | "accepted"
  | "better_photo_requested"
  | "needs_recheck"
  | "withdrawn"
  | "invalidated"

export type ItemPhotoDecision = "accept" | "better_photo"

export type OurMenuTotals = {
  /** Distinct eligible items on the active menu. */
  eligible: number
  /** Items with at least one accepted photo. */
  covered: number
  /** eligible - covered. */
  gaps: number
  /** Items with a photo waiting for a recheck after a menu change. */
  needsRecheck: number
}

/** Reviewer-only figures (managers of the venue and admins); null for everyone else. */
export type OurMenuReviewFigures = {
  /** Labelled photos waiting for a decision (or a recheck). */
  pendingCandidates: number
  /** Upload time of the oldest waiting photo, or null when none wait. */
  oldestCandidateAt: Instant | null
}

export type OurMenuSection = {
  sectionId: string
  name: string
  kind: "food" | "drinks"
  position: number
  eligible: number
  covered: number
  needsRecheck: number
  review: OurMenuReviewFigures | null
}

export type OurMenuView = {
  venue: CoverageVenue
  menuState: OurMenuState
  /** The active menu version, or null with `no_menu`. */
  menuVersionId: string | null
  totals: OurMenuTotals
  /** Food and drinks sections with eligible items, in menu order. */
  sections: OurMenuSection[]
  review: OurMenuReviewFigures | null
  /** True for the venue's manager and admins. */
  canReview: boolean
}

export type MenuItemVariant = { variantId: string; name: string }

export type OurMenuItem = {
  itemId: string
  sectionId: string
  sectionName: string
  sectionKind: "food" | "drinks"
  name: string
  description: string | null
  variants: MenuItemVariant[]
  covered: boolean
  /** Distinct accepted photos with an available image. */
  acceptedCount: number
  needsRecheck: boolean
  /** The primary accepted photo (scoped item-photo routes), or null for a gap. */
  primary: { photoId: string; asset: EvidenceAsset } | null
  /** Pass as `expectedRevision` to review, withdraw or set a primary for this item. */
  itemRevision: number
  review: { candidates: number; oldestCandidateAt: Instant | null } | null
}

/** A labelled photo a reviewer can decide for one item (and variant). */
export type ItemPhotoCandidate = {
  /** The label row (asset, item, variant): the paging key. */
  labelId: string
  asset: EvidenceAsset
  uploadedAt: Instant
  labelledAt: Instant
  item: { id: string; name: string; sectionName: string }
  variant: MenuItemVariant | null
  /**
   * The label names a variant the active menu no longer offers: its recheck
   * can only be withdrawn (review refuses an unavailable variant).
   */
  variantRemoved: boolean
  uploader: { id: string; displayName: string; active: boolean }
  /** The caller's own photo: a decision is recorded as self-review. */
  self: boolean
  /** The live decision, or null when not decided yet. */
  photo: {
    id: string
    state: Exclude<ItemPhotoState, "withdrawn" | "invalidated">
    isPrimary: boolean
  } | null
  itemRevision: number
}

export type ReviewedItemPhoto = {
  photoId: string
  itemId: string
  state: ItemPhotoState
  isPrimary: boolean
  itemRevision: number
  selfReview: boolean
}

export type WithdrawnItemPhoto = {
  photoId: string
  state: ItemPhotoState
  itemRevision: number
  /** The item's primary photo now, or null when the item reopened as a gap. */
  newPrimaryPhotoId: string | null
}

export type PrimaryItemPhoto = { photoId: string; itemRevision: number }

/** The uploader's own live item decisions (for "Accepted for menu use"). */
export type MyMenuPhotoState = {
  photoId: string
  assetId: string
  itemId: string
  itemName: string
  variantId: string | null
  variantName: string | null
  state: Exclude<ItemPhotoState, "withdrawn" | "invalidated">
  isPrimary: boolean
  /** The reviewer's note: what a better photo needs (or an accept note). */
  reason: string | null
}

export type ItemPhotoSelfReviewView = {
  eventId: string
  photoId: string
  venue: CoverageVenue
  author: PersonRef
  item: { id: string; name: string; variantName: string | null }
  decision: ItemPhotoDecision
  reason: string | null
  decidedAt: Instant
  asset: EvidenceAsset
}

// ---- Results ---------------------------------------------------------------------

export type CoverageErrorCode =
  | "unauthenticated"
  | "account_inactive"
  | "not_permitted"
  | "wrong_venue"
  | "not_found"
  | "invalid_input"
  | "needs_setup"
  | "revision_conflict"
  | "state_conflict"
  | "asset_ineligible"
  | "unavailable"

export type CoverageFailure = {
  ok: false
  code: CoverageErrorCode
  status: 400 | 401 | 403 | 404 | 409 | 503
  /** Plain language, safe to show. */
  message: string
  /** invalid_input: keyed by input field. */
  fieldErrors?: Partial<Record<string, string>>
  /** revision_conflict: the record's revision now (null when it did not exist yet). */
  currentRevision?: number | null
  /** asset_ineligible: why each photo could not be used. */
  assetErrors?: SkippedPhoto[]
}

export type CoverageResult<T = object> = ({ ok: true } & T) | CoverageFailure

export type Page<T> = { items: T[]; nextCursor: string | null }

// ---- Inputs ------------------------------------------------------------------------
// Every service re-validates its input: Server Actions are public POST endpoints.

/**
 * Venue-scoped operations. A manager omits `venueId` (their effective managed
 * venue is used) or passes exactly that venue; anything else is `wrong_venue`.
 * Admins must pass it.
 */
export type VenueScoped = { venueId?: string | null }

/**
 * Generated once per user intent (a UUID), kept across retries of that intent,
 * replaced after success or when the input changes. A replay returns the first
 * outcome with `replayed: true`; the same key with different input is `state_conflict`.
 */
export type RequestKeyed = { requestId: string }

export type MyAssignmentInput = { requirementId: string }
export type MyMonthInput = { period: PeriodKey }
export type SubmittablePhotosInput = {
  /** Null: a monthly-only submission (photos uploaded this month). */
  requirementId: string | null
  cursor?: string | null
}
export type SubmitPhotosInput = RequestKeyed & {
  requirementId: string | null
  /** 1..10 distinct own ready photos. */
  assetIds: string[]
  /** Answers a "needs another photo" item of the same requirement. */
  replacesSubmissionId?: string | null
}

export type VenueRosterInput = VenueScoped & { period?: PeriodKey | null }
export type StaffMonthInput = VenueScoped & {
  staffId: string
  period: PeriodKey
}
export type VenueRequirementInput = VenueScoped & { requirementId: string }
export type ReviewQueueInput = VenueScoped & {
  /** Default "submitted" (the review queue, oldest first). "all" lists every state. */
  state?: SubmissionState | "all" | null
  requirementId?: string | null
  staffId?: string | null
  period?: PeriodKey | null
  newestFirst?: boolean
  cursor?: string | null
}
export type VenuePhotosInput = VenueScoped & {
  /** Computes eligibility for attaching to this requirement. */
  requirementId?: string | null
  uploaderId?: string | null
  cursor?: string | null
}

export type ReviewSubmissionInput = RequestKeyed & {
  submissionId: string
  expectedRevision: number
  decision: ReviewDecision
  /** 1..500 characters; required for needs_another_photo. */
  reason?: string | null
}
export type AttachPhotosInput = VenueScoped &
  RequestKeyed & {
    requirementId: string
    /** 1..10 distinct ready photos uploaded at the requirement's venue. */
    assetIds: string[]
    /** Also accept them in the same transaction. */
    acceptNow?: boolean
  }

export type CreateRequirementInput = VenueScoped &
  RequestKeyed & {
    kind: "service" | "venue_specific"
    /** 1..120 characters. */
    title: string
    /** Up to 2000 characters. */
    guidance?: string | null
    /** 1..200. */
    photoTarget: number
    dueOn?: LocalDate | null
  }
export type UpdateRequirementInput = {
  requirementId: string
  expectedRevision: number
  patch: {
    title?: string
    guidance?: string | null
    photoTarget?: number
    dueOn?: LocalDate | null
  }
}
export type SetRequirementStatusInput = {
  requirementId: string
  expectedRevision: number
  status: "active" | "not_applicable" | "retired"
  /** Required for not_applicable and retired (1..500 characters). */
  reason?: string | null
}
export type SetRequirementAssigneesInput = {
  requirementId: string
  /** The full desired set (up to 50). */
  assigneeIds: string[]
  reason?: string | null
}
export type SetAmenityFactInput = VenueScoped & {
  templateKey: CoverageTemplateKey
  expectedRevision: number | null
  presence: AmenityPresence
  facts?: string | null
  policy?: string | null
  /** Records the caller as confirmer. Unknown presence cannot be confirmed. */
  confirm: boolean
  /** Desired set of supporting photos (up to 20); omit or null to keep them. */
  supportingAssetIds?: string[] | null
}
export type SetMonthlyTargetInput = VenueScoped & {
  staffId: string
  period: PeriodKey
  /** 1..500. */
  targetCount: number
  /** Within the period; defaults to its last day. */
  dueOn?: LocalDate | null
  /** Required to change a set current-period target, and for any past period (admin only). */
  reason?: string | null
  /** Null when creating the row. */
  expectedRevision: number | null
}

export type StartMenuCoverageInput = VenueScoped & { menuVersionId: string }
export type MenuPlanInput = { planId: string; expectedRevision: number }
export type ReconcileMenuRequirementInput = {
  /** A requirement of the superseded plan. */
  fromRequirementId: string
  /** A current requirement of the confirmed plan, or null to carry nothing. */
  toRequirementId: string | null
  /** Accepted photos to carry; null carries all with available evidence. */
  submissionIds: string[] | null
  reason: string
}

export type ManagerGrantsInput = {
  venueId?: string | null
  includeRevoked?: boolean
}
export type GrantCandidatesInput = { venueId: string }
export type GrantVenueManagerInput = {
  staffId: string
  venueId: string
  reason?: string | null
}
export type RevokeVenueManagerInput = { grantId: string; reason: string }

export type PrepareMonthInput = VenueScoped
export type GroupOverviewInput = { period?: PeriodKey | null }
export type SelfReviewsInput = {
  venueId?: string | null
  period?: PeriodKey | null
  cursor?: string | null
}
export type PreparationRunsInput = {
  venueId?: string | null
  cursor?: string | null
}

/**
 * Our menu reads. Staff (managers included) read their current venue and may
 * omit `venueId` or pass exactly that venue; admins must pass it.
 */
export type OurMenuInput = VenueScoped
export type OurMenuItemsInput = VenueScoped & {
  sectionId?: string | null
  /** Only items still needing a photo. */
  gapsOnly?: boolean
  /** Name or alias search, up to 80 characters. */
  query?: string | null
  cursor?: string | null
}
export type ItemPhotoCandidatesInput = VenueScoped & {
  itemId?: string | null
  /** Also list accepted and better-photo decisions (an item's review screen). */
  includeReviewed?: boolean
  cursor?: string | null
}
export type ReviewItemPhotoInput = RequestKeyed & {
  assetId: string
  itemId: string
  /** The label's variant, or null for the item itself. */
  variantId?: string | null
  decision: ItemPhotoDecision
  /** The item's `itemRevision`. */
  expectedRevision: number
  /** 1..500 characters; required for better_photo. */
  reason?: string | null
  /** Accept as the item's primary photo (the first accepted photo always is). */
  makePrimary?: boolean
}
export type WithdrawItemPhotoInput = RequestKeyed & {
  photoId: string
  expectedRevision: number
  /** 1..500 characters. */
  reason: string
}
export type SetPrimaryItemPhotoInput = RequestKeyed & {
  photoId: string
  expectedRevision: number
}
/** 1..100 distinct asset ids. */
export type MyMenuPhotoStatesInput = { assetIds: string[] }
export type ItemPhotoSelfReviewsInput = SelfReviewsInput
