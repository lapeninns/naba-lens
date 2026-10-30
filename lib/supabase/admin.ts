import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/db/types"
import { getSupabasePublicEnv } from "@/lib/supabase/env"

/**
 * Service-role client. It BYPASSES row-level security, so every caller must first
 * authorise the user with lib/auth (requireActiveStaff/requireActiveAdmin) and
 * re-check the requested resource before acting. Never import from client code.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    throw new Error("Missing environment variable SUPABASE_SERVICE_ROLE_KEY.")
  }
  const { url } = getSupabasePublicEnv()
  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
