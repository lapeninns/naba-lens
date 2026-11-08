"use server"

import { revalidatePath } from "next/cache"

import {
  convertToManager,
  convertToStaff,
  inviteStaff,
  resendInvitation,
  setStaffActive,
  updateStaffAccount,
  type AccountResult,
  type StaffAccountStatus,
} from "@/lib/server/accounts"
import { accountsContext } from "@/lib/server/accounts/request"

// Server Functions are reachable by direct POST. Each one below hands the
// request's own session to lib/server/accounts, which re-reads the caller's
// current profile and refuses anyone but an active admin before acting.
// Errors are returned, not thrown, because Next hides thrown messages.

export type InviteActionResult =
  | { status: "sent" }
  | { status: "partial"; message: string }
  | {
      status: "error"
      error: string
      fieldErrors?: Partial<Record<string, string>>
    }

export type AccountActionResult =
  /** `status`: the account's new status after an activation change. */
  | { ok: true; warning?: string; status?: StaffAccountStatus }
  | {
      ok: false
      error: string
      fieldErrors?: Partial<Record<string, string>>
    }

function refreshStaffPages() {
  revalidatePath("/admin/staff", "layout")
}

/** A conversion also changes the grants on Venue managers. */
function refreshConvertedPages() {
  refreshStaffPages()
  revalidatePath("/admin/coverage/managers")
}

function toActionResult(
  result: AccountResult<{ warning?: string; status?: StaffAccountStatus }>
): AccountActionResult {
  if (result.ok) {
    const ok: AccountActionResult = { ok: true }
    if (result.warning) ok.warning = result.warning
    if (result.status) ok.status = result.status
    return ok
  }
  return result.fieldErrors
    ? { ok: false, error: result.error, fieldErrors: result.fieldErrors }
    : { ok: false, error: result.error }
}

/** The partial-invite message in the Invite staff dialog's words. */
function emailNotSentMessage(values: unknown, fallback: string) {
  const name =
    values && typeof values === "object" && "displayName" in values
      ? String(values.displayName).trim()
      : ""
  if (!name) return fallback
  const first = name.split(/\s+/)[0]
  return `${name}'s account exists, but the invitation email didn't go. Close this, then choose Resend invitation in ${first}'s More actions menu. Don't create the account again.`
}

export async function inviteStaffAction(
  values: unknown
): Promise<InviteActionResult> {
  const result = await inviteStaff(await accountsContext(), values)
  if (result.status !== "error") refreshStaffPages()
  switch (result.status) {
    case "sent":
      return { status: "sent" }
    case "partial":
      return {
        status: "partial",
        message: emailNotSentMessage(values, result.message),
      }
    default:
      return result.fieldErrors
        ? {
            status: "error",
            error: result.error,
            fieldErrors: result.fieldErrors,
          }
        : { status: "error", error: result.error }
  }
}

export async function resendInvitationAction(
  staffId: unknown
): Promise<AccountActionResult> {
  return toActionResult(
    await resendInvitation(await accountsContext(), staffId)
  )
}

export async function updateStaffAccountAction(
  staffId: unknown,
  values: unknown
): Promise<AccountActionResult> {
  const result = await updateStaffAccount(
    await accountsContext(),
    staffId,
    values
  )
  if (result.ok) refreshStaffPages()
  return toActionResult(result)
}

export async function setStaffActiveAction(
  staffId: unknown,
  active: unknown
): Promise<AccountActionResult> {
  const result = await setStaffActive(await accountsContext(), staffId, active)
  if (result.ok) refreshStaffPages()
  return toActionResult(result)
}

/**
 * Staff account → venue manager account at the chosen venue, with a reason.
 * Returns the coverage result shape for useCoverageAction.
 */
export async function convertToManagerAction(input: unknown) {
  const result = await convertToManager(await accountsContext(), input)
  if (result.ok) refreshConvertedPages()
  return result
}

/** Venue manager account → staff account at the chosen venue, with a reason. */
export async function convertToStaffAction(input: unknown) {
  const result = await convertToStaff(await accountsContext(), input)
  if (result.ok) refreshConvertedPages()
  return result
}
