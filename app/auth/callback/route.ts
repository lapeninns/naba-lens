import type { NextRequest } from "next/server"

import { seeOther } from "@/app/auth/redirect"
import { createClient } from "@/lib/supabase/server"

/**
 * PKCE callback for links built from Supabase's default templates
 * (?code=...). Requires the same browser that requested the link; the NabaLens
 * templates use /auth/confirm instead. Errors (e.g. otp_expired) go back to login.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return seeOther("/")
    }
  }

  return seeOther("/login?error=link_invalid")
}
