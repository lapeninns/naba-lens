import type { EmailOtpType } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"

import { seeOther } from "@/app/auth/redirect"
import { createClient } from "@/lib/supabase/server"

const ALLOWED_TYPES: EmailOtpType[] = ["email", "magiclink", "invite"]

/**
 * Magic-link and invitation landing route used by supabase/templates/*.html:
 * /auth/confirm?token_hash=...&type=email|invite. Works in any browser because it
 * verifies the token hash server-side instead of relying on a PKCE verifier cookie.
 * Successful sign-in goes to "/", which routes by the database role.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    if (!error) {
      return seeOther("/")
    }
  }

  return seeOther("/login?error=link_invalid")
}
