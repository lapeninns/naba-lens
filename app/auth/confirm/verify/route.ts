import type { NextRequest } from "next/server"

import { seeOther } from "@/app/auth/redirect"
import { parseEmailLink } from "@/lib/auth/email-link"
import { createClient } from "@/lib/supabase/server"

/**
 * Same-origin check: a cross-site form must not sign this browser in with
 * someone else's token. Browsers set Sec-Fetch-Site themselves; without it, the
 * Origin must name this host. `Origin: null` (opaque or privacy-stripped) fails.
 */
function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site")
  if (site) return site === "same-origin" || site === "none"
  const origin = request.headers.get("origin")
  if (!origin) return true
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * POST target of the /auth/confirm page's Continue button. Verifies the email
 * link's token hash server-side (no PKCE verifier needed, so any browser works)
 * and starts the session. Success goes to "/", which routes by the database role;
 * an expired, used or malformed link goes back to login's recovery state.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
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
