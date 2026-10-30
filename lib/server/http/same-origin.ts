/**
 * CSRF backstop for state-changing routes that take cookies (wave 3 finding 7).
 *
 * Browsers send `Origin` on every cross-site POST and `Sec-Fetch-Site` on every
 * request they make, and neither can be forged by a page. A request passes when:
 *   - `Sec-Fetch-Site`, if present, is `same-origin` (or `none`: typed/bookmarked);
 *   - `Origin`, if present, has the host the request was sent to.
 * The host comes from the Host header (or X-Forwarded-Host behind a proxy), not
 * from `request.nextUrl`, whose host Next normalises (`127.0.0.1` reads as
 * `localhost` in development). Non-browser clients send neither header; they hold
 * no victim's cookies, so they are not a CSRF vector.
 */
export function isSameOriginRequest(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") return false

  const origin = headers.get("origin")
  if (!origin) return true
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase()
  if (!host) return false
  try {
    return new URL(origin).host.toLowerCase() === host
  } catch {
    // Includes the opaque "null" origin (sandboxed frames, some redirects).
    return false
  }
}
