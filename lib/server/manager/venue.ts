import "server-only"

import {
  isHistorySource,
  parseCursor,
  parseMenuCheck,
  parseReviewers,
  parseVenueHistory,
  parseVenueSummary,
  REVIEWER_ROLES,
  type ManagerVenueSummary,
  type MenuMonthCheck,
  type ReviewerRole,
  type VenueHistoryPage,
  type VenueReviewers,
} from "@/lib/manager/venue"
import { apiError, fromDbError, type ApiError } from "@/lib/server/http/errors"
import type { MediaActor } from "@/lib/server/media/types"

/**
 * S2-MGR (Full App v1): the manager's venue reads and commands (spec §7 M1,
 * M5, §9.3). Every call runs as the signed-in person; the database decides
 * the venue (a manager's own, or one an admin names) and refuses everything
 * else. Input is untrusted: it comes from Server Functions.
 */

export type VenueResult<T> = ({ ok: true } & T) | ApiError

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID.test(v)

const DB_FIELDS: Record<string, { field: string; message: string }> = {
  reason_too_long: { field: "reason", message: "Use up to 500 characters." },
  note_too_long: { field: "note", message: "Use up to 500 characters." },
  invalid_reviewer_role: {
    field: "role",
    message: "Choose main or backup reviewer.",
  },
}

function failure(error: { message?: string; code?: string }): ApiError {
  if (error.message === "reviewer_not_eligible")
    return apiError("invalid_input", {
      field: "profileId",
      message: "Choose someone who is a manager at this venue.",
    })
  if (error.message === "no_active_menu")
    return apiError("conflict", {
      message: "This venue has no active menu to confirm.",
      nextAction: "Ask an admin to activate the menu.",
    })
  if (error.message === "not_venue_manager") return apiError("forbidden")
  return fromDbError(error, DB_FIELDS)
}

const shapeError = () =>
  apiError("unavailable", { message: "The venue could not be read." })

/** Optional venue: managers omit it (their own venue); admins name one. */
function venueArg(venueId: unknown): { p_venue_id?: string } | ApiError {
  if (venueId === undefined || venueId === null || venueId === "") return {}
  return isUuid(venueId)
    ? { p_venue_id: venueId }
    : apiError("not_found", { message: "This venue could not be found." })
}

const isError = (v: object): v is ApiError => "ok" in v && v.ok === false

function cleanText(
  v: unknown,
  field: string
): { value: string | null } | ApiError {
  if (v === undefined || v === null) return { value: null }
  if (typeof v !== "string")
    return apiError("invalid_input", { field, message: "Check this field." })
  const value = v.trim()
  if (value.length > 500)
    return apiError("invalid_input", {
      field,
      message: "Use up to 500 characters.",
    })
  return { value: value || null }
}

export async function getVenueReviewers(
  actor: MediaActor,
  venueId?: string | null
): Promise<VenueResult<{ reviewers: VenueReviewers }>> {
  const args = venueArg(venueId)
  if (isError(args)) return args
  const { data, error } = await actor.db.rpc("venue_review_assignments", args)
  if (error) return failure(error)
  const reviewers = parseReviewers(data)
  return reviewers ? { ok: true, reviewers } : shapeError()
}

/** Nominate (or clear, with no person) the venue's main or backup reviewer. */
export async function setVenueReviewer(
  actor: MediaActor,
  input: unknown
): Promise<VenueResult<{ reviewers: VenueReviewers }>> {
  if (input === null || typeof input !== "object")
    return apiError("invalid_input")
  const i = input as Record<string, unknown>
  if (!REVIEWER_ROLES.includes(i.role as ReviewerRole))
    return apiError("invalid_input", {
      field: "role",
      message: "Choose main or backup reviewer.",
    })
  if (!isUuid(i.venueId))
    return apiError("not_found", { message: "This venue could not be found." })
  const profileId =
    i.profileId === null || i.profileId === "" ? null : i.profileId
  if (profileId !== null && !isUuid(profileId))
    return apiError("invalid_input", {
      field: "profileId",
      message: "Choose someone who is a manager at this venue.",
    })
  const reason = cleanText(i.reason, "reason")
  if (isError(reason)) return reason
  const { data, error } = await actor.db.rpc("set_venue_reviewer", {
    p_venue_id: i.venueId,
    p_role: i.role as ReviewerRole,
    // A null person clears the role (the generated type has no null).
    p_profile_id: profileId as string,
    ...(reason.value ? { p_reason: reason.value } : {}),
  })
  if (error) return failure(error)
  const reviewers = parseReviewers(data)
  return reviewers ? { ok: true, reviewers } : shapeError()
}

export async function getManagerVenueSummary(
  actor: MediaActor,
  venueId?: string | null
): Promise<VenueResult<{ summary: ManagerVenueSummary }>> {
  const args = venueArg(venueId)
  if (isError(args)) return args
  const { data, error } = await actor.db.rpc("manager_venue_summary", args)
  if (error) return failure(error)
  const summary = parseVenueSummary(data)
  return summary ? { ok: true, summary } : shapeError()
}

/** "Still right" for this month's active menu (spec §9.3). */
export async function confirmMenuMonth(
  actor: MediaActor,
  input: unknown
): Promise<VenueResult<{ check: MenuMonthCheck }>> {
  const i = (input ?? {}) as Record<string, unknown>
  const args = venueArg(i.venueId)
  if (isError(args)) return args
  const note = cleanText(i.note, "note")
  if (isError(note)) return note
  const { data, error } = await actor.db.rpc("confirm_menu_month", {
    ...args,
    ...(note.value ? { p_note: note.value } : {}),
  })
  if (error) return failure(error)
  const check = parseMenuCheck(data)
  return check ? { ok: true, check } : shapeError()
}

export async function getVenueHistory(
  actor: MediaActor,
  input: unknown
): Promise<VenueResult<{ page: VenueHistoryPage }>> {
  const i = (input ?? {}) as Record<string, unknown>
  const args = venueArg(i.venueId)
  if (isError(args)) return args
  const source = i.source === undefined || i.source === "" ? null : i.source
  if (source !== null && !isHistorySource(source))
    return apiError("invalid_input", { field: "source" })
  const before = i.before === undefined ? null : parseCursor(i.before)
  if (i.before !== undefined && i.before !== null && !before)
    return apiError("invalid_input", { field: "before" })
  const limit =
    typeof i.limit === "number" && Number.isInteger(i.limit) ? i.limit : 30
  const { data, error } = await actor.db.rpc("venue_history", {
    ...args,
    ...(source ? { p_source: source } : {}),
    ...(before ? { p_before: before } : {}),
    p_limit: Math.min(Math.max(limit, 1), 100),
  })
  if (error) return failure(error)
  const page = parseVenueHistory(data)
  return page ? { ok: true, page } : shapeError()
}
