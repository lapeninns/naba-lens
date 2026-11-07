import "server-only"

import type { AmenityResult } from "@/lib/amenities/contract"
import { readAccess, type Access } from "@/lib/server/coverage/context"
import {
  failure as coverageFailure,
  WRONG_VENUE,
} from "@/lib/server/coverage/errors"
import { getMediaActor, ROLE_NOT_ALLOWED } from "@/lib/server/media/context"
import type { MediaActor } from "@/lib/server/media/types"

import { fromCoverage, invalid, NOT_PERMITTED } from "./errors"
import { isUuid } from "./validate"

/**
 * Roles admitted to the amenity services and evidence routes. Unlike Coverage,
 * venue manager accounts are in: they run their venue's Amenities (the
 * database re-checks the effective grant in every call).
 */
export const AMENITY_ROLES = ["staff", "manager", "admin"] as const

/**
 * Authorises the request with a fresh profile read (deactivation applies to
 * existing sessions) and builds the caller-scoped and service clients.
 */
export async function getAmenityActor(): Promise<
  AmenityResult<{ actor: MediaActor }>
> {
  const auth = await getMediaActor(AMENITY_ROLES)
  if (auth.ok) return { ok: true, actor: auth.actor }
  const code =
    auth.status === 401
      ? "unauthenticated"
      : auth.message === ROLE_NOT_ALLOWED.message
        ? "not_permitted"
        : auth.status === 403
          ? "account_inactive"
          : "unavailable"
  return fromCoverage(coverageFailure(code, auth.message))
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
 * Managers are manager accounts and, transitionally, staff holding a grant.
 * The database re-checks the grant in the same transaction.
 */
export async function amenityVenue(
  actor: MediaActor,
  venueId: string | null
): Promise<AmenityResult<{ venueId: string; access: Access }>> {
  if (venueId !== null && !isUuid(venueId))
    return invalid({ venueId: "Choose a venue." })
  const read = await amenityAccess(actor)
  if (!read.ok) return read
  const { access } = read
  if (access.isAdmin) {
    if (!venueId) return invalid({ venueId: "Choose a venue." })
    return { ok: true, venueId, access }
  }
  if ((access.isManager || access.isStaff) && access.managerVenueId) {
    if (venueId && venueId !== access.managerVenueId)
      return fromCoverage(WRONG_VENUE)
    return { ok: true, venueId: access.managerVenueId, access }
  }
  return NOT_PERMITTED
}
