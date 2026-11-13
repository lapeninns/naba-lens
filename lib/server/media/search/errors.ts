// Maps asset-search RPC failures (B05-m4) by the exception message, never by
// HTTP status: PostgREST answers named exceptions with 500. Anything not
// listed is logged redacted and becomes a retryable 503.

import type { DbError } from "@/lib/server/amenities/errors"
import { redactError } from "@/lib/server/log/redact"

import type { SearchErrorCode, SearchFailure } from "./types"

const STATUS: Record<SearchErrorCode, SearchFailure["status"]> = {
  not_permitted: 403,
  not_found: 404,
  invalid_input: 400,
  unavailable: 503,
}

export function searchFailure(
  code: SearchErrorCode,
  message: string,
  fieldErrors?: Partial<Record<string, string>>
): SearchFailure {
  return {
    ok: false,
    status: STATUS[code],
    code,
    message,
    ...(fieldErrors ? { fieldErrors } : {}),
  }
}

export function searchInvalid(
  fieldErrors: Partial<Record<string, string>>
): SearchFailure {
  return searchFailure(
    "invalid_input",
    "Check the search filters.",
    fieldErrors
  )
}

// Order matters only for messages that contain another; none do today.
const MAPPING: [string, SearchErrorCode, string][] = [
  ["not_active_user", "not_permitted", "Your account is not active."],
  [
    "not_venue_manager",
    "not_permitted",
    "Only venue managers and admins can search photos and videos.",
  ],
  ["wrong_venue", "not_permitted", "You can search your own venue only."],
  ["venue_not_found", "not_found", "This venue could not be found."],
  ["invalid_search_filter", "invalid_input", "Check the search filters."],
  [
    "invalid_search_cursor",
    "invalid_input",
    "This page link has expired. Search again.",
  ],
]

export function searchRpcFailure(
  error: DbError,
  context: string
): SearchFailure {
  const message = error?.message ?? ""
  const hit =
    MAPPING.find(([key]) => message === key) ??
    MAPPING.find(([key]) => message.includes(key))
  // Answer freshness runs only with a venue (B05 follow-up, §11.2).
  if (
    hit?.[0] === "invalid_search_filter" &&
    error?.details === "answerFreshness"
  )
    return searchInvalid({ answerFreshness: "Choose a venue first." })
  if (hit) return searchFailure(hit[1], hit[2])
  console.error(`[asset-search] ${context} failed`, {
    error: redactError(error),
  })
  return searchFailure(
    "unavailable",
    "Something went wrong. Try again in a moment."
  )
}
