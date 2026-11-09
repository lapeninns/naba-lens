export type ReaderErrorCode =
  | "invalid_request"
  | "unsupported_version"
  | "unauthenticated"
  | "forbidden"
  | "venue_not_found"
  | "method_not_allowed"
  | "request_too_large"
  | "rate_limited"
  | "reader_unavailable"
  | "internal_error"

export type ReaderFailure = {
  code: ReaderErrorCode
  retryAfterSeconds?: number
  supported?: readonly string[]
}

const STATUS: Record<ReaderErrorCode, number> = {
  invalid_request: 400,
  unsupported_version: 400,
  unauthenticated: 401,
  forbidden: 403,
  venue_not_found: 404,
  method_not_allowed: 405,
  request_too_large: 414,
  rate_limited: 429,
  reader_unavailable: 503,
  internal_error: 500,
}

// Fixed text: a message never echoes a credential, a parameter or venue data.
const MESSAGES: Record<ReaderErrorCode, string> = {
  invalid_request: "The request is not valid. Check its parameters.",
  unsupported_version: "This schema version is not supported.",
  unauthenticated: "A valid reader credential is required.",
  forbidden: "This credential may not make this request.",
  venue_not_found: "Venue not found.",
  method_not_allowed: "Only GET and HEAD are supported.",
  request_too_large: "The request URL is too long.",
  rate_limited: "Too many requests for this consumer. Try again later.",
  reader_unavailable: "The reader is unavailable. Try again later.",
  internal_error: "Something went wrong. Quote the request ID.",
}

export const NO_STORE = "private, no-store"

export function errorResponse(
  failure: ReaderFailure,
  requestId: string,
  head = false
): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": NO_STORE,
    "x-request-id": requestId,
  })
  if (failure.code === "unauthenticated")
    headers.set("www-authenticate", 'Bearer realm="knowledge-reader"')
  if (failure.code === "method_not_allowed") headers.set("allow", "GET, HEAD")
  if (failure.retryAfterSeconds !== undefined)
    headers.set("retry-after", String(failure.retryAfterSeconds))
  const body = {
    error: {
      code: failure.code,
      message: MESSAGES[failure.code],
      requestId,
      ...(failure.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: failure.retryAfterSeconds }
        : {}),
      ...(failure.supported ? { supported: failure.supported } : {}),
    },
  }
  return new Response(head ? null : JSON.stringify(body), {
    status: STATUS[failure.code],
    headers,
  })
}
