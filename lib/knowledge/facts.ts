// Facts and freshness (Full App v1 S1-FACTS; spec §9.2, §9.3, §10, §14.3,
// §18.1). Types for the fact reads and commands in
// supabase/migrations/20261118104000_facts_freshness.sql, and the pure
// mappings that mirror its SQL (a unit test holds the two together).

/** Spec §10 "Fact verification": kept apart from the answer value. */
export const FACT_VERIFICATION_STATES = [
  "unconfirmed",
  "confirmed",
  "check_due",
  "superseded",
  "withdrawn",
] as const
export type FactVerificationState = (typeof FACT_VERIFICATION_STATES)[number]

/** The spec's words for each state (spec §10). */
export const FACT_VERIFICATION_LABEL: Record<FactVerificationState, string> = {
  unconfirmed: "Unconfirmed",
  confirmed: "Confirmed",
  check_due: "Check due",
  superseded: "Superseded",
  withdrawn: "Withdrawn",
}

/**
 * The resolver's slot status, reason and detail as a verification state, or
 * null for a question that is out of scope (not on the venue's list). Mirrors
 * private.knowledge_fact_verification. A slot never reads Superseded: that
 * state belongs to an earlier answer in its history
 * (factHistoryVerification).
 */
export function factVerificationState(
  status: string,
  reason: string | null,
  detail: string | null
): FactVerificationState | null {
  if (status === "available") return "confirmed"
  if (reason === "withdrawn") return "withdrawn"
  // A qualified answer (Limited, Conditional) is confirmed; v1 withholds it.
  if (reason === "stale" && detail === "qualified_answer") return "confirmed"
  // Overdue, reopened, evidence lost, schema replaced, or a reported change.
  if (reason === "stale" || reason === "disputed") return "check_due"
  if (
    (reason === "unknown" || reason === "not_enabled") &&
    detail === "not_enabled"
  )
    return null
  return "unconfirmed"
}

/** An assertion's resolution in the history (state-model §4.3). */
export function factHistoryVerification(
  resolution: "proposed" | "current" | "superseded" | "withdrawn"
): FactVerificationState {
  switch (resolution) {
    case "proposed":
      return "unconfirmed"
    case "current":
      return "confirmed"
    case "superseded":
      return "superseded"
    case "withdrawn":
      return "withdrawn"
  }
}

/** Spec §9.2 source types, derived (mirrors private.knowledge_fact_source_type). */
export const FACT_SOURCE_TYPES = [
  "operating_policy",
  "business_record",
  "manager_inspection",
  "staff_observation_confirmed",
  "staff_observation",
  "unrecorded",
] as const
export type FactSourceType = (typeof FACT_SOURCE_TYPES)[number]

export const FACT_SOURCE_LABEL: Record<FactSourceType, string> = {
  operating_policy: "Operating policy",
  business_record: "Business record",
  manager_inspection: "Manager inspection",
  staff_observation_confirmed: "Staff check, confirmed by a manager",
  staff_observation: "Staff check",
  unrecorded: "Not recorded",
}

export function factSourceType(input: {
  sourceOrigin: string | null
  sourceBasis: string | null
  valueSchema: string | null
  detail: Record<string, unknown> | null
  confirmationBasis: string | null
}): FactSourceType {
  const authority = input.detail?.authority
  const authoritySource =
    authority && typeof authority === "object" && !Array.isArray(authority)
      ? (authority as Record<string, unknown>).source
      : undefined
  if (input.valueSchema === "policy" && authoritySource === "written_policy")
    return "operating_policy"
  if (
    input.sourceOrigin === "legacy_fact" ||
    input.sourceOrigin === "external_source"
  )
    return "business_record"
  if (input.sourceBasis === "venue_manager" || input.sourceBasis === "admin")
    return "manager_inspection"
  if (input.sourceBasis === "staff")
    return input.confirmationBasis === "venue_manager" ||
      input.confirmationBasis === "admin"
      ? "staff_observation_confirmed"
      : "staff_observation"
  return "unrecorded"
}

/** One question of `knowledge_fact_states` (managers and admins). */
export type FactStateView = {
  key: string
  category: string
  question: string
  checkId: string
  /** Counts toward fact coverage (spec §18.1); a confirmed Not applicable does not. */
  applicable: boolean
  verification: FactVerificationState | null
  /** The same for guests: past the public check date it is check_due. */
  publicVerification: FactVerificationState | null
  /** The answer recorded, shown to managers even while it is due. */
  answer: "yes" | "no" | "not_applicable" | "unknown" | null
  /** The value a consumer may use now; null unless confirmed. */
  valueInUse: "yes" | "no" | "not_applicable" | null
  reason: string | null
  detail: string | null
  conditions: Record<string, unknown> | null
  limitations: string | null
  sourceType: FactSourceType | null
  confirmationBasis: "venue_manager" | "admin" | "self" | "rule" | null
  /** YYYY-MM-DD in the venue's timezone. */
  verifiedOn: string | null
  nextCheckDue: string | null
  /** "manager" when a manager brought the next check forward. */
  nextCheckSetBy: "manager" | null
  publicNextCheckDue: string | null
  revision: number
  questionVersion: number
  valueSchema: string | null
  submissionId: string | null
}

/** Spec §18.1 confirmed fact coverage: numerator over denominator. */
export type FactCoverageView = {
  venueId: string
  numerator: number
  denominator: number
  checkDue: number
  unconfirmed: number
  withdrawn: number
  /** Confirmed and current for guests too (public check date). */
  publicNumerator: number
  byCategory: { category: string; numerator: number; denominator: number }[]
}

/**
 * The one percentage rule for "n of N" (S3-R2, S3-E2E-2 F5): one decimal
 * place, a trailing ".0" dropped ("50%", "83.3%"). It never rounds up to
 * 100% while something is still missing (999 of 1000 is "99.9%") and never
 * down to 0% once something counts (1 of 2000 is "0.1%"). Null when there is
 * nothing to count.
 */
export function percentWords(n: number, d: number): string | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null
  let tenths = Math.round((n / d) * 1000)
  if (n < d && tenths >= 1000) tenths = 999
  if (n > 0 && tenths <= 0) tenths = 1
  return `${tenths / 10}%`
}

/** "5 of 6" with the percentage as secondary text (FA-8). */
export function coverageWords(
  n: number,
  d: number
): {
  text: string
  percent: string | null
} {
  return { text: `${n} of ${d}`, percent: percentWords(n, d) }
}

/** Spec §14.3: one structured answer for a consuming service. */
export type GuestAnswer = {
  key: string
  verification: FactVerificationState
  /** Only a currently confirmed fact carries a value; never a guessed No. */
  value: "yes" | "no" | "not_applicable" | null
  /** Structured detail; for guests only the question's publishable fields. */
  conditions: Record<string, unknown>
  verifiedOn: string | null
  nextCheckDue: string | null
  source: {
    type: FactSourceType
    id: string
    idKind: "contribution" | "submission"
  } | null
  revision: number | null
  questionVersion: number | null
}

export type GuestAnswersView = {
  venueId: string
  use: "internal" | "public"
  answers: GuestAnswer[]
}

/** `knowledge_reconfirm` ("Still right"). */
export type ReconfirmResult = {
  checkId: string
  submissionId: string
  verification: FactVerificationState | null
  verifiedOn: string | null
  nextCheckDue: string | null
  slotRevision: number
  rechecksClosed: { taskId: string; use: "internal" | "public" }[]
}

/** Spec §9.3 for an accepted space photo (private.area_photo_freshness). */
export const SPACE_PHOTO_STATES = [
  "current",
  "check_due",
  "needs_replacement",
  "expired",
] as const
export type SpacePhotoState = (typeof SPACE_PHOTO_STATES)[number]

export const SPACE_PHOTO_LABEL: Record<SpacePhotoState, string> = {
  current: "Current",
  check_due: "Check due",
  needs_replacement: "Needs replacing",
  expired: "Expired",
}

export type SpacePhotoFreshnessRow = {
  label_id: string
  asset_id: string
  subject_id: string
  subject_kind: string
  subject_label: string
  state: SpacePhotoState
  cause:
    | "review_date_passed"
    | "change_reported"
    | "replacement_needed"
    | "end_date_passed"
    | null
  reason: string | null
  verified_on: string | null
  next_check_due: string | null
  due_soon: boolean
  valid_until: string | null
}

/** Whether a space photo counts toward current coverage (spec §9.3). */
export const spacePhotoCounts = (state: SpacePhotoState) => state === "current"
