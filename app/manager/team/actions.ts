"use server"

import { getManagerPhotoCtx } from "@/lib/server/menu-photos"
import {
  setPersonTarget,
  setVenueDefaultTarget,
} from "@/lib/server/coverage/targets"

// Server Functions of the manager team screen (G-6). Every input is
// `unknown` (public POST endpoints) and every call re-authorises: a manager's
// venue comes from the workspace scope (another `venueId` is wrong_venue),
// and the database checks the grant again. The screen re-reads itself after a
// save (router.refresh), so nothing is revalidated here.

const venueOf = (input: unknown) =>
  input && typeof input === "object" && "venueId" in input
    ? input.venueId
    : undefined

/** `{ targetCount: number | null, reason?, expectedRevision }` */
export async function setVenueDefaultTargetAction(input: unknown) {
  const scope = await getManagerPhotoCtx(venueOf(input))
  if (!scope.ok) return scope
  return setVenueDefaultTarget(scope.ctx, input)
}

/** `{ staffId, targetCount, reason?, expectedRevision }`, this month only. */
export async function setPersonTargetAction(input: unknown) {
  const scope = await getManagerPhotoCtx(venueOf(input))
  if (!scope.ok) return scope
  return setPersonTarget(scope.ctx, input)
}
