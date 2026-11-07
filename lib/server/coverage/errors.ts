// Maps coverage RPC failures to CoverageFailure values. By error message (the
// exception code) or SQLSTATE, never by HTTP status: PostgREST answers named
// exceptions with 500. Unexpected failures are logged redacted and become 503.

import { redactError } from "@/lib/server/log/redact"

import type {
  AssetIneligibleReason,
  CoverageErrorCode,
  CoverageFailure,
} from "./types"

export type DbError =
  | { message?: string; code?: string; details?: string | null }
  | null
  | undefined

const STATUS: Record<CoverageErrorCode, CoverageFailure["status"]> = {
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
  unavailable: 503,
}

export function failure(
  code: CoverageErrorCode,
  message: string,
  extra: Omit<CoverageFailure, "ok" | "code" | "status" | "message"> = {}
): CoverageFailure {
  return { ok: false, code, status: STATUS[code], message, ...extra }
}

export function invalid(
  fieldErrors: Partial<Record<string, string>>,
  message = "Check the highlighted fields."
): CoverageFailure {
  return failure("invalid_input", message, { fieldErrors })
}

export const NOT_FOUND = failure(
  "not_found",
  "This could not be found. Reload the page."
)
export const NOT_PERMITTED = failure(
  "not_permitted",
  "You do not have permission to do this. Reload the page."
)
export const WRONG_VENUE = failure(
  "wrong_venue",
  "This belongs to a different venue."
)

export function unavailableFailure(
  context: string,
  error?: DbError
): CoverageFailure {
  console.error(`[coverage] ${context} failed`, {
    error: redactError(
      new Error(`${error?.code || "unknown"}: ${error?.message ?? ""}`)
    ),
  })
  return failure(
    "unavailable",
    "Coverage could not be loaded or saved right now. Try again shortly."
  )
}

function detailJson(error: DbError): Record<string, unknown> | null {
  if (!error?.details) return null
  try {
    const value: unknown = JSON.parse(error.details)
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const NOT_PERMITTED_MESSAGES: Record<string, string> = {
  not_active_admin: "Only an active admin can do this.",
  not_venue_manager:
    "Only this venue's manager or an admin can do this. Reload the page.",
  not_active_staff: "Only active staff can submit photos.",
  historical_admin_only:
    "Only an admin can change a past month's target, with a reason.",
  requirement_not_assigned:
    "You can add photos to this task only while it is assigned to you.",
}

const NOT_FOUND_MESSAGES: Record<string, string> = {
  venue_not_found: "This venue could not be found.",
  staff_not_found: "This person could not be found.",
  media_asset_not_found:
    "A photo could not be found. It may have been deleted.",
  coverage_requirement_not_found: "This task could not be found.",
  coverage_item_not_found: "This photo could not be found. Reload the page.",
  manager_grant_not_found: "This manager grant could not be found.",
  menu_coverage_plan_not_found: "This menu plan could not be found.",
  menu_version_not_found: "This menu could not be found.",
  amenity_not_found: "This amenity could not be found.",
  menu_item_photo_not_found:
    "This menu photo could not be found. Reload the page.",
}

const FIELD_ERRORS: Record<string, [field: string, message: string]> = {
  invalid_request_key: ["requestId", "This request is invalid. Reload."],
  reason_required: ["reason", "Enter a reason."],
  invalid_reason: ["reason", "Use up to 500 characters."],
  invalid_title: ["title", "Enter a title of up to 120 characters."],
  invalid_guidance: ["guidance", "Use up to 2000 characters."],
  invalid_facts: ["facts", "Use up to 2000 characters."],
  invalid_policy: ["policy", "Use up to 2000 characters."],
  invalid_photo_target: ["photoTarget", "Enter a whole number from 1 to 200."],
  invalid_target_count: ["targetCount", "Enter a whole number from 1 to 500."],
  invalid_due_date: ["dueOn", "Choose a date within the month."],
  invalid_period: ["period", "Choose a month."],
  invalid_kind: ["kind", "Choose a task type."],
  invalid_status: ["status", "Choose a status."],
  invalid_decision: ["decision", "Choose a decision."],
  invalid_presence: ["presence", "Choose present, absent or unknown."],
  invalid_asset_list: ["assetIds", "Choose between 1 and 10 photos."],
  invalid_staff_list: ["assigneeIds", "Choose up to 50 people."],
}

const STATE_CONFLICT_MESSAGES: Record<string, string> = {
  idempotency_key_reused:
    "This request was already used for a different change. Reload and try again.",
  staff_not_eligible:
    "This person is not active staff at this venue now. Reload and try again.",
  requirement_not_open:
    "This task is not open for photos now. Reload the page.",
  requirement_closed: "This task has been retired. Reload the page.",
  menu_version_not_active:
    "This menu is no longer active. Reload to see the current menu.",
  plan_not_draft: "This menu plan was already confirmed or discarded.",
  plan_not_superseded: "This menu section was already reconciled.",
  invalid_transition:
    "This photo was already reviewed. Reload to see the decision.",
  menu_item_not_labelled:
    "This photo is not labelled with this menu item. Label it first, then review it.",
  menu_item_unavailable:
    "This dish or drink is not on the venue's current menu. Reload to see the current menu.",
}

const NEEDS_SETUP_MESSAGES: Record<string, string> = {
  amenity_unconfirmed:
    "Confirm the amenity is present before confirming its photo task.",
  amenity_unknown: "Unknown needs checking before it can be confirmed.",
  venue_inactive: "You need to be assigned to an active venue first.",
}

const EVIDENCE_REASONS: Record<string, AssetIneligibleReason> = {
  not_ready: "not_ready",
  not_image: "not_image",
  other_venue: "wrong_venue",
  inactive_uploader: "uploader_inactive",
  evidence_removed: "evidence_removed",
  outside_period: "outside_period",
}

const EVIDENCE_MESSAGES: Record<AssetIneligibleReason, string> = {
  not_found: "A photo could not be found. It may have been deleted.",
  not_ready: "A photo is still processing. Try again when it is ready.",
  not_image: "Only photos can be used here, not videos.",
  wrong_venue: "A photo was taken at a different venue.",
  uploader_inactive: "A photo belongs to someone who has left.",
  already_submitted: "A photo is already on this task.",
  counted_elsewhere: "A photo is already counted on another task.",
  declined_here: "A photo was marked as needing another photo here.",
  outside_period: "A photo was not uploaded this month.",
  evidence_removed: "The photo was deleted, so it cannot be accepted.",
}

export function assetMessage(reason: AssetIneligibleReason): string {
  return EVIDENCE_MESSAGES[reason]
}

/**
 * `context` names the operation in the redacted server log for unexpected
 * failures; expected failures are not logged. `assetIds` attributes an
 * evidence error when only one photo was involved.
 */
export function coverageRpcFailure(
  error: DbError,
  context: string,
  assetIds: string[] = []
): CoverageFailure {
  const message = error?.message ?? ""
  const code = error?.code ?? ""

  if (message === "coverage_conflict") {
    const revision = detailJson(error)?.revision
    return failure(
      "revision_conflict",
      "This changed while you were looking at it. Reload to see the latest version, then try again.",
      { currentRevision: typeof revision === "number" ? revision : null }
    )
  }
  if (message === "not_active_user")
    return failure("account_inactive", "Your account is not active.")
  if (message in NOT_PERMITTED_MESSAGES)
    return failure("not_permitted", NOT_PERMITTED_MESSAGES[message])
  if (message in NOT_FOUND_MESSAGES)
    return failure("not_found", NOT_FOUND_MESSAGES[message])
  if (message in FIELD_ERRORS) {
    const [field, text] = FIELD_ERRORS[message]
    return invalid({ [field]: text })
  }
  if (message in STATE_CONFLICT_MESSAGES)
    return failure("state_conflict", STATE_CONFLICT_MESSAGES[message])
  if (message in NEEDS_SETUP_MESSAGES)
    return failure("needs_setup", NEEDS_SETUP_MESSAGES[message])
  if (message === "plan_incomplete") {
    const left = detailJson(error)?.needsSetup
    return failure(
      "needs_setup",
      typeof left === "number"
        ? `Set up or exclude every menu section first (${left} left).`
        : "Set up or exclude every menu section first."
    )
  }
  if (
    message === "evidence_not_eligible" ||
    message === "asset_already_submitted"
  ) {
    const reason: AssetIneligibleReason =
      message === "asset_already_submitted"
        ? "counted_elsewhere"
        : (EVIDENCE_REASONS[error?.details ?? ""] ?? "not_ready")
    return failure("asset_ineligible", EVIDENCE_MESSAGES[reason], {
      assetErrors:
        assetIds.length === 1 ? [{ assetId: assetIds[0], reason }] : [],
    })
  }
  if (code === "42501") return NOT_PERMITTED
  if (code === "P0002") return NOT_FOUND
  if (code === "22023") return invalid({}, "This request is invalid.")
  if (code === "40001")
    return failure(
      "revision_conflict",
      "This changed while you were looking at it. Reload and try again.",
      { currentRevision: null }
    )
  return unavailableFailure(context, error)
}
