import type { Database } from "@/lib/db/types"

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
