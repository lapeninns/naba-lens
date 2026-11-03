import "server-only"

import { notFound, redirect } from "next/navigation"

import { ROUTES } from "@/lib/auth/routes"
import type { CoverageResult } from "@/lib/server/coverage/types"

/**
 * A page's coverage read, or the matching navigation: sign-in, the blocked
 * page, 404 for anything not visible to the caller, and the segment's error
 * boundary (with Try again) for everything else.
 */
export function unwrap<T extends object>(result: CoverageResult<T>): T {
  if (result.ok) return result
  switch (result.code) {
    case "unauthenticated":
      redirect(ROUTES.login)
    case "account_inactive":
      redirect(ROUTES.blocked)
    case "not_found":
      notFound()
    default:
      // Error boundaries see only a digest in production; the code helps logs.
      throw new Error(`Coverage read failed: ${result.code}`)
  }
}

export const TASKS_PATH = "/staff/tasks"
export const PORTFOLIO_PATH = ROUTES.staffHome
export const WELCOME_PATH = "/staff/tasks/welcome"
