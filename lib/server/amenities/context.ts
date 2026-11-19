import "server-only"

import type { AmenityResult } from "@/lib/amenities/contract"
import {
  getCoverageActor,
  readAccess,
  resolveVenue,
  type Access,
} from "@/lib/server/coverage/context"
import type { MediaActor } from "@/lib/server/media/types"

import { fromCoverage } from "./errors"

/**
 * Authorises the request with a fresh profile read (deactivation applies to
 * existing sessions) and builds the caller-scoped and service clients.
 */
export async function getAmenityActor(): Promise<
  AmenityResult<{ actor: MediaActor }>
> {
  const auth = await getCoverageActor()
  return auth.ok ? auth : fromCoverage(auth)
}

/** Role, venue and manager grant as the database sees them now. */
export async function amenityAccess(
  actor: MediaActor
): Promise<AmenityResult<{ access: Access }>> {
  const read = await readAccess(actor)
  return read.ok ? read : fromCoverage(read)
}

/**
 * The venue a manager/admin operation acts on: a manager's effective managed
 * venue (another `venueId` is `wrong_venue`), or the venue an admin names.
 * The database re-checks the grant in the same transaction.
 */
export async function amenityVenue(
  actor: MediaActor,
  venueId: string | null
): Promise<AmenityResult<{ venueId: string; access: Access }>> {
  const resolved = await resolveVenue(actor, venueId)
  return resolved.ok ? resolved : fromCoverage(resolved)
}
