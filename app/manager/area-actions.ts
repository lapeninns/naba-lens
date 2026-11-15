"use server"

import { decideAreaPhoto, type AreaPhotoState } from "@/lib/server/area-photos"
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
