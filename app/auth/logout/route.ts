import { seeOther } from "@/app/auth/redirect"
import { createClient } from "@/lib/supabase/server"
import { getSiteUrl } from "@/lib/supabase/env"

/** POST-only sign-out for this browser session; see app/auth/sign-out-button.tsx. */
export async function POST(request: Request) {
  if (!fromThisSite(request))
    return new Response("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    })
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: "local" })
  return seeOther("/login?signed_out=1")
}

/**
 * Another site's form could otherwise sign this browser out. Browsers send
 * Origin with every POST; one without it (older browsers, curl) is allowed.
 * Hosts are compared, not request.url, which can name another host (localhost
 * vs 127.0.0.1) behind dev servers and proxies.
 */
function fromThisSite(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (origin === null) return true
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  const ours = [
    request.headers.get("host"),
    request.headers.get("x-forwarded-host"),
    new URL(getSiteUrl()).host,
  ]
  return ours.some((h) => h !== null && h.toLowerCase() === host.toLowerCase())
}
