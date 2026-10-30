import type { NextRequest } from "next/server"

import { seeOther } from "@/app/auth/redirect"
import { parseEmailLink } from "@/lib/auth/email-link"
import { isSameOriginRequest } from "@/lib/server/http/same-origin"
import { createClient } from "@/lib/supabase/server"

/**
 * POST target of the /auth/confirm page's Continue button. Verifies the email
 * link's token hash server-side (no PKCE verifier needed, so any browser works)
 * and starts the session. Success goes to "/", which routes by the database role;
 * an expired, used or malformed link goes back to login's recovery state.
 * Same-origin only: a cross-site form must not sign this browser in with
 * someone else's token (shared CSRF check, as every cookie-taking POST uses).
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers)) {
    return new Response("Forbidden.", { status: 403 })
  }

  let form: FormData | null = null
  try {
    form = await request.formData()
  } catch {
    form = null
  }
  const link = parseEmailLink(form?.get("token_hash"), form?.get("type"))

  if (link) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({
      type: link.type,
      token_hash: link.tokenHash,
    })
    if (!error) {
      return seeOther("/")
    }
  }

  return seeOther("/login?error=link_invalid")
}
