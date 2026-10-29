import "server-only"

import { getAuthState, type AppRole } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSupabasePublicEnv } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"

import type { Db, MediaActor } from "./types"

export type ActorResult =
  | { ok: true; actor: MediaActor }
  | { ok: false; status: 401 | 403; message: string }

/**
 * Authorises the current request (fresh profile read: deactivation applies to
 * existing sessions) and builds the clients a media operation needs. Pass a role
 * to require it, or omit it for routes both roles use. Returns a status instead
 * of redirecting, for Route Handlers and Server Functions that report errors.
 */
export async function getMediaActor(role?: AppRole): Promise<ActorResult> {
  const state = await getAuthState()
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
