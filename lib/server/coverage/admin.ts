import "server-only"

import type { MediaActor } from "@/lib/server/media/types"

import { adminOnly } from "./context"
import {
  coverageRpcFailure,
  invalid,
  NOT_FOUND,
  unavailableFailure,
} from "./errors"
import {
  isPeriodKey,
  periodKeyOf,
  periodMonthDate,
  periodOfDate,
  periodView,
} from "./time"
import type {
  CoveragePerson,
  CoverageResult,
  GrantRevokeKind,
  GroupOverviewRow,
  ManagerGrantView,
  MenuState,
  MissingPeriod,
  Page,
  PeriodView,
  PreparationRunView,
  PreparationStatusView,
  SelfReviewView,
} from "./types"
import {
  isObject,
  isUuid,
  LIMITS,
  optionalText,
  optionalUuid,
} from "./validate"
import {
  decodeKey,
  encodeKey,
  evidenceAsset,
  personFromProgress,
  runView,
} from "./views"

const objectOrEmpty = (input: unknown) =>
  isObject(input) ? input : input == null ? {} : null

// ---- Manager grants (admin) ------------------------------------------------------

export async function listManagerGrants(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ grants: ManagerGrantView[] }>> {
  const args = objectOrEmpty(input)
  if (!args) return invalid({})
  const venueId = optionalUuid(args.venueId)
  if (venueId === undefined) return invalid({ venueId: "Choose a venue." })
  const admin = await adminOnly(actor)
  if (!admin.ok) return admin
  const { data, error } = await actor.db.rpc("venue_manager_grant_list", {
    ...(venueId ? { p_venue_id: venueId } : {}),
    p_include_revoked: args.includeRevoked === true,
  })
  if (error) return coverageRpcFailure(error, "manager grants")
  return {
    ok: true,
    grants: (data ?? []).map((g) => ({
      id: g.grant_id,
      staff: {
        id: g.staff_id,
        displayName: g.staff_name,
        active: g.staff_active,
      },
      staffVenueId: g.staff_venue_id,
      venue: { id: g.venue_id, name: g.venue_name },
      grantedBy: { id: g.granted_by, displayName: g.granted_by_name },
      grantedAt: g.granted_at,
      grantReason: g.grant_reason,
      revokedAt: g.revoked_at,
      revokedByName: g.revoked_by_name,
      revokeKind: g.revoke_kind as GrantRevokeKind | null,
      revokeReason: g.revoke_reason,
      effective: g.effective,
    })),
  }
}

/** Active staff currently at the venue: the only people who can be granted manager rights there. */
export async function listGrantCandidates(
  actor: MediaActor,
  input: unknown
): Promise<
  CoverageResult<{ people: (CoveragePerson & { isManager: boolean })[] }>
> {
  if (!isObject(input) || !isUuid(input.venueId))
    return invalid({ venueId: "Choose a venue." })
  const admin = await adminOnly(actor)
  if (!admin.ok) return admin
  const { data, error } = await actor.db.rpc("coverage_staff_progress", {
    p_venue_id: input.venueId,
  })
  if (error) return coverageRpcFailure(error, "grant candidates")
  return {
    ok: true,
    people: (data ?? [])
      .filter((r) => r.is_current_member)
      .map((r) => ({ ...personFromProgress(r), isManager: r.is_manager })),
  }
}

/**
 * Grants manager rights for the person's current venue. One open grant per
 * person; a transfer, deactivation or role change revokes it automatically.
 */
export async function grantVenueManager(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ grantId: string }>> {
  if (!isObject(input) || !isUuid(input.staffId)) return NOT_FOUND
  if (!isUuid(input.venueId)) return invalid({ venueId: "Choose a venue." })
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (reason === undefined)
    return invalid({ reason: "Use up to 500 characters." })
  const { data, error } = await actor.db.rpc("grant_venue_manager", {
    p_staff_id: input.staffId,
    p_venue_id: input.venueId,
    ...(reason ? { p_reason: reason } : {}),
  })
  if (error) return coverageRpcFailure(error, "grant manager")
  return { ok: true, grantId: data }
}

/** Revokes a grant with a reason; existing sessions lose manager rights on their next request. */
export async function revokeVenueManager(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult> {
  if (!isObject(input) || !isUuid(input.grantId)) return NOT_FOUND
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (!reason)
    return invalid({ reason: "Enter a reason of up to 500 characters." })
  const { error } = await actor.db.rpc("revoke_venue_manager", {
    p_grant_id: input.grantId,
    p_reason: reason,
  })
  if (error) return coverageRpcFailure(error, "revoke manager")
  return { ok: true }
}

// ---- Oversight (admin) -------------------------------------------------------------

type StatusRow = {
  period_month: string
  last_run_at: string | null
  last_status: string | null
  last_success_at: string | null
  last_failure_at: string | null
  last_error_code: string | null
  staff_without_target: number
  targets_needing_setup: number
}

export function preparationStatusView(row: StatusRow): PreparationStatusView {
  return {
    period: periodView(periodOfDate(row.period_month)),
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status as PreparationStatusView["lastStatus"],
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastErrorCode: row.last_error_code,
    staffWithoutTarget: row.staff_without_target,
    targetsNeedingSetup: row.targets_needing_setup,
  }
}

/**
 * Per active venue: coverage completion and staff participation (reported
 * separately), effective managers, self-reviews, and monthly preparation
 * health (last run, recent failures, venues with staff missing a target).
 */
export async function getGroupOverview(
  actor: MediaActor,
  input: unknown
): Promise<
  CoverageResult<{
    period: PeriodView
    venues: GroupOverviewRow[]
    preparation: {
      status: PreparationStatusView | null
      recentFailures: PreparationRunView[]
      missingPeriods: MissingPeriod[]
    }
  }>
> {
  const args = objectOrEmpty(input)
  if (!args) return invalid({})
  if (args.period != null && !isPeriodKey(args.period))
    return invalid({ period: "Choose a month." })
  const admin = await adminOnly(actor)
  if (!admin.ok) return admin
  const period = (args.period as string | undefined) ?? periodKeyOf(new Date())
  const [overview, grants, status, failures] = await Promise.all([
    actor.db.rpc("coverage_group_overview", {
      p_period_month: periodMonthDate(period),
    }),
    actor.db.rpc("venue_manager_grant_list", {}),
    actor.db.rpc("coverage_preparation_status", {}),
    actor.db
      .from("coverage_preparation_runs")
      .select("*")
      .eq("status", "failed")
      .order("finished_at", { ascending: false })
      .limit(5),
  ])
  if (overview.error)
    return coverageRpcFailure(overview.error, "group overview")
  if (grants.error) return coverageRpcFailure(grants.error, "overview grants")
  if (status.error)
    return coverageRpcFailure(status.error, "preparation status")
  if (failures.error)
    return unavailableFailure("preparation failures", failures.error)

  const managers = new Map<string, { id: string; displayName: string }[]>()
  for (const g of grants.data ?? []) {
    if (!g.effective) continue
    const list = managers.get(g.venue_id) ?? []
    list.push({ id: g.staff_id, displayName: g.staff_name })
    managers.set(g.venue_id, list)
  }
  const rows = overview.data ?? []
  return {
    ok: true,
    period: periodView(period),
    venues: rows.map((r) => ({
      venue: { id: r.venue_id, name: r.venue_name },
      managers: managers.get(r.venue_id) ?? [],
      coverage: {
        applicable: r.applicable_count,
        satisfied: r.satisfied_count,
        needsSetup: r.needs_setup_count,
        pendingReview: r.pending_review_count,
        overdue: r.overdue_count,
        needsReassignment: r.needs_reassignment_count,
        amenityUnknown: r.amenity_unknown_count,
        menuState: r.menu_state as MenuState,
        complete: r.coverage_complete,
      },
      participation: {
        staff: r.staff_count,
        targetsSet: r.targets_set,
        targetsNeedingSetup: r.targets_needing_setup,
        staffWithoutTarget: r.staff_without_target,
        complete: r.participation_complete,
        acceptedPhotos: r.accepted_photos,
      },
      selfReviews: r.self_review_count,
      lastPreparation:
        r.last_preparation_at && r.last_preparation_status
          ? {
              at: r.last_preparation_at,
              status: r.last_preparation_status as "succeeded" | "failed",
            }
          : null,
    })),
    preparation: {
      status: status.data?.[0] ? preparationStatusView(status.data[0]) : null,
      recentFailures: (failures.data ?? []).map(runView),
      missingPeriods: rows
        .filter((r) => r.staff_without_target > 0)
        .map((r) => ({
          venue: { id: r.venue_id, name: r.venue_name },
          period,
          staffWithoutTarget: r.staff_without_target,
        })),
    },
  }
}

/** Decisions where the reviewer was the photo's author, newest first. */
export async function listSelfReviews(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<Page<SelfReviewView>>> {
  const args = objectOrEmpty(input)
  if (!args) return invalid({})
  const venueId = optionalUuid(args.venueId)
  if (venueId === undefined) return invalid({ venueId: "Choose a venue." })
  if (args.period != null && !isPeriodKey(args.period))
    return invalid({ period: "Choose a month." })
  const cursor = typeof args.cursor === "string" ? args.cursor : null
  const after = decodeKey(cursor)
  if (cursor && (!after || !/^\d+$/.test(after.id)))
    return invalid({ cursor: "Invalid page cursor." })
  const admin = await adminOnly(actor)
  if (!admin.ok) return admin

  let query = actor.db
    .from("coverage_review_events")
    .select(
      "id, item_id, venue_id, author_id, action, to_state, reason, created_at, venue:venues(name), author:profiles!coverage_review_events_author_id_fkey(display_name), item:coverage_submission_items!coverage_review_events_item_id_fkey(asset_id)"
    )
    .eq("self_review", true)
  if (venueId) query = query.eq("venue_id", venueId)
  if (args.period) {
    const view = periodView(args.period as string)
    query = query.gte("created_at", view.startsAt).lt("created_at", view.endsAt)
  }
  if (after)
    query = query.or(
      `created_at.lt."${after.at}",and(created_at.eq."${after.at}",id.lt.${after.id})`
    )
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIMITS.pageSize + 1)
  if (error) return unavailableFailure("self reviews", error)
  const rows = data ?? []
  const page = rows.slice(0, LIMITS.pageSize)

  const assetIds = [
    ...new Set(page.flatMap((r) => (r.item ? [r.item.asset_id] : []))),
  ]
  const assets = assetIds.length
    ? await actor.db
        .from("media_assets")
        .select(
          "id, thumbnail_path, preview_path, width, height, upload_state, deleted_at"
        )
        .in("id", assetIds)
    : { data: [], error: null }
  if (assets.error)
    return unavailableFailure("self review photos", assets.error)
  const byId = new Map((assets.data ?? []).map((a) => [a.id, a]))
  const last = rows.length > LIMITS.pageSize ? page[page.length - 1] : null
  return {
    ok: true,
    items: page.map((r) => {
      const assetId = r.item?.asset_id ?? ""
      const a = byId.get(assetId)
      return {
        eventId: String(r.id),
        submissionId: r.item_id,
        venue: { id: r.venue_id, name: r.venue?.name ?? "" },
        author: {
          id: r.author_id,
          displayName: r.author?.display_name ?? null,
        },
        decision:
          r.action === "reconciled"
            ? "reconciled"
            : r.to_state === "accepted"
              ? "accept"
              : "needs_another_photo",
        reason: r.reason,
        decidedAt: r.created_at,
        asset: evidenceAsset(
          assetId,
          !!a?.thumbnail_path,
          !!a?.preview_path,
          a?.width ?? null,
          a?.height ?? null,
          !!a && a.upload_state === "ready" && !a.deleted_at
        ),
      }
    }),
    nextCursor: last ? encodeKey(last.created_at, last.id) : null,
  }
}

/** Monthly preparation runs, newest first (admins: all; a venue filter is optional). */
export async function listPreparationRuns(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<Page<PreparationRunView>>> {
  const args = objectOrEmpty(input)
  if (!args) return invalid({})
  const venueId = optionalUuid(args.venueId)
  if (venueId === undefined) return invalid({ venueId: "Choose a venue." })
  const cursor = typeof args.cursor === "string" ? args.cursor : null
  const after = decodeKey(cursor)
  if (cursor && (!after || !isUuid(after.id)))
    return invalid({ cursor: "Invalid page cursor." })
  const admin = await adminOnly(actor)
  if (!admin.ok) return admin
  let query = actor.db.from("coverage_preparation_runs").select("*")
  if (venueId)
    query = query.or(`scope_venue_id.is.null,scope_venue_id.eq.${venueId}`)
  if (after)
    query = query.or(
      `finished_at.lt."${after.at}",and(finished_at.eq."${after.at}",id.lt.${after.id})`
    )
  const { data, error } = await query
    .order("finished_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIMITS.pageSize + 1)
  if (error) return unavailableFailure("preparation runs", error)
  const rows = data ?? []
  const page = rows.slice(0, LIMITS.pageSize)
  const last = rows.length > LIMITS.pageSize ? page[page.length - 1] : null
  return {
    ok: true,
    items: page.map(runView),
    nextCursor: last ? encodeKey(last.finished_at, last.id) : null,
  }
}
