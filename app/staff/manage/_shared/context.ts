import "server-only"

import { notFound } from "next/navigation"
import { cache } from "react"

import type { CoverageVenue } from "@/components/nabalens/coverage"
import { requireActiveAdmin, requireActiveStaff } from "@/lib/auth"
import {
  getCoverageActor,
  getCoverageScope,
} from "@/lib/server/coverage/context"
import type {
  CoverageFailure,
  VenueCoverageView,
} from "@/lib/server/coverage/types"
import { isUuid } from "@/lib/server/coverage/validate"
import { getVenueCoverage } from "@/lib/server/coverage/venue"
import type { MediaActor } from "@/lib/server/media/types"

/**
 * Who is using the venue tools and for which venue. Display and routing only:
 * every service call re-checks the grant (or admin role) in the database.
 */
export type ManageContext = {
  mode: "manager" | "admin"
  actor: MediaActor
  viewerId: string
  viewerName: string
  venue: CoverageVenue
  /** Venue for every service call: the manager's own venue, or the admin's choice. */
  venueId: string
  /** `/staff/manage` or `/admin/coverage/<venueId>`. */
  basePath: string
  /** Admin pages read the venue's coverage to resolve its name; reuse it. */
  coverage: VenueCoverageView | null
}

export type ManageAccess =
  | { ok: true; ctx: ManageContext }
  | { ok: false; viewerName: string; reason: "not_manager" }

/** Throws for the segment error boundary: a page cannot render without it. */
export function unexpected(failure: CoverageFailure): never {
  throw new Error(failure.message)
}

/**
 * `/staff/manage`: only an effective venue manager (active staff, unrevoked
 * grant for their current, active venue). Everyone else gets a plain refusal.
 */
export async function managerAccess(): Promise<ManageAccess> {
  const profile = await requireActiveStaff()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const scope = await getCoverageScope(auth.actor)
  if (!scope.ok) unexpected(scope)
  const venue = scope.scope.managedVenue
  if (!venue) {
    return { ok: false, viewerName: profile.displayName, reason: "not_manager" }
  }
  return {
    ok: true,
    ctx: {
      mode: "manager",
      actor: auth.actor,
      viewerId: profile.id,
      viewerName: profile.displayName,
      venue,
      venueId: venue.id,
      basePath: "/staff/manage",
      coverage: null,
    },
  }
}

/** `/admin/coverage/[venueId]`: an active admin acting on one venue. */
export async function adminVenueContext(
  venueId: string
): Promise<ManageContext> {
  const profile = await requireActiveAdmin()
  if (!isUuid(venueId)) notFound()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const coverage = await getVenueCoverage(auth.actor, { venueId })
  if (!coverage.ok) {
    if (coverage.code === "not_found" || coverage.code === "invalid_input")
      notFound()
    unexpected(coverage)
  }
  const venue = coverage.coverage.summary.venue
  return {
    mode: "admin",
    actor: auth.actor,
    viewerId: profile.id,
    viewerName: profile.displayName,
    venue: { id: venue.id, name: venue.name },
    venueId: venue.id,
    basePath: `/admin/coverage/${encodeURIComponent(venue.id)}`,
    coverage: coverage.coverage,
  }
}

/** One read of the venue's coverage per request, reusing the admin context's. */
export const readVenueCoverage = cache(
  async (
    ctx: ManageContext
  ): Promise<
    { ok: true; coverage: VenueCoverageView } | CoverageFailure
  > => {
    if (ctx.coverage) return { ok: true, coverage: ctx.coverage }
    const result = await getVenueCoverage(ctx.actor, { venueId: ctx.venueId })
    return result.ok ? { ok: true, coverage: result.coverage } : result
  }
)

/** The venue's coverage; throws for the segment error boundary on failure. */
export async function venueCoverage(
  ctx: ManageContext
): Promise<VenueCoverageView> {
  const result = await readVenueCoverage(ctx)
  if (!result.ok) unexpected(result)
  return result.coverage
}
