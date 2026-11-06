import type { Database } from "@/lib/db/types"

export type AppRole = Database["public"]["Enums"]["app_role"]

export const ROUTES = {
  login: "/login",
  /** Root of the staff area (and My portfolio); the protected prefix. */
  staffHome: "/staff",
  /** Home: where staff land, inside the staff area. */
  staffLanding: "/staff/tasks",
  adminHome: "/admin",
  blocked: "/auth/blocked",
} as const

/** Where a signed-in, active account lands after authentication. */
export function homePathFor(role: AppRole): string {
  return role === "admin" ? ROUTES.adminHome : ROUTES.staffLanding
}

/** Path prefixes that require a session (optimistic check in proxy.ts). */
export const PROTECTED_PREFIXES = [ROUTES.staffHome, ROUTES.adminHome] as const

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}
