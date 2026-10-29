import { NextResponse, type NextRequest } from "next/server"

import { isProtectedPath, ROUTES } from "@/lib/auth/routes"
import { updateSession } from "@/lib/supabase/proxy"

/**
 * Next 16 Proxy (formerly Middleware): refreshes the Supabase session and sends
 * signed-out visitors of protected areas to /login. Optimistic only — every page,
 * Server Function and Route Handler re-authorises against the database via lib/auth.
 */
export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request)

  if (!userId && isProtectedPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = ROUTES.login
    loginUrl.search = ""
    const redirect = NextResponse.redirect(loginUrl)
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header)
      if (value) redirect.headers.set(header, value)
    }
    return redirect
  }

  return response
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
