import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../../lib/db/types"

/** Service-role client for operator scripts. Reads env only; never prints keys. */
export function createServiceClientFromEnv(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in the environment."
    )
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) continue
    const [key, inline] = arg.slice(2).split("=", 2)
    if (inline !== undefined) {
      args[key] = inline
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      args[key] = argv[++i]
    } else {
      args[key] = true
    }
  }
  return args
}
