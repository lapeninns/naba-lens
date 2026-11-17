"use server"

import {
  AREA_QUEUE_LIMIT,
  decideAreaPhoto,
  listAreaPhotoQueue,
  type AreaPhotoCard,
  type AreaPhotoState,
} from "@/lib/server/area-photos"
import type { CoverageFailure } from "@/lib/server/coverage/types"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"

// G-9: one decision on an area photo, from the manager workspace or the admin
// Review page. Inputs are `unknown` (a public POST endpoint); the venue comes
// from the manager's workspace scope, and an admin names it. The database
// re-checks the venue and refuses a decision on the caller's own photo.
export async function decideAreaPhotoAction(input: {
  venueId?: unknown
  labelId: unknown
  decision: unknown
  reason?: unknown
}): Promise<{ ok: true; state: AreaPhotoState } | CoverageFailure> {
  const scope = await getManagerPhotoCtx(input?.venueId)
  if (!scope.ok) return scope
  return decideAreaPhoto(
    scope.ctx,
    input?.labelId,
    input?.decision,
    input?.reason
  )
}

/**
 * The oldest waiting area photos again, for Review in a thumb once the ones
 * it has are decided (DESIGN.md §6.5). The queue has no cursor; decided
 * photos leave it, so a re-read brings the next ones. `more`: a full page.
 */
export async function loadAreaReviewAction(input: {
  venueId?: unknown
}): Promise<
  { ok: true; cards: AreaPhotoCard[]; more: boolean } | CoverageFailure
> {
  const scope = await getManagerPhotoCtx(input?.venueId)
  if (!scope.ok) return scope
  const read = await listAreaPhotoQueue(scope.ctx, "pending")
  if (!read.ok) return read
  return {
    ok: true,
    cards: read.cards,
    more: read.cards.length >= AREA_QUEUE_LIMIT,
  }
}
