import { NextResponse } from "next/server"

/**
 * 303 redirect with a relative Location, so the browser stays on the origin it
 * used (and keeps the session cookies just set for it). `request.url` can name a
 * different host (e.g. localhost vs 127.0.0.1) behind dev servers and proxies.
 * It may carry session cookies, so no cache may store it.
 */
export function seeOther(path: `/${string}`): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: path, "Cache-Control": "private, no-store" },
  })
}
