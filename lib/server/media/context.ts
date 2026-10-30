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

/**
 * Authorises the current request (fresh profile read: deactivation applies to
 * existing sessions) and builds the clients a media operation needs. Pass a role
 * to require it, or omit it for routes both roles use. Returns a status instead
 * of redirecting, for Route Handlers and Server Functions that report errors.
 * A profile read that fails (not a missing or inactive profile) is a 503.
 */
export async function getMediaActor(role?: AppRole): Promise<ActorResult> {
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
  if (role && state.profile.role !== role) {
    return { ok: false, status: 403, message: "Not allowed." }
  }
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
