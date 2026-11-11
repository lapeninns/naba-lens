// Maps evidence-document RPC failures (B05-m6) by exception message, never
// by HTTP status. Logs carry only a context and the redacted error: no
// document id, filename or path.

import type { DbError } from "@/lib/server/amenities/errors"
import { redactError } from "@/lib/server/log/redact"

import type { DocumentErrorCode, DocumentFailure } from "./types"

const STATUS: Record<DocumentErrorCode, DocumentFailure["status"]> = {
  disabled: 409,
  not_permitted: 403,
  not_found: 404,
  invalid_input: 400,
  invalid_file: 400,
  not_uploaded: 409,
  referenced: 409,
  state_conflict: 409,
  unavailable: 503,
}

export function documentFailure(
  code: DocumentErrorCode,
  message: string,
  fileCode?: string
): DocumentFailure {
  return {
    ok: false,
    status: STATUS[code],
    code,
    message,
    ...(fileCode ? { fileCode } : {}),
  }
}

export const DOCUMENT_NOT_FOUND = documentFailure(
  "not_found",
  "This document could not be found."
)

const MAPPING: Record<string, [DocumentErrorCode, string]> = {
  not_active_user: ["not_permitted", "Your account is not active."],
  not_document_holder: [
    "not_permitted",
    "Only the venue's manager, an admin or the allergen authority can add documents.",
  ],
  venue_inactive: ["not_permitted", "This venue is not active."],
  document_not_found: ["not_found", "This document could not be found."],
  document_referenced: [
    "referenced",
    "This document is evidence for an allergen statement and cannot be deleted.",
  ],
  document_reference_unknown: [
    "unavailable",
    "Something went wrong. Try again in a moment.",
  ],
  too_many_open_uploads: [
    "state_conflict",
    "You have too many unfinished document uploads. Finish or delete them first.",
  ],
  idempotency_key_reused: [
    "state_conflict",
    "This upload was started with different details. Reload and try again.",
  ],
  document_ready_immutable: [
    "state_conflict",
    "This document is already saved.",
  ],
  invalid_upload_key: ["invalid_input", "Reload and try again."],
  invalid_purpose: ["invalid_input", "This upload request is invalid."],
  invalid_filename: ["invalid_input", "This file has no usable name."],
  invalid_size: ["invalid_input", "Documents can be up to 10 MB."],
  invalid_document_ids: ["invalid_input", "Reload and try again."],
}

export function documentRpcFailure(
  error: DbError,
  context: string
): DocumentFailure {
  const hit = MAPPING[error?.message ?? ""]
  if (hit && hit[0] !== "unavailable") return documentFailure(hit[0], hit[1])
  console.error(`[documents] ${context} failed`, { error: redactError(error) })
  return documentFailure(
    "unavailable",
    "Something went wrong. Try again in a moment."
  )
}
