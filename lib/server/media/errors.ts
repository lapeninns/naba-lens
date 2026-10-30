import type { Outcome } from "./types"

type DbError = { message?: string; code?: string } | null | undefined

/**
 * Maps the named exceptions raised by the database functions onto HTTP statuses
 * and plain messages. PostgREST reports every one of them as HTTP 500 (for
 * example `media_asset_not_found`), so routes must never pass that status on.
 */
export function rpcFailure(error: DbError): Outcome<never> {
  const message = error?.message ?? ""
  if (message.includes("media_asset_not_found")) {
    return { ok: false, status: 404, message: "This file could not be found." }
  }
  if (message.includes("not_active_staff")) {
    return {
      ok: false,
      status: 403,
      message: "Your account cannot upload right now.",
    }
  }
  if (
    message.includes("venue_unavailable") ||
    message.includes("venue_inactive")
  ) {
    return {
      ok: false,
      status: 403,
      message:
        "Your account is not assigned to an active venue, so uploads are paused. Ask an admin to check your venue.",
    }
  }
  if (
    message.includes("invalid_extension") ||
    message.includes("invalid_upload_key")
  ) {
    return {
      ok: false,
      status: 400,
      message: "This upload request is invalid.",
    }
  }
  return {
    ok: false,
    status: 503,
    message: "Something went wrong. Try again in a moment.",
  }
}

/** Plain-language reasons for `lib/media` validation codes. */
export function validationMessage(code: string): string {
  switch (code) {
    case "unsupported_type":
    case "unsupported_video":
    case "mime_mismatch":
      return "This file type is not supported. Use JPEG, PNG, WebP, HEIC, MP4, MOV or WebM."
    case "type_mismatch":
      return "This file's content does not match its type."
    case "file_too_large":
      return "This file is larger than the upload limit."
    case "size_mismatch":
    case "invalid_size":
      return "The stored file is incomplete. Upload it again."
    case "pixel_limit":
      return "This photo has too many pixels to process."
    case "decode_timeout":
      return "This file took too long to process."
    case "probe_limit":
      return "This video's layout could not be read within the processing limits."
    case "invalid_video":
    case "corrupt_media":
    default:
      return "This file is damaged or could not be read."
  }
}
