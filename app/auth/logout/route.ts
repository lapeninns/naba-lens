import { seeOther } from "@/app/auth/redirect"
import { isSameOriginRequest } from "@/lib/server/http/same-origin"
import { createClient } from "@/lib/supabase/server"
import { getSiteUrl } from "@/lib/supabase/env"

/** POST-only sign-out for this browser session; see app/auth/sign-out-button.tsx. */
export async function POST(request: Request) {
  if (!fromThisSite(request.headers))
    return new Response("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    })
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: "local" })
  return seeOther("/login?signed_out=1")
}

/**
 * Another site's form could otherwise sign this browser out. The shared check
 * (Sec-Fetch-Site, then Origin against Host or X-Forwarded-Host; a request
 * without Origin passes), plus the configured site URL's host for a proxy
 * that forwards neither header with the public host.
 */
function fromThisSite(headers: Headers): boolean {
  if (isSameOriginRequest(headers)) return true
  const site = headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") return false
  const origin = headers.get("origin")
  if (!origin) return false
  try {
    return (
      new URL(origin).host.toLowerCase() ===
      new URL(getSiteUrl()).host.toLowerCase()
    )
  } catch {
    return false
  }
}
