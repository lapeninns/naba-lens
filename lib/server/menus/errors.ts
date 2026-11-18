// Maps catalogue RPC failures to Outcome statuses and plain messages
// (contract amendment A2.2: by error message = code, or SQLSTATE; never by
// HTTP status, because PostgREST answers P0002 with 500). Pure.

import { redactError } from "@/lib/server/log/redact"

type DbError =
  | { message?: string; code?: string; details?: string | null }
  | null
  | undefined

export type MenuFailure = {
  ok: false
  status: 400 | 401 | 403 | 404 | 409 | 503
  message: string
}

const fail = (status: MenuFailure["status"], message: string): MenuFailure => ({
  ok: false,
  status,
  message,
})

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

const NOT_FOUND: Record<string, string> = {
  venue_not_found: "This venue could not be found.",
  menu_version_not_found: "This menu version could not be found.",
  menu_item_not_found: "This menu item could not be found.",
  menu_item_suggestion_not_found: "This suggestion could not be found.",
  menu_special_not_found: "This special could not be found.",
  menu_change_request_not_found: "This request could not be found.",
  check_not_found: "This check could not be found.",
}

const STATE_CONFLICT: Record<string, string> = {
  menu_version_not_draft:
    "This version is no longer a draft. Reload the page to see its current state.",
  menu_version_not_active:
    "This version is no longer active. Reload the page to see its current state.",
  menu_item_suggestion_not_open:
    "This suggestion was already handled. Reload the page to see it.",
  menu_review_pending:
    "Resolve every uncertain match and save the draft before activating it.",
  menu_schedule_exists:
    "Another draft is already scheduled for this venue. Unschedule it first.",
  menu_item_unavailable:
    "This dish is not on the current menu. Reload the page to see it.",
  menu_special_not_suggested:
    "This suggestion was already decided. Reload the page to see it.",
  menu_special_not_running:
    "This special has already ended. Reload the page to see it.",
  menu_change_request_not_open:
    "This request was already decided. Reload the page to see it.",
}

const INVALID: Record<string, string> = {
  menu_empty: "Add at least one item before activating this menu.",
  menu_item_wrong_venue: "An item in this menu belongs to a different venue.",
  invalid_menu_source: "The menu's source details are invalid.",
  invalid_suggestion_status:
    "Choose whether to link or dismiss the suggestion.",
  invalid_suggestion_item: "Choose a menu item to link the suggestion to.",
  note_too_long: "The note is too long.",
  menu_schedule_in_past: "Choose a time at least a few minutes from now.",
  menu_schedule_too_far: "Choose a time within the next year.",
  reason_required: "Give a reason.",
  reason_too_long: "The reason is too long.",
  invalid_until: "Choose a date from today, within the next year.",
  invalid_dates: "Choose an end date from today, on or after the start date.",
  invalid_display_name: "Give a name of up to 120 characters.",
  invalid_name: "Give a name of up to 120 characters.",
  invalid_description: "The description is too long.",
  invalid_detail: "Describe the change in up to 1000 characters.",
  item_required: "Choose the dish this change is about.",
  core_check_admin_only:
    "Only an admin can change whether a core check applies.",
}

/**
 * `context` names the operation in the redacted server log for unexpected
 * failures (503); expected failures are not logged.
 */
export function menuRpcFailure(error: DbError, context: string): MenuFailure {
  const message = error?.message ?? ""
  const code = error?.code ?? ""

  if (message === "menu_version_conflict") {
    const revision = detailJson(error)?.revision
    return fail(
      409,
      typeof revision === "number"
        ? `This draft was saved elsewhere (now revision ${revision}). Your changes have not been saved.`
        : "This draft was saved elsewhere. Your changes have not been saved."
    )
  }
  if (message === "menu_retirements_unconfirmed") {
    const count = detailJson(error)?.retirements
    return fail(
      409,
      typeof count === "number"
        ? `This draft retires ${count === 1 ? "1 item" : `${count} items`} from the current menu. Confirm the retirements and try again.`
        : "Confirm the items this draft retires and try again."
    )
  }
  if (
    message === "menu_special_conflict" ||
    message === "menu_change_request_conflict" ||
    message === "venue_scope_conflict"
  )
    return fail(409, "This changed elsewhere. Reload the page and try again.")
  if (message in STATE_CONFLICT) return fail(409, STATE_CONFLICT[message])
  if (message in NOT_FOUND) return fail(404, NOT_FOUND[message])
  if (message === "invalid_menu_document") {
    const detail = detailJson(error)
    const path = typeof detail?.path === "string" ? detail.path : ""
    const reason =
      typeof detail?.message === "string" ? detail.message : "Invalid value"
    return fail(400, `The menu is invalid. ${path ? `${path}: ` : ""}${reason}`)
  }
  if (message in INVALID) return fail(400, INVALID[message])
  if (message === "core_check_admin_only") return fail(403, INVALID[message])
  if (
    message === "not_venue_manager" ||
    message === "wrong_venue" ||
    message === "not_venue_member"
  )
    return fail(403, "You can only change menus at your own venue.")
  if (message === "not_active_user")
    return fail(403, "Your account is not active.")
  if (message === "not_active_admin" || code === "42501")
    return fail(403, "Only an active admin can change menus.")
  if (code === "P0002") return fail(404, "This could not be found.")
  if (code === "22023") return fail(400, "This request is invalid.")
  if (code === "40001")
    return fail(409, "This changed elsewhere. Reload the page and try again.")

  console.error(`[menus] ${context} failed`, {
    error: redactError(new Error(`${code || "unknown"}: ${message}`)),
  })
  return fail(503, "Menus could not be updated right now. Try again shortly.")
}

/** A read failed (RLS returns empty rather than erroring, so this is outage). */
export function menuReadFailure(error: DbError, context: string): MenuFailure {
  console.error(`[menus] ${context} read failed`, {
    error: redactError(
      new Error(`${error?.code || "unknown"}: ${error?.message ?? ""}`)
    ),
  })
  return fail(503, "Menus could not be loaded right now. Try again shortly.")
}
