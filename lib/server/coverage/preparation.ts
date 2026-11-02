import "server-only"

import type { Db, MediaActor } from "@/lib/server/media/types"

import { readAccess, resolveVenue } from "./context"
import { coverageRpcFailure, invalid } from "./errors"
import type {
  CoverageResult,
  PreparationRunView,
  PreparationStatusView,
} from "./types"
import { isObject, optionalUuid } from "./validate"
import { preparationStatusView } from "./admin"
import { runView } from "./views"

/** Admins with no venue prepare every active venue; everyone else one managed venue. */
async function preparationScope(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ venueId: string | null }>> {
  const venueId = optionalUuid(isObject(input) ? input.venueId : null)
  if (venueId === undefined) return invalid({ venueId: "Choose a venue." })
  if (!venueId) {
    const read = await readAccess(actor)
    if (!read.ok) return read
    if (read.access.isAdmin) return { ok: true, venueId: null }
  }
  const venue = await resolveVenue(actor, venueId)
  return venue.ok ? { ok: true, venueId: venue.venueId } : venue
}

/**
 * Prepares the current London month now (the same idempotent step the hourly
 * schedule runs): the checklist candidates of each in-scope active venue, then
 * a copied target (same venue only) or a needs-setup placeholder for each
 * active staff member without one. A failure comes back as a failed run.
 */
export async function prepareMonth(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ runs: PreparationRunView[] }>> {
  const scope = await preparationScope(actor, input)
  if (!scope.ok) return scope
  const { data, error } = await actor.db.rpc("prepare_coverage_month", {
    ...(scope.venueId ? { p_venue_id: scope.venueId } : {}),
  })
  if (error) return coverageRpcFailure(error, "prepare month")
  return { ok: true, runs: (data ?? []).map(runView) }
}

export async function getPreparationStatus(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ status: PreparationStatusView | null }>> {
  const scope = await preparationScope(actor, input)
  if (!scope.ok) return scope
  const { data, error } = await actor.db.rpc("coverage_preparation_status", {
    ...(scope.venueId ? { p_venue_id: scope.venueId } : {}),
  })
  if (error) return coverageRpcFailure(error, "preparation status")
  return {
    ok: true,
    status: data?.[0] ? preparationStatusView(data[0]) : null,
  }
}

/**
 * The hourly scheduled run (no user). Only the authenticated internal route
 * calls this, with the service role. Returns counts only.
 */
export async function runScheduledPreparation(
  service: Db
): Promise<
  { ok: true; failed: boolean; runs: PreparationRunView[] } | { ok: false }
> {
  const { data, error } = await service.rpc("prepare_coverage_month_scheduled")
  if (error) return { ok: false }
  const runs = (data ?? []).map(runView)
  return { ok: true, failed: runs.some((r) => r.status === "failed"), runs }
}
