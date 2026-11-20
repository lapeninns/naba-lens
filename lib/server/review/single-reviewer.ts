import { logger } from "@/lib/server/log/logger"
import "server-only"

// FA-9 single-reviewer venue (S3-R1 K6): the admin reads and changes the
// setting through their own session; the database checks the admin, the
// reason and the venue revision (20261118120000_single_reviewer_venue.sql).

import { isUuid } from "@/lib/server/coverage/validate"
import { apiError, fromDbError, type ApiError } from "@/lib/server/http/errors"
import { redactError } from "@/lib/server/log/redact"
import type { Db } from "@/lib/server/media/types"
import {
  parseReviewSettings,
  type ReviewSettings,
} from "@/lib/review/single-reviewer"

type Caller = { db: Db }
type Result<T> = ({ ok: true } & T) | ApiError

const WORDS: Record<string, ApiError> = {
  reason_required: apiError("invalid_input", {
    field: "reason",
    message: "Say why the setting is changing.",
  }),
  reason_too_long: apiError("invalid_input", {
    field: "reason",
    message: "Write the reason in 500 characters or fewer.",
  }),
  venue_conflict: apiError("stale_version", {
    message:
      "Someone else changed this venue since you opened it. Reload, then make your change again.",
  }),
  venue_not_found: apiError("not_found", {
    message: "This venue could not be found.",
  }),
}

function failed(
  what: string,
  error: { message?: string; code?: string } | null
): ApiError {
  const known = error?.message ? WORDS[error.message] : undefined
  if (known) return known
  const mapped = fromDbError(error)
  if (mapped.code === "unavailable")
    logger.error(`[review] ${what} failed`, redactError(error))
  return mapped
}

/** The venue's single-reviewer setting and the self-decisions to spot check. */
export async function getReviewSettings(
  caller: Caller,
  venueId: string
): Promise<Result<{ settings: ReviewSettings }>> {
  if (!isUuid(venueId)) return apiError("not_found")
  const { data, error } = await caller.db.rpc("admin_venue_review_settings", {
    p_venue_id: venueId,
  })
  if (error) return failed("review settings", error)
  const settings = parseReviewSettings(data)
  if (!settings) return failed("review settings (shape)", null)
  return { ok: true, settings }
}

/** Turns single-reviewer on or off, with a reason, against the revision read. */
export async function setSingleReviewer(
  caller: Caller,
  input: {
    venueId: unknown
    enabled: unknown
    reason: unknown
    revision: unknown
  }
): Promise<Result<{ changed: boolean }>> {
  if (!isUuid(input.venueId)) return apiError("not_found")
  if (typeof input.enabled !== "boolean")
    return apiError("invalid_input", { message: "Choose a setting." })
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (!reason) return WORDS.reason_required!
  if ([...reason].length > 500) return WORDS.reason_too_long!
  if (typeof input.revision !== "number" || !Number.isInteger(input.revision))
    return WORDS.venue_conflict!
  const { data, error } = await caller.db.rpc(
    "admin_venue_set_single_reviewer",
    {
      p_venue_id: input.venueId,
      p_enabled: input.enabled,
      p_reason: reason,
      p_revision: input.revision,
    }
  )
  if (error) return failed("single reviewer", error)
  return {
    ok: true,
    changed: (data as { changed?: unknown } | null)?.changed === true,
  }
}
