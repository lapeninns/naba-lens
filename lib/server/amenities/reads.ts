import "server-only"

import type {
  AmenityResult,
  CatalogueOption,
  CheckDetail,
  MyAmenityTask,
  SubmittableAsset,
  VenueAmenitiesView,
} from "@/lib/amenities/contract"
import type { MediaActor } from "@/lib/server/media/types"

import { amenityAccess, amenityVenue } from "./context"
import { amenityRpcFailure, failure, NOT_FOUND } from "./errors"
import { amenityRpc } from "./rpc"
import { parseCheckId, parseVenueId } from "./validate"
import {
  catalogueOption,
  checkPermissions,
  checkSummary,
  eventViews,
  myTasks,
  submissionViews,
  submittableAsset,
  venueLists,
} from "./views"

/**
 * A venue's checks for its manager or an admin. When Amenities are not enabled
 * the lists are empty and `canEnable` says whether the caller may enable them.
 */
export async function getVenueAmenities(
  actor: MediaActor,
  input: unknown
): Promise<AmenityResult<{ view: VenueAmenitiesView }>> {
  const venueId = parseVenueId(input)
  if (!venueId.ok) return venueId
  const venue = await amenityVenue(actor, venueId.value)
  if (!venue.ok) return venue
  const state = await amenityRpc(actor, "amenity_venue_state", {
    p_venue_id: venue.venueId,
  })
  if (state.error) return amenityRpcFailure(state.error, "venue state")
  const row = state.data[0]
  if (!row) return failure("not_found", "This venue could not be found.")
  const base = {
    venue: { id: row.venue_id, name: row.venue_name },
    enabled: row.enabled,
    canEnable: row.can_enable,
  }
  if (!row.enabled) return { ok: true, view: { ...base, ...venueLists([]) } }
  const checks = await amenityRpc(actor, "amenity_checks_for_venue", {
    p_venue_id: venue.venueId,
    p_include_archived: true,
  })
  if (checks.error) return amenityRpcFailure(checks.error, "venue checks")
  return { ok: true, view: { ...base, ...venueLists(checks.data) } }
}

/** The shared catalogue, marking keys the venue already has. */
export async function listCatalogue(
  actor: MediaActor,
  input: unknown
): Promise<AmenityResult<{ options: CatalogueOption[] }>> {
  const venueId = parseVenueId(input)
  if (!venueId.ok) return venueId
  const venue = await amenityVenue(actor, venueId.value)
  if (!venue.ok) return venue
  const { data, error } = await amenityRpc(
    actor,
    "amenity_catalogue_for_venue",
    { p_venue_id: venue.venueId }
  )
  if (error) return amenityRpcFailure(error, "catalogue")
  return {
    ok: true,
    options: data
      .map(catalogueOption)
      .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key)),
  }
}

/**
 * One check with its submissions, evidence and history. The database decides
 * visibility (and returns Wi-Fi notes only to those allowed to see them);
 * assignee options are read only for callers who may assign.
 */
export async function getCheck(
  actor: MediaActor,
  input: unknown
): Promise<AmenityResult<{ detail: CheckDetail }>> {
  const checkId = parseCheckId(input)
  if (!checkId.ok) return checkId
  const args = { p_check_id: checkId.value }
  const [access, check, submissions, assets, events] = await Promise.all([
    amenityAccess(actor),
    amenityRpc(actor, "amenity_check", args),
    amenityRpc(actor, "amenity_check_submissions", args),
    amenityRpc(actor, "amenity_check_submission_assets", args),
    amenityRpc(actor, "amenity_check_events", args),
  ])
  if (!access.ok) return access
  if (check.error) return amenityRpcFailure(check.error, "check")
  const row = check.data[0]
  if (!row) return NOT_FOUND
  if (submissions.error)
    return amenityRpcFailure(submissions.error, "check submissions")
  if (assets.error) return amenityRpcFailure(assets.error, "check evidence")
  if (events.error) return amenityRpcFailure(events.error, "check events")

  const permissions = checkPermissions(row, access.access)
  let assigneeOptions: CheckDetail["assigneeOptions"] = []
  if (permissions.canAssign) {
    const options = await amenityRpc(actor, "amenity_assignee_options", args)
    if (options.error)
      return amenityRpcFailure(options.error, "assignee options")
    assigneeOptions = options.data.map((o) => ({
      id: o.id,
      displayName: o.display_name,
      jobTitle: o.job_title,
    }))
  }
  return {
    ok: true,
    detail: {
      check: checkSummary(row),
      submissions: submissionViews(
        submissions.data,
        assets.data,
        row.current_submission_id
      ),
      events: eventViews(events.data),
      assigneeOptions,
      permissions,
    },
  }
}

/**
 * Active checks assigned to the caller that still need capturing. Takes no
 * input; typed as a service so callers pass `(actor, {})` like the others.
 * Only staff are assignable, so a manager account always gets an empty list.
 */
export const getMyAmenityTasks: (
  actor: MediaActor,
  input?: unknown
) => Promise<AmenityResult<{ tasks: MyAmenityTask[] }>> = async (actor) => {
  if (actor.profile.role === "manager") return { ok: true, tasks: [] }
  const { data, error } = await amenityRpc(actor, "amenity_my_checks", {})
  if (error) return amenityRpcFailure(error, "my checks")
  return { ok: true, tasks: myTasks(data, actor.profile.id) }
}

/** The caller's own uploads (and, for managers/admins, matching legacy Coverage media). */
export async function listSubmittableAssets(
  actor: MediaActor,
  input: unknown
): Promise<AmenityResult<{ assets: SubmittableAsset[] }>> {
  const checkId = parseCheckId(input)
  if (!checkId.ok) return checkId
  const { data, error } = await amenityRpc(
    actor,
    "amenity_submittable_assets",
    { p_check_id: checkId.value }
  )
  if (error) return amenityRpcFailure(error, "submittable assets")
  return { ok: true, assets: data.map(submittableAsset) }
}
