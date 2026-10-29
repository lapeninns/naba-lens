import { createBrowserClient } from "@supabase/ssr"

import type { Database } from "@/lib/db/types"
import { getSupabasePublicEnv } from "@/lib/supabase/env"

/** Supabase client for Client Components, acting as the signed-in user. */
export function createClient() {
  const { url, publishableKey } = getSupabasePublicEnv()
  return createBrowserClient<Database>(url, publishableKey)
}
