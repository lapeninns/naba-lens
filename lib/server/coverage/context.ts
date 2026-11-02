import "server-only"

import { isDepartment } from "@/lib/config/departments"
import { getMediaActor } from "@/lib/server/media/context"
import type { MediaActor } from "@/lib/server/media/types"

import {
  coverageRpcFailure,
  failure,
  invalid,
  NOT_PERMITTED,
  WRONG_VENUE,
} from "./errors"
import type {
  CoverageFailure,
  CoverageResult,
  CoverageScope,
  ProfileSetupGap,
} from "./types"
import { isUuid } from "./validate"

/** The caller's scope as the database sees it on this request. */
export type Access = {
  userId: string
  isAdmin: boolean
  /** Active staff (managers included). */
  isStaff: boolean
  venueId: string | null
  venueActive: boolean
  department: string | null
  /** Effective manager grant's venue (re-checked by the database every call). */
  managerVenueId: string | null
}

/**
 * Authorises the request with a fresh profile read (deactivation applies to
 * existing sessions) and builds the caller-scoped and service clients.
 */
export async function getCoverageActor(): Promise<
  CoverageResult<{ actor: MediaActor }>
> {
  const auth = await getMediaActor()
  if (auth.ok) return { ok: true, actor: auth.actor }
  if (auth.status === 401) return failure("unauthenticated", auth.message)
  if (auth.status === 403) return failure("account_inactive", auth.message)
  return failure("unavailable", auth.message)
}

/** Re-reads role, venue and manager grant from the database (never JWT claims). */
export async function readAccess(
  actor: MediaActor
): Promise<CoverageResult<{ access: Access }>> {
  const { data, error } = await actor.db.rpc("coverage_access_scope")
  if (error) return coverageRpcFailure(error, "scope")
  const row = data?.[0]
  if (!row || !row.active)
    return failure("account_inactive", "Your account is not active.")
  return {
    ok: true,
    access: {
      userId: row.user_id,
      isAdmin: row.is_admin,
      isStaff: row.role === "staff",
      venueId: row.venue_id,
      venueActive: row.venue_active,
      department: row.department,
      managerVenueId: row.manager_venue_id,
    },
  }
}

export function scopeOf(actor: MediaActor, access: Access): CoverageScope {
  const venue =
    access.venueId && actor.profile.venue?.id === access.venueId
      ? {
          id: access.venueId,
          name: actor.profile.venue.name,
          active: access.venueActive,
        }
      : null
  const missing: ProfileSetupGap[] = []
  if (access.isStaff) {
    if (!access.venueId) missing.push("venue")
    if (!isDepartment(access.department)) missing.push("team")
  }
  return {
    role: access.isAdmin ? "admin" : "staff",
    setup: { complete: missing.length === 0, missing },
    venue,
    managedVenue:
      access.managerVenueId && venue?.id === access.managerVenueId
        ? { id: venue.id, name: venue.name }
        : null,
    canSubmit: access.isStaff && !!access.venueId && access.venueActive,
    canManageVenue: access.isAdmin || !!access.managerVenueId,
    canManageGrants: access.isAdmin,
    canViewGroupOverview: access.isAdmin,
  }
}

/** Which coverage features the caller can use now; for navigation and page gating. */
export async function getCoverageScope(
  actor: MediaActor
): Promise<CoverageResult<{ scope: CoverageScope }>> {
  const read = await readAccess(actor)
  if (!read.ok) return read
  return { ok: true, scope: scopeOf(actor, read.access) }
}

/**
 * The venue a manager/admin operation acts on. A manager uses their effective
 * managed venue (a different `venueId` is `wrong_venue`); an admin must name
 * one. The database re-checks the grant inside the same transaction.
 */
export async function resolveVenue(
  actor: MediaActor,
  venueId: unknown
): Promise<CoverageResult<{ venueId: string; access: Access }>> {
  if (venueId !== undefined && venueId !== null && !isUuid(venueId))
    return invalid({ venueId: "Choose a venue." })
  const read = await readAccess(actor)
  if (!read.ok) return read
  const { access } = read
  if (access.isAdmin) {
    if (!venueId) return invalid({ venueId: "Choose a venue." })
    return { ok: true, venueId, access }
  }
  if (access.managerVenueId) {
    if (venueId && venueId !== access.managerVenueId) return WRONG_VENUE
    return { ok: true, venueId: access.managerVenueId, access }
  }
  return NOT_PERMITTED
}

/** Staff-only features (own tasks, submitting): admins and inactive accounts are refused. */
export function staffOnly(access: Access): CoverageFailure | null {
  return access.isStaff
    ? null
    : failure("not_permitted", "Only staff can submit photos for tasks.")
}

export async function adminOnly(
  actor: MediaActor
): Promise<CoverageResult<{ access: Access }>> {
  const read = await readAccess(actor)
  if (!read.ok) return read
  return read.access.isAdmin
    ? read
    : failure("not_permitted", "Only an active admin can do this.")
}
