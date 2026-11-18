// Per-venue memberships (Full App v1 S1-PEOPLE; spec §3.1, §3.3, §7 M5,
// §8 A6; FA-22). Every function takes an AccountsContext and lets the
// database decide: the caller's client runs the security definer RPCs from
// 20261118101100/101200, which re-read the caller's membership and grant.
// The service client is used only for Supabase Auth (create the invited user,
// send the email, sign a deactivated account out) after the database agreed.
import type { PostgrestError } from "@supabase/supabase-js"

import {
  AuthLookupError,
  DEACTIVATED_BAN_DURATION,
  findAuthUserByEmail,
  INVITE_METADATA_KEY,
  isOrphanedInvite,
} from "./auth-users"
import {
  fail,
  FORBIDDEN_MESSAGE,
  resolveCaller,
  type AccountError,
  type AccountResult,
  type AccountsContext,
} from "./context"
import { dbFailed, INVITE_EMAIL_FAILED, supabaseInviteMailer } from "./invite"
import { isUuid, parseVenueInviteInput } from "./validation"

/** Role a membership gives at a venue. */
export type MembershipRole = "staff" | "manager"
/** Role that applies at a venue now (null: the membership grants nothing). */
export type EffectiveVenueRole = "staff" | "manager" | "admin" | null

export type VenueTeamMember = {
  profileId: string
  displayName: string
  jobTitle: string | null
  membershipId: string
  membershipRole: MembershipRole
  effectiveRole: EffectiveVenueRole
  /** The person is working at this venue now (their active venue). */
  isActiveVenue: boolean
  grantedAt: string
  grantedByName: string | null
}

export type VenuePrivileges = {
  /** Null for an admin's single "All venues" row. */
  venueId: string | null
  venueName: string
  membershipId: string | null
  membershipRole: MembershipRole | "admin"
  effectiveRole: EffectiveVenueRole
  isActiveVenue: boolean
  canUpload: boolean
  canReview: boolean
  canInviteStaff: boolean
  canExport: boolean
  canGrantRoles: boolean
}

export type VenueInviteOutcome =
  /** A new account was created and the invitation email sent. */
  | { status: "sent"; userId: string }
  /** The account exists but the email did not go out. Recover with resend. */
  | { status: "partial"; userId: string; message: string }
  /** An existing person was added as staff here (no email is needed). */
  | { status: "added"; userId: string }
  /** The person already belongs to this venue; nothing changed. */
  | { status: "already_member"; userId: string }
  | ({ status: "error" } & Omit<AccountError, "ok">)

type ReassignedWork = {
  coverageAssignments: number
  amenityChecks: number
  mediaRequests: number
}

export type RemovalOutcome = {
  /** removed: still works at another venue; deactivated: that was their last venue. */
  outcome: "removed" | "deactivated"
  activeVenueId: string | null
  reassigned: ReassignedWork
  warning?: string
}

function reassignmentCounts(value: unknown): ReassignedWork {
  const counts = value as Record<string, unknown> | null | undefined
  return {
    coverageAssignments: Number(counts?.coverageAssignments ?? 0),
    amenityChecks: Number(counts?.amenityChecks ?? 0),
    mediaRequests: Number(counts?.mediaRequests ?? 0),
  }
}

const MESSAGES: Record<string, { code: AccountError["code"]; text: string }> = {
  not_venue_manager: { code: "forbidden", text: FORBIDDEN_MESSAGE },
  not_active_admin: { code: "forbidden", text: FORBIDDEN_MESSAGE },
  not_active_user: { code: "forbidden", text: FORBIDDEN_MESSAGE },
  not_ordinary_staff: {
    code: "forbidden",
    text: "Only an admin can remove a manager.",
  },
  cannot_remove_self: {
    code: "forbidden",
    text: "You cannot remove yourself from the venue.",
  },
  cannot_change_self: {
    code: "forbidden",
    text: "Ask another admin to change your own access.",
  },
  not_a_member: {
    code: "not_found",
    text: "That person is not a member of this venue.",
  },
  account_not_found: {
    code: "not_found",
    text: "That account was not found.",
  },
  account_not_eligible: {
    code: "invalid_input",
    text: "Admins already have every venue.",
  },
  account_inactive: {
    code: "account_inactive",
    text: "This account is inactive. Ask an admin to restore access first.",
  },
  venue_inactive: {
    code: "venue_inactive",
    text: "Choose an active venue.",
  },
  replacement_not_eligible: {
    code: "invalid_input",
    text: "Choose someone who is working at this venue now.",
  },
  reason_required: { code: "invalid_input", text: "Give a short reason." },
  invalid_reason: {
    code: "invalid_input",
    text: "Keep the reason to 500 characters.",
  },
  invalid_role: { code: "invalid_input", text: "Choose staff or manager." },
  last_active_admin: {
    code: "last_admin",
    text: "Make another person an active admin first.",
  },
}

/** Maps a refusal from the membership RPCs to a typed account error. */
export function membershipError(
  error: Pick<PostgrestError, "message" | "code">
): AccountError {
  const known = MESSAGES[error.message]
  if (known) return fail(known.code, known.text)
  if (error.code === "42501") return fail("forbidden", FORBIDDEN_MESSAGE)
  console.error("[accounts] membership command failed", { code: error.code })
  return dbFailed()
}

async function activeCaller(ctx: AccountsContext) {
  const caller = await resolveCaller(ctx.caller)
  if (!caller.ok) {
    return fail(
      caller.code,
      caller.code === "unauthenticated"
        ? "Your session has ended. Sign in again."
        : FORBIDDEN_MESSAGE
    )
  }
  return null
}

/**
 * Members of a venue for its manager or an admin, managers first. Each row
 * says whether the person is working there now.
 */
export async function listVenueTeam(
  ctx: AccountsContext,
  venueId: unknown
): Promise<AccountResult<{ members: VenueTeamMember[] }>> {
  if (!isUuid(venueId)) return fail("invalid_input", "Choose a venue.")
  const { data, error } = await ctx.caller.rpc("venue_team", {
    p_venue_id: venueId,
  })
  if (error) return membershipError(error)
  return {
    ok: true,
    members: (data ?? []).map((r) => ({
      profileId: r.profile_id,
      displayName: r.display_name,
      jobTitle: r.job_title,
      membershipId: r.membership_id,
      membershipRole: r.membership_role as MembershipRole,
      effectiveRole: (r.effective_role ?? null) as EffectiveVenueRole,
      isActiveVenue: r.is_active_venue,
      grantedAt: r.granted_at,
      grantedByName: r.granted_by_name,
    })),
  }
}

/**
 * Effective privileges per venue (A6) for a person: what each membership
 * allows, computed by the database rule. Visible to admins, the person and a
 * manager for their own venue.
 */
export async function getPersonVenuePrivileges(
  ctx: AccountsContext,
  profileId: unknown
): Promise<AccountResult<{ venues: VenuePrivileges[] }>> {
  if (!isUuid(profileId))
    return fail("not_found", "That account was not found.")
  const { data, error } = await ctx.caller.rpc("person_venue_privileges", {
    p_profile_id: profileId,
  })
  if (error) return membershipError(error)
  return {
    ok: true,
    venues: (data ?? []).map((r) => ({
      venueId: r.venue_id,
      venueName: r.venue_name,
      membershipId: r.membership_id,
      membershipRole: r.membership_role as VenuePrivileges["membershipRole"],
      effectiveRole: (r.effective_role ?? null) as EffectiveVenueRole,
      isActiveVenue: r.is_active_venue,
      canUpload: r.can_upload,
      canReview: r.can_review,
      canInviteStaff: r.can_invite_staff,
      canExport: r.can_export,
      canGrantRoles: r.can_grant_roles,
    })),
  }
}

function asInviteError({
  code,
  error,
  fieldErrors,
}: AccountError): VenueInviteOutcome {
  return fieldErrors
    ? { status: "error", code, error, fieldErrors }
    : { status: "error", code, error }
}

/**
 * A manager (or admin) invites ORDINARY STAFF to a venue they manage (AC40).
 * The role is always staff; the database refuses any venue the caller does
 * not manage before anything is created in Supabase Auth.
 *
 * * New email: create (or adopt an earlier marked) auth user, create the
 *   staff profile at the venue through `manager_invite_staff`, then send the
 *   invitation. A failed email returns `partial`, never `sent`.
 * * An existing Naba-Lens person: add a staff membership here. Their other
 *   venues are untouched; an existing membership is left as it is.
 */
export async function inviteStaffToVenue(
  ctx: AccountsContext,
  raw: unknown
): Promise<VenueInviteOutcome> {
  const refused = await activeCaller(ctx)
  if (refused) return asInviteError(refused)
  const parsed = parseVenueInviteInput(raw)
  if (!parsed.ok) {
    return asInviteError(
      fail("invalid_input", "Check the highlighted fields.", parsed.fieldErrors)
    )
  }
  const input = parsed.value

  // Database gate first: nothing is created for a venue the caller cannot manage.
  const gate = await ctx.caller.rpc("venue_team", { p_venue_id: input.venueId })
  if (gate.error) return asInviteError(membershipError(gate.error))

  let existing: Awaited<ReturnType<typeof findAuthUserByEmail>>
  try {
    existing = await findAuthUserByEmail(
      ctx.service,
      input.email,
      ctx.authDeadlineMs
    )
  } catch (error) {
    if (!(error instanceof AuthLookupError)) throw error
    return asInviteError(
      fail(
        "auth_failed",
        "The sign-in service is not responding. Nothing was saved. Try again in a minute."
      )
    )
  }

  let userId: string
  let created = false
  if (existing) {
    userId = existing.id
    const { data: profile, error } = await ctx.service
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle()
    if (error) return asInviteError(dbFailed())
    if (!profile && !isOrphanedInvite(existing)) {
      return asInviteError(
        fail(
          "email_exists",
          "This email belongs to an account that is not set up for Naba-Lens. Ask an admin to check it.",
          { email: "This email already has an account." }
        )
      )
    }
  } else {
    const { data, error } = await ctx.service.auth.admin.createUser({
      email: input.email,
      email_confirm: false,
      user_metadata: { [INVITE_METADATA_KEY]: true },
    })
    if (error || !data.user) {
      if (error?.code === "email_exists") {
        return asInviteError(
          fail("email_exists", "This email already has an account.", {
            email: "This email already has an account.",
          })
        )
      }
      console.error("[accounts] venue invite: create user failed", {
        code: error?.code ?? null,
      })
      return asInviteError(
        fail(
          "auth_failed",
          "The invitation could not be created. Nothing was saved. Try again."
        )
      )
    }
    userId = data.user.id
    created = true
  }

  const { data: rows, error: inviteError } = await ctx.caller.rpc(
    "manager_invite_staff",
    {
      p_user_id: userId,
      p_venue_id: input.venueId,
      p_display_name: input.displayName,
      p_job_title: input.jobTitle as string,
    }
  )
  if (inviteError) return asInviteError(membershipError(inviteError))
  const outcome = rows?.[0]?.outcome
  if (outcome === "added") return { status: "added", userId }
  if (outcome === "already_member") return { status: "already_member", userId }

  // A new staff profile ("created"): send the invitation email.
  const mailer = ctx.mailer ?? supabaseInviteMailer(ctx.service)
  const { error: mailError } = await mailer(input.email)
  if (mailError) {
    console.error("[accounts] venue invite: email failed", {
      code: mailError.code ?? null,
      created,
    })
    return { status: "partial", userId, message: INVITE_EMAIL_FAILED }
  }
  return { status: "sent", userId }
}

/**
 * Ends a person's membership at one venue (M5, A6, AC34). Managers remove
 * ordinary staff at their venue only. Open work can go to `replacementId` in
 * the same transaction. When it was the person's last venue the account is
 * deactivated and signed out everywhere; a failed sign-out returns a warning
 * (the database already refuses the account on its next request).
 */
export async function removeVenueMember(
  ctx: AccountsContext,
  raw: unknown
): Promise<AccountResult<RemovalOutcome>> {
  const refused = await activeCaller(ctx)
  if (refused) return refused
  const input = (raw ?? {}) as Record<string, unknown>
  if (!isUuid(input.profileId) || !isUuid(input.venueId))
    return fail("invalid_input", "Choose a person and a venue.")
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (!reason)
    return fail("invalid_input", "Give a short reason.", {
      reason: "Give a short reason.",
    })
  if (input.replacementId != null && !isUuid(input.replacementId))
    return fail("invalid_input", "Choose who takes over their work.")

  const { data, error } = await ctx.caller.rpc("remove_venue_member", {
    p_profile_id: input.profileId,
    p_venue_id: input.venueId,
    p_reason: reason,
    p_replacement_id: (input.replacementId ?? null) as string,
  })
  if (error) return membershipError(error)
  const row = data?.[0]
  if (!row) return dbFailed()
  const outcome = row.outcome === "deactivated" ? "deactivated" : "removed"
  const result: RemovalOutcome = {
    outcome,
    activeVenueId: row.active_venue_id,
    reassigned: reassignmentCounts(row.reassigned),
  }
  if (outcome === "deactivated") {
    const { error: banError } = await ctx.service.auth.admin.updateUserById(
      input.profileId,
      { ban_duration: DEACTIVATED_BAN_DURATION }
    )
    if (banError) {
      console.error("[accounts] membership removal: sign-out failed", {
        code: banError.code ?? null,
      })
      result.warning =
        "Their access has ended. Signing out their other devices failed; they are still refused on their next request."
    }
  }
  return { ok: true, ...result }
}

/** Admin: the staff or manager role at any venue (adds the venue if needed). */
export async function setVenueMembership(
  ctx: AccountsContext,
  raw: unknown
): Promise<AccountResult<{ membershipId: string }>> {
  const refused = await activeCaller(ctx)
  if (refused) return refused
  const input = (raw ?? {}) as Record<string, unknown>
  if (!isUuid(input.profileId) || !isUuid(input.venueId))
    return fail("invalid_input", "Choose a person and a venue.")
  if (input.role !== "staff" && input.role !== "manager")
    return fail("invalid_input", "Choose staff or manager.")
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (input.role === "manager" && !reason)
    return fail("invalid_input", "Give a short reason.", {
      reason: "Give a short reason.",
    })
  const { data, error } = await ctx.caller.rpc("admin_set_venue_membership", {
    p_profile_id: input.profileId,
    p_venue_id: input.venueId,
    p_role: input.role,
    p_reason: (reason || null) as string,
  })
  if (error) return membershipError(error)
  return { ok: true, membershipId: data as string }
}

/** Admin: hand a person's open work at a venue to a colleague working there. */
export async function reassignOpenWork(
  ctx: AccountsContext,
  raw: unknown
): Promise<AccountResult<ReassignedWork>> {
  const refused = await activeCaller(ctx)
  if (refused) return refused
  const input = (raw ?? {}) as Record<string, unknown>
  if (
    !isUuid(input.fromProfileId) ||
    !isUuid(input.toProfileId) ||
    !isUuid(input.venueId)
  )
    return fail("invalid_input", "Choose who takes over the work.")
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (!reason) return fail("invalid_input", "Give a short reason.")
  const { data, error } = await ctx.caller.rpc("reassign_open_work", {
    p_from_profile_id: input.fromProfileId,
    p_to_profile_id: input.toProfileId,
    p_venue_id: input.venueId,
    p_reason: reason,
  })
  if (error) return membershipError(error)
  return { ok: true, ...reassignmentCounts(data) }
}

/** Admin: make a staff or manager account an admin (A6). */
export async function grantAdminRole(
  ctx: AccountsContext,
  raw: unknown
): Promise<AccountResult> {
  const refused = await activeCaller(ctx)
  if (refused) return refused
  const input = (raw ?? {}) as Record<string, unknown>
  if (!isUuid(input.profileId))
    return fail("not_found", "That account was not found.")
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (!reason) return fail("invalid_input", "Give a short reason.")
  const { error } = await ctx.caller.rpc("admin_grant_admin", {
    p_profile_id: input.profileId,
    p_reason: reason,
  })
  if (error) return membershipError(error)
  return { ok: true }
}

/**
 * Admin: remove another admin's admin role; they become staff at `venueId`.
 * The database refuses it when no other active admin would remain.
 */
export async function revokeAdminRole(
  ctx: AccountsContext,
  raw: unknown
): Promise<AccountResult> {
  const refused = await activeCaller(ctx)
  if (refused) return refused
  const input = (raw ?? {}) as Record<string, unknown>
  if (!isUuid(input.profileId))
    return fail("not_found", "That account was not found.")
  if (!isUuid(input.venueId)) return fail("invalid_input", "Choose a venue.")
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (!reason) return fail("invalid_input", "Give a short reason.")
  const { error } = await ctx.caller.rpc("admin_revoke_admin", {
    p_profile_id: input.profileId,
    p_venue_id: input.venueId,
    p_reason: reason,
  })
  if (error) return membershipError(error)
  return { ok: true }
}

/** Active admins, for the admin role section of the staff directory. */
export async function listActiveAdmins(
  ctx: AccountsContext
): Promise<AccountResult<{ admins: { id: string; displayName: string }[] }>> {
  const refused = await activeCaller(ctx)
  if (refused) return refused
  // Admins read every profile through RLS (profiles_select_admin); anyone
  // else reads only their own row, so a non-admin never sees this list.
  const { data, error } = await ctx.caller
    .from("profiles")
    .select("id, display_name")
    .eq("role", "admin")
    .eq("active", true)
    .order("display_name", { ascending: true })
  if (error) return dbFailed()
  return {
    ok: true,
    admins: (data ?? []).map((a) => ({
      id: a.id,
      displayName: a.display_name,
    })),
  }
}
