import "server-only"

import { cache } from "react"

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

/** A failed read becomes the route's error boundary (Try again). */
export function failedRead(code: string): never {
  throw new Error(`Could not load menu photos: ${code}`)
}
