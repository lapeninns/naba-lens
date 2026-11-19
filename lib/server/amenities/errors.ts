// Maps amenity RPC failures to AmenityFailure values. By error message (the
// exception code) or SQLSTATE, never by HTTP status: PostgREST answers named
// exceptions with 500. Unexpected failures are logged redacted and become 503.

import {
  EVIDENCE_RULES,
  type AmenityErrorCode,
  type AmenityFailure,
  type EvidenceRule,
} from "@/lib/amenities/contract"
import type { CoverageFailure } from "@/lib/server/coverage/types"
import { redactError } from "@/lib/server/log/redact"

export type DbError =
  | { message?: string; code?: string; details?: string | null }
  | null
  | undefined

type AssetReason = NonNullable<AmenityFailure["assetReason"]>

const STATUS: Record<AmenityErrorCode, AmenityFailure["status"]> = {
  unauthenticated: 401,
  account_inactive: 403,
  not_permitted: 403,
  wrong_venue: 403,
  not_found: 404,
  invalid_input: 400,
  needs_setup: 409,
  revision_conflict: 409,
  state_conflict: 409,
  asset_ineligible: 409,
  evidence_rule_unmet: 400,
  unavailable: 503,
}

export function failure(
  code: AmenityErrorCode,
  message: string,
  extra: Omit<AmenityFailure, "ok" | "code" | "status" | "message"> = {}
): AmenityFailure {
  return { ok: false, code, status: STATUS[code], message, ...extra }
}

export function invalid(
  fieldErrors: Partial<Record<string, string>>,
  message = "Check the highlighted fields."
): AmenityFailure {
  return failure("invalid_input", message, { fieldErrors })
}

export const NOT_FOUND = failure(
  "not_found",
  "This amenity check could not be found. Reload the page."
)
export const NOT_PERMITTED = failure(
  "not_permitted",
  "You do not have permission to do this. Reload the page."
)

const UNAVAILABLE_MESSAGE =
  "Amenities could not be loaded or saved right now. Try again shortly."

export function unavailableFailure(
  context: string,
  error?: DbError
): AmenityFailure {
  console.error(`[amenities] ${context} failed`, {
    error: redactError(
      new Error(`${error?.code || "unknown"}: ${error?.message ?? ""}`)
    ),
  })
  return failure("unavailable", UNAVAILABLE_MESSAGE)
}

/** Scope failures from the shared coverage context (same codes, no asset list). */
export function fromCoverage(f: CoverageFailure): AmenityFailure {
  return failure(
    f.code,
    f.code === "unavailable" ? UNAVAILABLE_MESSAGE : f.message,
    {
      ...(f.fieldErrors ? { fieldErrors: f.fieldErrors } : {}),
      ...(f.currentRevision !== undefined
        ? { currentRevision: f.currentRevision }
        : {}),
    }
  )
}

function detailJson(error: DbError): unknown {
  if (!error?.details) return null
  try {
    return JSON.parse(error.details) as unknown
  } catch {
    return error.details
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

const isRule = (v: unknown): v is EvidenceRule =>
  (EVIDENCE_RULES as readonly unknown[]).includes(v)

const ASSET_REASONS: readonly AssetReason[] = [
  "not_found",
  "not_ready",
  "other_venue",
  "not_own",
  "deleted",
]

const NOT_PERMITTED_MESSAGES: Record<string, string> = {
  not_active_admin: "Only an active admin can do this.",
  not_venue_manager:
    "Only this venue's manager or an admin can do this. Reload the page.",
  amenity_not_permitted:
    "Only the assigned person, the venue's manager or an admin can do this. Reload the page.",
}

const NOT_FOUND_MESSAGES: Record<string, string> = {
  venue_not_found: "This venue could not be found.",
  amenity_check_not_found: NOT_FOUND.message,
  amenity_key_not_found:
    "A catalogue entry could not be found. Reload the page.",
}

const STATE_CONFLICT_MESSAGES: Record<string, string> = {
  amenity_check_archived:
    "This check is archived. Restore it first, or reload the page.",
  idempotency_key_reused:
    "This submission was already used for a different finding. Reload and try again.",
  staff_not_eligible:
    "This person is not active staff at this venue now. Reload and try again.",
}

const FIELD_ERRORS: Record<string, [field: string, message: string]> = {
  invalid_answer: ["answer", "Choose Yes, No or Not applicable."],
  reason_required: ["reason", "Enter a reason."],
  invalid_reason: ["reason", "Use up to 500 characters."],
  invalid_finding: ["finding", "Use up to 2000 characters."],
  invalid_limitations: ["limitations", "Use up to 2000 characters."],
  invalid_notes: ["notes", "Use up to 2000 characters."],
  invalid_asset_list: ["assetIds", "Choose up to 10 photos or videos."],
  invalid_key_list: ["keys", "Choose at least one catalogue entry."],
  invalid_wifi_metadata: [
    "wifi",
    "Enter where and when you tested the Wi-Fi, and both speeds.",
  ],
  invalid_reopen_preset: ["preset", "Choose a reason."],
  redaction_not_confirmed: [
    "redactionConfirmed",
    "Confirm the Wi-Fi password and join QR code are covered.",
  ],
}

const ASSET_MESSAGES: Record<AssetReason, string> = {
  not_found: "A photo or video could not be found. It may have been deleted.",
  not_ready:
    "A photo or video is still processing. Try again when it is ready.",
  other_venue: "A photo or video was taken at a different venue.",
  not_own: "You can only attach your own photos and videos.",
  deleted: "A photo or video was deleted, so it cannot be used.",
}

const RULE_MESSAGES: Record<EvidenceRule, string> = {
  photo: "Yes needs at least one photo.",
  video: "Yes needs at least one video.",
  either: "Yes needs at least one photo or video.",
  both: "Yes needs at least one photo and one video.",
}

export function assetMessage(reason: AssetReason): string {
  return ASSET_MESSAGES[reason]
}

export function ruleMessage(rule: EvidenceRule): string {
  return RULE_MESSAGES[rule]
}

/**
 * `context` names the operation in the redacted server log for unexpected
 * failures; expected failures are not logged.
 */
export function amenityRpcFailure(
  error: DbError,
  context: string
): AmenityFailure {
  const message = error?.message ?? ""
  const code = error?.code ?? ""

  if (message === "amenity_conflict") {
    const details = detailJson(error)
    const revision = isRecord(details) ? details.revision : null
    return failure(
      "revision_conflict",
      "This check changed while you were looking at it. Reload to see the latest version, then try again.",
      { currentRevision: typeof revision === "number" ? revision : null }
    )
  }
  if (message === "not_active_user")
    return failure("account_inactive", "Your account is not active.")
  if (message in NOT_PERMITTED_MESSAGES)
    return failure("not_permitted", NOT_PERMITTED_MESSAGES[message])
  if (message in NOT_FOUND_MESSAGES)
    return failure("not_found", NOT_FOUND_MESSAGES[message])
  if (message === "amenities_not_enabled")
    return failure(
      "needs_setup",
      "Amenities are not enabled for this venue yet. Ask an admin to enable them."
    )
  if (message === "venue_inactive")
    return failure(
      "needs_setup",
      "This venue is not active, so amenity checks can't be changed."
    )
  if (message in STATE_CONFLICT_MESSAGES)
    return failure("state_conflict", STATE_CONFLICT_MESSAGES[message])
  if (message in FIELD_ERRORS) {
    const [field, text] = FIELD_ERRORS[message]
    return invalid({ [field]: text })
  }
  if (message === "evidence_rule_unmet") {
    // Details carry the rule, as plain text, a JSON string or {"rule": ...}.
    const details = detailJson(error)
    const rule = isRule(details)
      ? details
      : isRecord(details) && isRule(details.rule)
        ? details.rule
        : undefined
    return failure(
      "evidence_rule_unmet",
      rule ? RULE_MESSAGES[rule] : "Add the photos or videos this check needs.",
      rule ? { rule } : {}
    )
  }
  if (message === "evidence_not_eligible") {
    const details = detailJson(error)
    const assetId =
      isRecord(details) && typeof details.assetId === "string"
        ? details.assetId
        : undefined
    const raw = isRecord(details) ? details.reason : undefined
    const reason: AssetReason = ASSET_REASONS.includes(raw as AssetReason)
      ? (raw as AssetReason)
      : "not_ready"
    return failure("asset_ineligible", ASSET_MESSAGES[reason], {
      ...(assetId ? { assetId } : {}),
      assetReason: reason,
    })
  }
  if (code === "42501") return NOT_PERMITTED
  if (code === "P0002") return NOT_FOUND
  if (code === "22023") return invalid({}, "This request is invalid.")
  if (code === "40001")
    return failure(
      "revision_conflict",
      "This check changed while you were looking at it. Reload and try again.",
      { currentRevision: null }
    )
  return unavailableFailure(context, error)
}
