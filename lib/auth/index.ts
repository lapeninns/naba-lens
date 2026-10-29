import "server-only"

import { redirect } from "next/navigation"

import {
  loadProfile,
  toAuthState,
  type AuthState,
  type CurrentProfile,
} from "@/lib/auth/profile"
import { homePathFor, ROUTES, type AppRole } from "@/lib/auth/routes"
import { createClient } from "@/lib/supabase/server"

export type {
  AuthState,
  CurrentProfile,
  CurrentVenue,
  UploadBlockReason,
} from "@/lib/auth/profile"
export { uploadBlockReason } from "@/lib/auth/profile"
export { homePathFor, ROUTES, type AppRole } from "@/lib/auth/routes"

/**
 * Current session plus a fresh database read of the profile. Not cached: every
 * call re-reads role/active/venue so deactivation blocks existing sessions.
 */
export async function getAuthState(): Promise<AuthState> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const claims = error ? null : data?.claims
  if (!claims?.sub) return { status: "signed_out" }

  const user = {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
  }
  return toAuthState(user, await loadProfile(supabase, user.id, user.email))
}

/** The signed-in user's profile (active or not), or null without a session/profile. */
export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const state = await getAuthState()
  return state.status === "active" || state.status === "inactive"
    ? state.profile
    : null
}

function redirectFor(state: AuthState, role: AppRole): never | CurrentProfile {
  switch (state.status) {
    case "signed_out":
      redirect(ROUTES.login)
    case "no_profile":
    case "inactive":
      redirect(ROUTES.blocked)
    case "active":
      if (state.profile.role !== role) redirect(homePathFor(state.profile.role))
      return state.profile
  }
}

/**
 * For pages and Server Functions: returns the active staff profile or redirects
 * (login, blocked page, or the admin home). Call inside every staff mutation too.
 */
export async function requireActiveStaff(): Promise<CurrentProfile> {
  return redirectFor(await getAuthState(), "staff")
}

/** For pages and Server Functions: returns the active admin profile or redirects. */
export async function requireActiveAdmin(): Promise<CurrentProfile> {
  return redirectFor(await getAuthState(), "admin")
}

export type Authorization =
  | { ok: true; profile: CurrentProfile }
  | {
      ok: false
      status: 401 | 403
      reason: "unauthenticated" | "inactive" | "forbidden"
    }

/**
 * For Route Handlers that must answer with a status code instead of redirecting.
 * Use the result's `status` for the HTTP response.
 */
export async function authorize(role: AppRole): Promise<Authorization> {
  const state = await getAuthState()
  if (state.status === "signed_out") {
    return { ok: false, status: 401, reason: "unauthenticated" }
  }
  if (state.status !== "active") {
    return { ok: false, status: 403, reason: "inactive" }
  }
  if (state.profile.role !== role) {
    return { ok: false, status: 403, reason: "forbidden" }
  }
  return { ok: true, profile: state.profile }
}

/** Contract names (docs/fanout/CONTRACT.md) for the same checks. */
export const requireStaff = requireActiveStaff
export const requireAdmin = requireActiveAdmin
