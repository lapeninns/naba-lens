import "server-only"

import { getAuthState, type AppRole } from "@/lib/auth"
import { redactError } from "@/lib/server/log/redact"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSupabasePublicEnv } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"

import type { Db, MediaActor } from "./types"

export type ActorResult =
  | { ok: true; actor: MediaActor }
  | { ok: false; status: 401 | 403 | 503; message: string }

/** The profile could not be read (database trouble), so access is unknown. */
export const PROFILE_UNAVAILABLE = {
  ok: false,
  status: 503,
  message: "Could not check your account right now. Try again in a moment.",
} as const

/** The account's role is not one the operation admits. */
export const ROLE_NOT_ALLOWED = {
  ok: false,
  status: 403,
  message: "Not allowed.",
} as const

/**
 * Roles admitted when a caller names none: staff and admins. Venue managers are
 * excluded by default, so a surface opens to them only by naming "manager".
 */
export const DEFAULT_MEDIA_ROLES = [
  "staff",
  "admin",
] as const satisfies readonly AppRole[]

/**
 * Authorises the current request (fresh profile read: deactivation applies to
 * existing sessions) and builds the clients a media operation needs. Pass a
 * role, or a list of roles, to admit; omitted means `DEFAULT_MEDIA_ROLES`
 * (staff and admin, never managers). Returns a status instead of redirecting,
 * for Route Handlers and Server Functions that report errors. A profile read
 * that fails (not a missing or inactive profile) is a 503.
 */
export async function getMediaActor(
  roles: AppRole | readonly AppRole[] = DEFAULT_MEDIA_ROLES
): Promise<ActorResult> {
  let state: Awaited<ReturnType<typeof getAuthState>>
  try {
    state = await getAuthState()
  } catch (error) {
    // A failed profile read is not a denial: answer "retry", never a 500. The
    // cause (database outage, missing config or a bug) is logged, redacted.
    console.error("[media] account check failed", {
      error: redactError(error),
    })
    return PROFILE_UNAVAILABLE
  }
  if (state.status === "signed_out") {
    return { ok: false, status: 401, message: "Sign in to continue." }
  }
  if (state.status !== "active") {
    return { ok: false, status: 403, message: "Your account is not active." }
  }
  const admitted: readonly AppRole[] =
    typeof roles === "string" ? [roles] : roles
  if (!admitted.includes(state.profile.role)) return ROLE_NOT_ALLOWED
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    throw new Error("Missing environment variable SUPABASE_SERVICE_ROLE_KEY.")
  }
  return {
    ok: true,
    actor: {
      profile: state.profile,
      db: (await createClient()) as unknown as Db,
      service: createAdminClient(),
      storage: { url: getSupabasePublicEnv().url, serviceKey },
    },
  }
}
