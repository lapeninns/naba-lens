import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import type { Database } from "@/lib/db/types"
import { getSupabasePublicEnv } from "@/lib/supabase/env"

/**
 * Refreshes the Supabase session cookies for a request and reports whether a
 * signed-in user is present. This is an optimistic check only: pages, Server
 * Functions and Route Handlers authorise again with lib/auth against the database.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const { url, publishableKey } = getSupabasePublicEnv()

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value)
        )
      },
    },
  })

  // Do not run code between createServerClient and getClaims: it refreshes tokens.
  const { data } = await supabase.auth.getClaims()
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null

  return { response, userId }
}
