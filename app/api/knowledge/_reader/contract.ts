import {
  CORE_CHECK_KEYS,
  REDACTION_CONFIRM_KEYS,
} from "@/lib/amenities/contract"

// Internal reader v1: docs/knowledge/internal-reader-api.md is the contract.

export const API_MAJOR = 1
/** `MAJOR.MINOR` response schemas this server can produce. */
export const SUPPORTED_SCHEMAS = ["1.0"] as const

export const AUDIENCES = ["internal"] as const
export type Audience = (typeof AUDIENCES)[number]

export const PURPOSES = ["operations_lookup", "pilot_verification"] as const
export type Purpose = (typeof PURPOSES)[number]

/** The B01 working list: the only question keys v1 accepts. */
export const QUESTION_KEYS: readonly string[] = CORE_CHECK_KEYS

/** Keys whose staff-written text never leaves NabaLens (it could hold a password). */
export const REDACTION_KEYS: readonly string[] = REDACTION_CONFIRM_KEYS

/** Audiences that may receive staff-written text for keys outside REDACTION_KEYS. */
export const STAFF_TEXT_AUDIENCES: readonly Audience[] = ["internal"]

export const LIMITS = {
  maxKeys: 20,
  maxUrlBytes: 2048,
  maxCredentialLength: 512,
  maxCredentialsPerConsumer: 2,
  maxConsumers: 50,
  maxResponseBytes: 1024 * 1024,
  ratePerMinute: 60,
  burst: 10,
  maxConcurrent: 4,
  sourceTimeoutMs: 5000,
} as const

/**
 * Each detail belongs to exactly one reason; a pair outside this table breaks
 * the resolver contract and fails closed. B03 details (b03-design §3.8, §5.2,
 * §7.3, §9.3) are listed before the batch that emits them, so turning one on
 * never turns a whole response into a 500.
 */
export const UNAVAILABLE_DETAILS = {
  unknown: ["not_checked", "unable_to_establish", "not_enabled"],
  not_confirmed: ["pending", "declined", "policy_incomplete"],
  stale: [
    "expired",
    "recheck_requested",
    "evidence_lost",
    "qualified_answer",
    "basis_missing",
    "schema_changed",
    "temporary_until_passed",
  ],
  disputed: ["conflict"],
  withdrawn: ["answer_withdrawn", "confirmation_revoked", "evidence_withdrawn"],
} as const satisfies Record<string, readonly string[]>

/** Reasons the resolver can return; the reader adds the other two itself. */
export type ResolverReason = keyof typeof UNAVAILABLE_DETAILS
export type UnavailableReason =
  ResolverReason | "not_permitted" | "unsupported_version"

export const ANSWER_VALUES = ["yes", "no", "not_applicable"] as const
export type AnswerValue = (typeof ANSWER_VALUES)[number]

export const SOURCE_KINDS = {
  staff: "staff_observation",
  venue_manager: "manager_observation",
  admin: "admin_observation",
} as const
/** Submissions saved before B01 never recorded their author's role. */
export const UNRECORDED_SOURCE_KIND = "observation"

export type ReaderAnswer = {
  key: string
  questionVersion: number | null
  status: "available" | "unavailable"
  value: { type: "yes_no_na"; answer: AnswerValue } | null
  summary: string | null
  conditions: { kind: "limitation" | "reason"; text: string }[]
  provenance: {
    sourceKind: string
    contributionId: string
    /** Contribution and submission IDs are separate spaces; compare within one. */
    idKind: "contribution" | "submission"
    confirmation: {
      authority: "venue_manager" | "admin"
      selfConfirmed: boolean
      savedAt: string
    } | null
    redactionProof: "recorded" | "not_recorded" | null
    evidence: { photos: number; videos: number }
  } | null
  revision: number | null
  freshness: {
    savedAt: string
    observedAt: string | null
    nextCheckDue: string | null
    state: "current" | "due_soon" | "unrated"
  } | null
  unavailable: { reason: UnavailableReason; detail: string | null } | null
}
