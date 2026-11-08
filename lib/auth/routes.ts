import type { Database } from "@/lib/db/types"
import { getSiteUrl } from "@/lib/supabase/env"

export type AppRole = Database["public"]["Enums"]["app_role"]

export const ROUTES = {
  login: "/login",
  /** Root of the staff area (and My portfolio); the protected prefix. */
  staffHome: "/staff",
  /** Home: where staff land, inside the staff area. */
  staffLanding: "/staff/tasks",
  /** Venue manager workspace (Overview); the protected prefix. */
  managerHome: "/manager",
  managerReview: "/manager/review",
  managerMenu: "/manager/menu",
  managerAccount: "/manager/account",
  adminHome: "/admin",
  blocked: "/auth/blocked",
} as const

/**
 * Where a signed-in, active account lands after authentication. Exhaustive:
 * a new role fails to compile until it has a home.
 */
export function homePathFor(role: AppRole): string {
  switch (role) {
    case "staff":
      return ROUTES.staffLanding
    case "manager":
      return ROUTES.managerHome
    case "admin":
      return ROUTES.adminHome
    default: {
      const unknownRole: never = role
      throw new Error(`No home for role ${String(unknownRole)}`)
    }
  }
}

/** Path prefixes that require a session (optimistic check in proxy.ts). */
export const PROTECTED_PREFIXES = [
  ROUTES.staffHome,
  ROUTES.managerHome,
  ROUTES.adminHome,
] as const

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

/**
 * Query parameter on /login naming the page to return to after signing in.
 * Read only through `safeReturnPath`.
 */
export const RETURN_TO_PARAM = "next"

/**
 * Cookie carrying the return path from the protected page to wherever sign-in
 * finishes. The email templates link to the site URL, so an emailed link cannot
 * carry it; "/" reads it after the role check (`returnPathFor`) and the proxy
 * clears it on the first protected page after sign-in.
 */
export const RETURN_TO_COOKIE = "nl-return-to"

/** About as long as an emailed sign-in link stays usable. */
export const RETURN_TO_MAX_AGE_SECONDS = 60 * 60

/**
 * HttpOnly, Lax and short-lived; Secure on HTTPS, which the configured site
 * URL decides in production even behind a proxy that terminates TLS.
 */
export function returnToCookieOptions(requestIsHttps = false) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: requestIsHttps || getSiteUrl().startsWith("https:"),
    path: "/",
    maxAge: RETURN_TO_MAX_AGE_SECONDS,
  }
}

const RETURN_PATH_MAX_LENGTH = 1024
/**
 * Printable ASCII except space and backslash. A path the app made is already
 * percent-encoded, so anything else is a parser trick or not ours.
 */
const RETURN_PATH_CHARACTERS = /^[\x21-\x5b\x5d-\x7e]+$/
/**
 * Refused in any decoded layer: control characters, backslashes, empty or dot
 * segments (`//`, `/./`, `/../`) and a colon in the path (a scheme).
 */
const UNSAFE_DECODED_PATH = /[\x00-\x1f\x7f\\:]|\/\/|\/\.{1,2}(?:\/|$)/
const UNSAFE_DECODED_QUERY = /[\x00-\x1f\x7f]/
/** More encoding layers than any link the app builds. */
const MAX_DECODE_LAYERS = 3
const PARSE_BASE = "http://return-path.invalid"

function decodeLayers(value: string, unsafe: RegExp, inAppArea: boolean) {
  let layer = value
  for (let round = 0; ; round++) {
    if (unsafe.test(layer)) return false
    if (inAppArea && !isProtectedPath(layer)) return false
    let decoded: string
    try {
      decoded = decodeURIComponent(layer)
    } catch {
      // A malformed escape as sent is refused; one that only appears after
      // decoding came from an encoded "%" (`%25`), and no browser decodes twice.
      return round > 0
    }
    if (decoded === layer) return true
    if (round === MAX_DECODE_LAYERS) return false
    layer = decoded
  }
}

/**
 * The page to return to after signing in, or null. Only a same-origin,
 * relative path inside an app area (/staff, /manager, /admin), with its query
 * and no fragment, is kept; /login, /auth and /api are never returned to.
 * Protocol-relative, backslash, scheme, dot-segment, control-character and
 * (double-)encoded variants of those are refused. Whether the signed-in role
 * may open it is `returnPathFor`, and the page's own guard still decides.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  if (raw.length === 0 || raw.length > RETURN_PATH_MAX_LENGTH) return null
  if (!RETURN_PATH_CHARACTERS.test(raw)) return null
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("#"))
    return null

  let url: URL
  try {
    url = new URL(raw, PARSE_BASE)
  } catch {
    return null
  }
  // Anything the URL parser rewrote (dot segments, an encoded "..") is refused
  // rather than followed.
  if (url.origin !== PARSE_BASE || url.pathname + url.search !== raw)
    return null
  if (!decodeLayers(url.pathname, UNSAFE_DECODED_PATH, true)) return null
  if (!decodeLayers(url.search, UNSAFE_DECODED_QUERY, false)) return null
  return raw
}

const ROLE_AREAS: Record<AppRole, string> = {
  staff: ROUTES.staffHome,
  manager: ROUTES.managerHome,
  admin: ROUTES.adminHome,
}

/**
 * Where an active account goes after signing in: the safe return path when it
 * is in the role's own area, otherwise the role's home. A wrong-role path is
 * never followed; its page guard would refuse it anyway.
 */
export function returnPathFor(role: AppRole, raw: unknown): string {
  const path = safeReturnPath(raw)
  if (path) {
    const area = ROLE_AREAS[role]
    const pathname = path.split("?", 1)[0]
    if (pathname === area || pathname.startsWith(`${area}/`)) return path
  }
  return homePathFor(role)
}

/** /login, returning to `returnTo` after sign-in when it is a safe path. */
export function loginHref(returnTo?: string | null): string {
  const path = safeReturnPath(returnTo)
  return path
    ? `${ROUTES.login}?${RETURN_TO_PARAM}=${encodeURIComponent(path)}`
    : ROUTES.login
}
