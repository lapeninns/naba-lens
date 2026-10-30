"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { ROUTES } from "@/lib/auth"
import {
  inviteStaff,
  resendInvitation,
  setStaffActive,
  updateStaffAccount,
  type AccountResult,
} from "@/lib/server/accounts"
import { accountsContext } from "@/lib/server/accounts/request"
import { createClient } from "@/lib/supabase/server"

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
  | { ok: true; warning?: string }
  | {
      ok: false
      error: string
      fieldErrors?: Partial<Record<string, string>>
    }

function refreshStaffPages() {
  revalidatePath("/admin/staff", "layout")
}

function toActionResult(
  result: AccountResult<{ warning?: string }>
): AccountActionResult {
  if (result.ok)
    return result.warning ? { ok: true, warning: result.warning } : { ok: true }
  return result.fieldErrors
    ? { ok: false, error: result.error, fieldErrors: result.fieldErrors }
    : { ok: false, error: result.error }
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
      return { status: "partial", message: result.message }
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

/** Log out from the admin shell (same behaviour as POST /auth/logout). */
export async function signOutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: "local" })
  redirect(`${ROUTES.login}?signed_out=1`)
}
