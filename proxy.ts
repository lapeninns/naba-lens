import { NextResponse, type NextRequest } from "next/server"

import {
  isProtectedPath,
  RETURN_TO_COOKIE,
  RETURN_TO_PARAM,
  returnToCookieOptions,
  ROUTES,
  safeReturnPath,
} from "@/lib/auth/routes"
import { SESSION_ENDED_MESSAGE } from "@/lib/auth/session-ended"
import { updateSession } from "@/lib/supabase/proxy"

/**
 * Next 16 Proxy (formerly Middleware): refreshes the Supabase session and sends
 * signed-out visitors of protected areas to /login, remembering the page they
 * asked for. Optimistic only — every page, Server Function and Route Handler
 * re-authorises against the database via lib/auth.
 */
export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request)
  const { pathname } = request.nextUrl

  if (userId) {
    // "/" applies the return path once signed in (app/page.tsx). Any other
    // signed-in request means it was used, refused or belongs to an earlier
    // visit, so it must not steer a later sign-in on this browser.
    if (pathname !== "/" && request.cookies.has(RETURN_TO_COOKIE))
      response.cookies.delete(RETURN_TO_COOKIE)
    return response
  }
  if (!isProtectedPath(pathname)) return response

  // Only reached on a protected path: actions used signed out (/login's) post
  // to their own public page and pass above.
  // Only a page read is sent to sign in and remembered. Anything else (a
  // Server Action, an upload to a route handler, a form) is not a page to
  // return to: a fetch would follow a redirect to the login HTML, and a
  // Server Action forwarded from /login back here fails without a reason.
  // A plain-text 401 reaches the caller as this message (Next shows it as a
  // Server Action's error), and nothing runs.
  if (request.method !== "GET" && request.method !== "HEAD") {
    return withSessionHeaders(
      response,
      new NextResponse(SESSION_ENDED_MESSAGE, {
        status: 401,
        headers: { "content-type": "text/plain" },
      })
    )
  }

  const returnTo = returnPathOf(request)
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = ROUTES.login
  loginUrl.search = returnTo
    ? `?${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`
    : ""
  const redirect = withSessionHeaders(
    response,
    NextResponse.redirect(loginUrl, 307)
  )
  // A prefetch is not a page the person asked for.
  if (returnTo && !isPrefetch(request)) {
    redirect.cookies.set(
      RETURN_TO_COOKIE,
      returnTo,
      returnToCookieOptions(request.nextUrl.protocol === "https:")
    )
  }
  return redirect
}

/** The requested page and query, without the router's cache-busting `_rsc`. */
function returnPathOf(request: NextRequest): string | null {
  const search = new URLSearchParams(request.nextUrl.search)
  search.delete("_rsc")
  const query = search.toString()
  return safeReturnPath(
    query ? `${request.nextUrl.pathname}?${query}` : request.nextUrl.pathname
  )
}

function isPrefetch(request: NextRequest) {
  return (
    request.headers.has("next-router-prefetch") ||
    /prefetch/i.test(request.headers.get("sec-purpose") ?? "") ||
    /prefetch/i.test(request.headers.get("purpose") ?? "")
  )
}

/**
 * Carries the refreshed (or cleared) session cookies and no-cache headers. The
 * answer depends on the session and may set cookies, so no cache may keep it.
 */
function withSessionHeaders(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie))
  for (const header of ["expires", "pragma"]) {
    const value = from.headers.get(header)
    if (value) to.headers.set(header, value)
  }
  to.headers.set("cache-control", "private, no-store")
  return to
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
