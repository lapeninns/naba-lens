import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"

import { loginHref, ROUTES } from "@/lib/auth/routes"
import {
  getManagerOverview,
  getManagerPhotoCtx,
  type ManagerOverview,
  type ManagerPhotoCtx,
  type MenuPhotoResult,
} from "@/lib/server/menu-photos"

/**
 * The manager's photo scope and venue overview, read once per render pass so
 * the layout (Review badge) and the page (Overview, Menu) share one read.
 * Never cached across requests.
 */
export const loadManagerOverview = cache(
  async (): Promise<
    MenuPhotoResult<{ ctx: ManagerPhotoCtx; overview: ManagerOverview }>
  > => {
    const scope = await getManagerPhotoCtx()
    if (!scope.ok) return scope
    const read = await getManagerOverview(scope.ctx)
    if (!read.ok) return read
    return { ok: true, ctx: scope.ctx, overview: read.overview }
  }
)

/**
 * The database refused the manager's scope: the grant ended, the venue moved
 * or closed, or the account is no longer an active manager. The workspace read
 * earlier in the same render can still say available (it is memoised per
 * render pass), so these refusals are not errors to retry.
 */
export function isRefusal(code: string): boolean {
  return (
    code === "not_permitted" ||
    code === "wrong_venue" ||
    code === "account_inactive"
  )
}

/**
 * A failed read on a page below Overview. A refusal goes to Overview, whose
 * fresh workspace read shows Venue access unavailable (or sends a changed or
 * deactivated account to its own home); an expired session goes to sign in,
 * back to `path` (the page asked for) afterwards. Anything else becomes the
 * route's error boundary (Try again).
 */
export function failedRead(
  code: string,
  what = "menu photos",
  path?: string
): never {
  if (code === "unauthenticated") redirect(loginHref(path))
  if (isRefusal(code)) redirect(ROUTES.managerHome)
  throw new Error(`Could not load ${what}: ${code}`)
}
