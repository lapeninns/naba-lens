// One error shape for every route and Server Function (spec §13; checklist
// S13-error-taxonomy). Each failure says which file or field it is about, what
// the person can do next, and whether trying again can help. Distinct codes for
// sign-in required, inactive account, forbidden scope, not found, invalid input,
// stale version, unsupported media, size limit and a retryable service failure.
// Messages are plain words safe to show: database text, stack traces and
// secrets never reach them (the cause is logged redacted by the caller).
//
// Existing domains keep their own error types for now; they map onto this one
// with toApiError (coverage-style failures) or fromDbError (a raw RPC error).

export type ApiErrorCode =
  | "unauthenticated"
  | "account_inactive"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "stale_version"
  | "conflict"
  | "unsupported_media"
  | "too_large"
  | "unavailable"

export type ApiError = {
  ok: false
  code: ApiErrorCode
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 503
  /** Plain words, safe to show. */
  message: string
  /** The input field the error is about, when there is one. */
  field?: string
  /** The file the error is about (client file id or asset id). */
  fileId?: string
  /** What the person can do now. */
  nextAction: string
  /** True when the same request may work later without changes. */
  retryable: boolean
}

const DEFAULTS: Record<
  ApiErrorCode,
  Pick<ApiError, "status" | "message" | "nextAction" | "retryable">
> = {
  unauthenticated: {
    status: 401,
    message: "You are signed out.",
    nextAction: "Sign in again.",
    retryable: false,
  },
  account_inactive: {
    status: 403,
    message: "Your account is not active.",
    nextAction: "Ask your manager to reactivate it.",
    retryable: false,
  },
  forbidden: {
    status: 403,
    message: "You do not have permission to do this.",
    nextAction: "Reload the page. If it still happens, ask an admin.",
    retryable: false,
  },
  not_found: {
    status: 404,
    message: "This could not be found.",
    nextAction: "Reload the page.",
    retryable: false,
  },
  invalid_input: {
    status: 400,
    message: "Check the highlighted field.",
    nextAction: "Correct it and try again.",
    retryable: false,
  },
  stale_version: {
    status: 409,
    message: "Someone else changed this since you opened it.",
    nextAction:
      "Reload to see the latest version, then make your change again.",
    retryable: false,
  },
  conflict: {
    status: 409,
    message: "This cannot be done in its current state.",
    nextAction: "Reload the page.",
    retryable: false,
  },
  unsupported_media: {
    status: 415,
    message: "This file type is not supported.",
    nextAction:
      "Choose a JPEG, PNG, WebP or HEIC photo, or an MP4 or MOV video.",
    retryable: false,
  },
  too_large: {
    status: 413,
    message: "This file is too large.",
    nextAction: "Choose a smaller file.",
    retryable: false,
  },
  unavailable: {
    status: 503,
    message: "This could not be done right now.",
    nextAction: "Try again in a moment.",
    retryable: true,
  },
}

export function apiError(
  code: ApiErrorCode,
  extra: Partial<
    Pick<ApiError, "message" | "field" | "fileId" | "nextAction">
  > = {}
): ApiError {
  const base = DEFAULTS[code]
  const error: ApiError = {
    ok: false,
    code,
    status: base.status,
    message: extra.message ?? base.message,
    nextAction: extra.nextAction ?? base.nextAction,
    retryable: base.retryable,
  }
  if (extra.field) error.field = extra.field
  if (extra.fileId) error.fileId = extra.fileId
  return error
}

/**
 * A raw database or PostgREST error onto the envelope, by exception message
 * and SQLSTATE (PostgREST answers named exceptions with 500, so never by HTTP
 * status). `fields` maps an exception message (e.g. "invalid_quiet_hours") to
 * the field and words to show; anything unknown is a retryable unavailable.
 */
export function fromDbError(
  error: { message?: string; code?: string } | null | undefined,
  fields: Record<string, { field: string; message: string }> = {}
): ApiError {
  const message = error?.message ?? ""
  const sqlstate = error?.code ?? ""
  const known = fields[message]
  if (known)
    return apiError("invalid_input", {
      field: known.field,
      message: known.message,
    })
  if (message === "not_active_user") return apiError("account_inactive")
  if (sqlstate === "PGRST301" || message === "JWT expired")
    return apiError("unauthenticated")
  if (sqlstate === "42501") return apiError("forbidden")
  if (sqlstate === "40001" || message === "stale_revision")
    return apiError("stale_version")
  if (sqlstate === "22023") return apiError("invalid_input")
  if (sqlstate === "P0002" || message === "not_found")
    return apiError("not_found")
  return apiError("unavailable")
}

const BY_STATUS: Record<number, ApiErrorCode> = {
  400: "invalid_input",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "too_large",
  415: "unsupported_media",
}

/**
 * A domain failure with a code and status (CoverageFailure, AccountResult
 * and the like) onto the envelope. Its message is kept: those are already
 * plain words.
 */
export function toApiError(failure: {
  code?: string
  status?: number
  message?: string
  fieldErrors?: Partial<Record<string, string>>
}): ApiError {
  const direct = failure.code as ApiErrorCode | undefined
  let code: ApiErrorCode =
    direct && direct in DEFAULTS
      ? direct
      : failure.code === "not_permitted" || failure.code === "wrong_venue"
        ? "forbidden"
        : failure.code === "revision_conflict"
          ? "stale_version"
          : (BY_STATUS[failure.status ?? 0] ?? "unavailable")
  if (failure.status === 503) code = "unavailable"
  const field = failure.fieldErrors
    ? Object.keys(failure.fieldErrors)[0]
    : undefined
  return apiError(code, {
    message: failure.message,
    field,
  })
}

/** The envelope as a Route Handler response, never cached. */
export function errorResponse(error: ApiError): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        field: error.field,
        fileId: error.fileId,
        nextAction: error.nextAction,
        retryable: error.retryable,
      },
    },
    {
      status: error.status,
      headers: {
        "Cache-Control": "private, no-store",
        ...(error.retryable ? { "Retry-After": "30" } : {}),
      },
    }
  )
}
