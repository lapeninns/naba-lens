import type { SupabaseClient } from "@supabase/supabase-js"

import {
  loadProfile,
  toAuthState,
  type CurrentProfile,
} from "@/lib/auth/profile"
import {
  assuranceLevel,
  mfaRequirement,
  readsFactors,
  readVerifiedFactors,
} from "@/lib/auth/mfa"
import type { Database } from "@/lib/db/types"

export type Db = SupabaseClient<Database>

/** Sends (or re-sends) the Supabase Auth invitation email for an existing auth user. */
export type InviteMailer = (
  email: string
) => Promise<{ error: { code?: string; message: string } | null }>

/**
 * Everything an account operation needs. `caller` acts as the signed-in user
 * (RLS applies) and is the only thing used to decide who is asking. `service`
 * bypasses RLS and is used only after the caller has been re-checked.
 */
export type AccountsContext = {
  caller: Db
  service: Db
  /** Defaults to Supabase Auth's invite email (`auth.admin.inviteUserByEmail`). */
  mailer?: InviteMailer
  /** Wait limit for Supabase Auth admin calls (default AUTH_LOOKUP_DEADLINE_MS). */
  authDeadlineMs?: number
}

export type AccountError = {
  ok: false
  /** Shown at the top of a form. */
  error: string
  code: AccountErrorCode
  fieldErrors?: Partial<Record<string, string>>
}

export type AccountErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "email_exists"
  | "venue_inactive"
  | "already_signed_in"
  | "account_inactive"
  | "auth_failed"
  | "database_failed"
  /** The last active admin cannot lose the role or be deactivated. */
  | "last_admin"

export type AccountResult<T = object> = ({ ok: true } & T) | AccountError

export function fail(
  code: AccountErrorCode,
  error: string,
  fieldErrors?: Partial<Record<string, string>>
): AccountError {
  return fieldErrors
    ? { ok: false, code, error, fieldErrors }
    : { ok: false, code, error }
}

export const FORBIDDEN_MESSAGE = "You do not have permission to do that."

/**
 * Re-reads the caller's session and *current* profile from the database. Never
 * trusts a role passed in by the client: Server Functions are reachable by direct
 * POST, so every account operation starts here.
 */
export async function resolveCaller(
  caller: Db
): Promise<
  | { ok: true; profile: CurrentProfile }
  | { ok: false; code: "unauthenticated" | "forbidden" }
> {
  const { data, error } = await caller.auth.getClaims()
  const claims = error ? null : data?.claims
  if (!claims?.sub) return { ok: false, code: "unauthenticated" }
  const email = typeof claims.email === "string" ? claims.email : null
  const state = toAuthState(
    { id: claims.sub, email },
    await loadProfile(caller, claims.sub, email)
  )
  if (state.status !== "active") return { ok: false, code: "forbidden" }
  // FA-23, as getAuthState applies it: an account that still owes the second
  // sign-in step is not active yet. Account operations then act with the
  // service role, where the database's aal2 check no longer applies, so the
  // level is checked here (S6-CI: an aal1 admin could invite and edit staff).
  const aal = assuranceLevel(claims)
  let factors: number | null = null
  if (aal === "aal1" && readsFactors(state.profile.role)) {
    try {
      factors = await readVerifiedFactors(caller)
    } catch {
      // Unknown, so not active: fail closed.
      return { ok: false, code: "forbidden" }
    }
  }
  if (mfaRequirement(state.profile.role, aal, factors))
    return { ok: false, code: "forbidden" }
  return { ok: true, profile: state.profile }
}

/** Active admin or a typed refusal. */
export async function requireAdminCaller(
  caller: Db
): Promise<{ ok: true; admin: CurrentProfile } | AccountError> {
  const result = await resolveCaller(caller)
  if (!result.ok) {
    return fail(
      result.code,
      result.code === "unauthenticated"
        ? "Your session has ended. Sign in again."
        : FORBIDDEN_MESSAGE
    )
  }
  if (result.profile.role !== "admin")
    return fail("forbidden", FORBIDDEN_MESSAGE)
  return { ok: true, admin: result.profile }
}
