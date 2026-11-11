// Maps use-grant RPC failures (B05-m1) by the exception message, never by
// HTTP status: PostgREST answers named exceptions with 500. Anything not
// listed is logged redacted and becomes a retryable 503.

import type { DbError } from "@/lib/server/amenities/errors"
import { redactError } from "@/lib/server/log/redact"

import type { UseErrorCode, UseFailure } from "./types"

const STATUS: Record<UseErrorCode, UseFailure["status"]> = {
  disabled: 409,
  not_permitted: 403,
  not_found: 404,
  invalid_input: 400,
  clearance_incomplete: 400,
  destination_unavailable: 409,
  subject_not_publishable: 409,
  profile_unavailable: 409,
  state_conflict: 409,
  unavailable: 503,
}

export function mediaUseFailure(
  code: UseErrorCode,
  message: string,
  fieldErrors?: Partial<Record<string, string>>
): UseFailure {
  return {
    ok: false,
    status: STATUS[code],
    code,
    message,
    ...(fieldErrors ? { fieldErrors } : {}),
  }
}

export function mediaUseInvalid(
  fieldErrors: Partial<Record<string, string>>
): UseFailure {
  return mediaUseFailure(
    "invalid_input",
    "Check the highlighted fields.",
    fieldErrors
  )
}

const MAPPING: Record<string, [UseErrorCode, string]> = {
  not_active_user: ["not_permitted", "Your account is not active."],
  not_public_use_granter: [
    "not_permitted",
    "Only a named granter or an admin can grant or withdraw use.",
  ],
  own_upload_not_grantable: [
    "not_permitted",
    "You cannot grant use of your own upload. Ask another granter.",
  ],
  media_asset_not_found: ["not_found", "This file could not be found."],
  media_use_grant_not_found: [
    "not_found",
    "This use grant could not be found.",
  ],
  use_subject_not_found: [
    "not_found",
    "What this photo shows is no longer available. Reload the page.",
  ],
  use_destination_unavailable: [
    "destination_unavailable",
    "This destination is not available for this venue.",
  ],
  subject_not_publishable: [
    "subject_not_publishable",
    "This answer cannot have a public photo yet.",
  ],
  profile_unavailable: [
    "profile_unavailable",
    "Public versions of this file cannot be made yet.",
  ],
  derivative_profile_required: [
    "invalid_input",
    "Public use needs a public version profile.",
  ],
  clearance_incomplete: [
    "clearance_incomplete",
    "Confirm every item on the current checklist.",
  ],
  invalid_use_purpose: ["invalid_input", "Choose what the photo is used for."],
  invalid_use_subject: ["invalid_input", "Choose what the photo shows."],
  invalid_use_period: [
    "invalid_input",
    "The end date must be after the start date, and the start cannot be in the past.",
  ],
  invalid_request_key: ["invalid_input", "Reload the page and try again."],
  invalid_reason_code: ["invalid_input", "Choose a reason."],
  invalid_note: ["invalid_input", "The note is too long."],
  idempotency_key_reused: [
    "state_conflict",
    "This request was already sent with different details. Reload the page.",
  ],
}

export function mediaUseRpcFailure(
  error: DbError,
  context: string
): UseFailure {
  const message = error?.message ?? ""
  const hit = MAPPING[message]
  if (hit) return mediaUseFailure(hit[0], hit[1])
  console.error(`[media-use] ${context} failed`, {
    error: redactError(error),
  })
  return mediaUseFailure(
    "unavailable",
    "Something went wrong. Try again in a moment."
  )
}
