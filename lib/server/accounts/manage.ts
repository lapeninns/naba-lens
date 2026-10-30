import type { PostgrestError } from "@supabase/supabase-js"

import { DEACTIVATED_BAN_DURATION } from "./auth-users"
import { staffStatus, type StaffAccountStatus } from "./directory"
import {
  fail,
  FORBIDDEN_MESSAGE,
  requireAdminCaller,
  type AccountError,
  type AccountResult,
  type AccountsContext,
  type Db,
} from "./context"
import { checkAssignableVenue, dbFailed, notFound } from "./invite"
import { isUuid, parseAccountPatch } from "./validation"

type StaffRow = {
  id: string
  role: "staff" | "admin"
  active: boolean
  venue_id: string | null
}

/** A staff profile the calling admin can see, read through RLS. Admins are excluded. */
async function loadStaff(
  caller: Db,
  staffId: unknown
): Promise<{ ok: true; row: StaffRow } | AccountError> {
  if (!isUuid(staffId)) return notFound()
  const { data, error } = await caller
    .from("profiles")
    .select("id, role, active, venue_id")
    .eq("id", staffId)
    .maybeSingle()
  if (error) return dbFailed()
  // Admin accounts are managed only through the bootstrap procedure.
  if (!data || data.role !== "staff") return notFound()
  return { ok: true, row: data }
}

function mapUpdateError(error: PostgrestError): AccountError {
  switch (error.message) {
    case "venue_inactive":
      return fail("venue_inactive", "Choose an active venue.", {
        venueId: "This venue is inactive or no longer exists.",
      })
    case "admin_only_fields":
    case "role_change_forbidden":
    case "self_deactivation_forbidden":
      return fail("forbidden", FORBIDDEN_MESSAGE)
  }
  if (error.code === "42501") return fail("forbidden", FORBIDDEN_MESSAGE)
  console.error("[accounts] profile update failed", { code: error.code })
  return dbFailed()
}

/**
 * Admin edit of a staff account: display name, job title, venue and activation.
 * The update runs as the admin (RLS + the profiles_guard trigger re-check it);
 * a venue change applies to future uploads only, because every media asset
 * keeps the venue snapshotted at reservation.
 */
export async function updateStaffAccount(
  ctx: AccountsContext,
  staffId: unknown,
  raw: unknown
): Promise<AccountResult<{ warning?: string; status?: StaffAccountStatus }>> {
  const auth = await requireAdminCaller(ctx.caller)
  if (!auth.ok) return auth

  const parsed = parseAccountPatch(raw)
  if (!parsed.ok) {
    return fail(
      "invalid_input",
      "Check the highlighted fields.",
      parsed.fieldErrors
    )
  }
  const patch = parsed.value

  const target = await loadStaff(ctx.caller, staffId)
  if (!target.ok) return target

  if (patch.venueId !== undefined && patch.venueId !== target.row.venue_id) {
    const venueError = await checkAssignableVenue(ctx.caller, patch.venueId)
    if (venueError) return venueError
  }

  const update: {
    display_name?: string
    job_title?: string | null
    venue_id?: string
  } = {}
  if (patch.displayName !== undefined) update.display_name = patch.displayName
  if (patch.jobTitle !== undefined) update.job_title = patch.jobTitle
  if (patch.venueId !== undefined && patch.venueId !== target.row.venue_id)
    update.venue_id = patch.venueId

  if (Object.keys(update).length > 0) {
    const { data, error } = await ctx.caller
      .from("profiles")
      .update(update)
      .eq("id", target.row.id)
      .select("id")
    if (error) return mapUpdateError(error)
    if (!data?.length) return notFound()
  }

  if (patch.active !== undefined && patch.active !== target.row.active) {
    return setStaffActive(ctx, target.row.id, patch.active)
  }
  return { ok: true }
}

/**
 * Deactivate or reactivate a staff account.
 *
 * Deactivation writes `profiles.active = false` first; that alone denies every
 * page, Server Function, RLS policy and storage policy on the next request,
 * including from sessions that are already open. It then bans the auth user so
 * refresh tokens and new sign-in links stop working too. If only the ban fails,
 * the account is still deactivated and a warning is returned.
 *
 * Reactivation lifts the ban first, then sets `active = true`, so a failure
 * never leaves an "active" profile that cannot sign in.
 *
 * Retained media is untouched: admins keep seeing an inactive person's assets.
 * On success, `status` is the account's new directory status, so the admin UI
 * can show it at once instead of waiting for a server re-render.
 */
export async function setStaffActive(
  ctx: AccountsContext,
  staffId: unknown,
  active: unknown
): Promise<AccountResult<{ warning?: string; status: StaffAccountStatus }>> {
  const auth = await requireAdminCaller(ctx.caller)
  if (!auth.ok) return auth
  if (typeof active !== "boolean") {
    return fail("invalid_input", "Choose active or inactive.")
  }
  const target = await loadStaff(ctx.caller, staffId)
  if (!target.ok) return target
  const id = target.row.id

  if (!active) {
    if (target.row.active) {
      const { data, error } = await ctx.caller
        .from("profiles")
        .update({ active: false })
        .eq("id", id)
        .select("id")
      if (error) return mapUpdateError(error)
      if (!data?.length) return notFound()
    }
    const { error: banError } = await ctx.service.auth.admin.updateUserById(
      id,
      { ban_duration: DEACTIVATED_BAN_DURATION }
    )
    if (banError) {
      console.error("[accounts] deactivate: session revocation failed", {
        code: banError.code ?? null,
      })
      return {
        ok: true,
        status: "inactive",
        warning:
          "The account is deactivated and blocked from NabaLens. Signing out its other devices failed; they are still refused on their next request.",
      }
    }
    return { ok: true, status: "inactive" }
  }

  const { data: unbanned, error: unbanError } =
    await ctx.service.auth.admin.updateUserById(id, { ban_duration: "none" })
  if (unbanError) {
    console.error("[accounts] reactivate: unban failed", {
      code: unbanError.code ?? null,
    })
    return fail(
      "auth_failed",
      "The account could not be reactivated. Nothing changed. Try again."
    )
  }
  if (!target.row.active) {
    const { data, error } = await ctx.caller
      .from("profiles")
      .update({ active: true })
      .eq("id", id)
      .select("id")
    if (error) return mapUpdateError(error)
    if (!data?.length) return notFound()
  }
  return { ok: true, status: staffStatus(true, unbanned.user) }
}
