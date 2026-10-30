import type { User } from "@supabase/supabase-js"

import {
  AuthLookupError,
  findAuthUserByEmail,
  INVITE_METADATA_KEY,
  isOrphanedInvite,
  withAuthDeadline,
} from "./auth-users"
import {
  fail,
  requireAdminCaller,
  type AccountError,
  type AccountResult,
  type AccountsContext,
  type Db,
  type InviteMailer,
} from "./context"
import { isUuid, parseInviteInput } from "./validation"

export type InviteOutcome =
  | { status: "sent"; userId: string }
  /** The staff account exists but the email did not go out. Recover with resend. */
  | { status: "partial"; userId: string; message: string }
  | ({ status: "error" } & Omit<AccountError, "ok">)

export const INVITE_EMAIL_FAILED =
  "The account was created, but the invitation email could not be sent. Use “Resend invitation” in the staff list."

/** Supabase Auth's invite email. For an unconfirmed user it re-sends the invite. */
export function supabaseInviteMailer(service: Db): InviteMailer {
  return async (email) => {
    const { error } = await service.auth.admin.inviteUserByEmail(email)
    return {
      error: error ? { code: error.code, message: error.message } : null,
    }
  }
}

function asError({ code, error, fieldErrors }: AccountError): InviteOutcome {
  return fieldErrors
    ? { status: "error", code, error, fieldErrors }
    : { status: "error", code, error }
}

/**
 * Invites a new STAFF member (never an admin). Steps, each recoverable:
 *
 * 1. Create the auth user without sending email. A duplicate address fails here,
 *    before anything is written, so two concurrent invites cannot both succeed.
 * 2. Insert the `staff` profile. If that fails, the new auth user is deleted
 *    again; if even that fails, the user is marked as ours and a retry adopts it.
 * 3. Send the invitation email. If sending fails, the account stays (shown as
 *    Invited) and the result is `partial`, never `sent`: "Resend invitation"
 *    recovers it.
 */
export async function inviteStaff(
  ctx: AccountsContext,
  raw: unknown
): Promise<InviteOutcome> {
  const auth = await requireAdminCaller(ctx.caller)
  if (!auth.ok) return asError(auth)

  const parsed = parseInviteInput(raw)
  if (!parsed.ok) {
    return asError(
      fail("invalid_input", "Check the highlighted fields.", parsed.fieldErrors)
    )
  }
  const input = parsed.value
  const { service } = ctx

  const venueError = await checkAssignableVenue(service, input.venueId)
  if (venueError) return asError(venueError)

  let userId: string
  let createdNow = false
  let existing: Awaited<ReturnType<typeof findAuthUserByEmail>>
  try {
    existing = await findAuthUserByEmail(
      service,
      input.email,
      ctx.authDeadlineMs
    )
  } catch (error) {
    if (!(error instanceof AuthLookupError)) throw error
    console.error("[accounts] invite: auth lookup unavailable", {
      reason: error.reason,
    })
    return asError(
      fail(
        "auth_failed",
        "The sign-in service is not responding. Nothing was saved. Try again in a minute."
      )
    )
  }
  if (existing) {
    const { data: profile, error } = await service
      .from("profiles")
      .select("id")
      .eq("id", existing.id)
      .maybeSingle()
    if (error) return asError(dbFailed())
    if (profile || !isOrphanedInvite(existing)) {
      return asError(
        fail(
          "email_exists",
          profile
            ? "This email already has a NabaLens account. If they have not signed in yet, use “Resend invitation” in the staff list."
            : "This email belongs to an account that is not set up for NabaLens. Ask the system owner to check it.",
          { email: "This email already has an account." }
        )
      )
    }
    userId = existing.id
  } else {
    const { data, error } = await service.auth.admin.createUser({
      email: input.email,
      email_confirm: false,
      user_metadata: { [INVITE_METADATA_KEY]: true },
    })
    if (error || !data.user) {
      if (error?.code === "email_exists") {
        return asError(
          fail("email_exists", "This email already has an account.", {
            email: "This email already has an account.",
          })
        )
      }
      console.error("[accounts] invite: create user failed", {
        code: error?.code ?? null,
      })
      return asError(
        fail(
          "auth_failed",
          "The invitation could not be created. Nothing was saved. Try again."
        )
      )
    }
    userId = data.user.id
    createdNow = true
  }

  // role is fixed here: invitations can only ever create staff accounts.
  const { error: insertError } = await service.from("profiles").insert({
    id: userId,
    display_name: input.displayName,
    job_title: input.jobTitle,
    role: "staff",
    venue_id: input.venueId,
    active: true,
  })
  if (insertError) {
    if (createdNow) {
      const { error: undoError } = await service.auth.admin.deleteUser(userId)
      if (undoError) {
        console.error("[accounts] invite: rollback failed", {
          code: undoError.code ?? null,
        })
      }
    }
    if (insertError.code === "23505") {
      return asError(
        fail("email_exists", "This email already has an account.", {
          email: "This email already has an account.",
        })
      )
    }
    if (insertError.message === "venue_inactive") {
      return asError(venueInactive())
    }
    console.error("[accounts] invite: profile insert failed", {
      code: insertError.code,
    })
    return asError(dbFailed())
  }

  const mailer = ctx.mailer ?? supabaseInviteMailer(service)
  const { error: mailError } = await mailer(input.email)
  if (mailError) {
    console.error("[accounts] invite: email failed", {
      code: mailError.code ?? null,
    })
    return { status: "partial", userId, message: INVITE_EMAIL_FAILED }
  }
  return { status: "sent", userId }
}

/**
 * Sends the invitation again to a staff member who has not signed in yet. Safe
 * to repeat: it never creates a user or profile.
 */
export async function resendInvitation(
  ctx: AccountsContext,
  staffId: unknown
): Promise<AccountResult> {
  const auth = await requireAdminCaller(ctx.caller)
  if (!auth.ok) return auth
  if (!isUuid(staffId)) return notFound()

  // Read through the admin's own client so RLS confirms they can see this row.
  const { data: profile, error } = await ctx.caller
    .from("profiles")
    .select("id, role, active, display_name")
    .eq("id", staffId)
    .maybeSingle()
  if (error) return dbFailed()
  if (!profile || profile.role !== "staff") return notFound()
  if (!profile.active) {
    return fail(
      "account_inactive",
      "This account is inactive. Reactivate it before resending the invitation."
    )
  }

  let authUser: { user: User | null }
  try {
    authUser = await withAuthDeadline(
      ctx.service.auth.admin.getUserById(staffId).then(({ data, error }) => {
        // GoTrue answers 404 for a missing user; anything else is an outage.
        if (error && error.status !== 404) throw new AuthLookupError("failed")
        return { user: data.user }
      }),
      ctx.authDeadlineMs
    )
  } catch (error) {
    if (!(error instanceof AuthLookupError)) throw error
    console.error("[accounts] resend: auth lookup unavailable", {
      reason: error.reason,
    })
    return fail(
      "auth_failed",
      "The sign-in service is not responding. No email was sent. Try again in a minute."
    )
  }
  if (!authUser.user?.email) return notFound()
  if (authUser.user.last_sign_in_at)
    return alreadySignedIn(profile.display_name)

  const mailer = ctx.mailer ?? supabaseInviteMailer(ctx.service)
  const { error: mailError } = await mailer(authUser.user.email)
  if (mailError) {
    // GoTrue refuses to re-invite a confirmed address.
    if (mailError.code === "email_exists") {
      return alreadySignedIn(profile.display_name)
    }
    console.error("[accounts] resend: email failed", {
      code: mailError.code ?? null,
    })
    return fail(
      "auth_failed",
      "The invitation email could not be sent. Wait a minute and try again."
    )
  }
  return { ok: true }
}

export async function checkAssignableVenue(
  client: Db,
  venueId: string
): Promise<AccountError | null> {
  const { data, error } = await client
    .from("venues")
    .select("id, active")
    .eq("id", venueId)
    .maybeSingle()
  if (error) return dbFailed()
  if (!data || !data.active) return venueInactive()
  return null
}

function venueInactive(): AccountError {
  return fail("venue_inactive", "Choose an active venue.", {
    venueId: "This venue is inactive or no longer exists.",
  })
}

function alreadySignedIn(name: string): AccountError {
  return fail(
    "already_signed_in",
    `${name} has already confirmed their account. They can request a sign-in link on the login page.`
  )
}

export function notFound(): AccountError {
  return fail("not_found", "That staff account was not found.")
}

export function dbFailed(): AccountError {
  return fail("database_failed", "Something went wrong. Try again.")
}
