import "server-only"

import type { MediaActor } from "@/lib/server/media/types"

import { resolveVenue } from "./context"
import {
  coverageRpcFailure,
  failure,
  invalid,
  NOT_FOUND,
  unavailableFailure,
} from "./errors"
import type {
  CoverageResult,
  MenuCoverageView,
  MenuPlanStatus,
  MenuPlanView,
  MenuState,
} from "./types"
import {
  intInRange,
  isObject,
  isUuid,
  LIMITS,
  optionalText,
  optionalUuid,
  uuidList,
} from "./validate"
import { requirementView, venuePeople } from "./views"

const BAD_REQUEST = invalid({}, "This request is invalid. Reload the page.")
const MAX_REVISION = 2 ** 31 - 1

type PlanRow = {
  id: string
  status: string
  menu_version_id: string
  revision: number
  reconciliation_required: boolean
  reconciled_at: string | null
  confirmed_at: string | null
  created_at: string
}

function planView(row: PlanRow): MenuPlanView {
  return {
    id: row.id,
    status: row.status as MenuPlanStatus,
    menuVersionId: row.menu_version_id,
    revision: row.revision,
    reconciliationRequired: row.reconciliation_required,
    reconciledAt: row.reconciled_at,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  }
}

/**
 * Menu coverage for the venue's active menu: the draft plan being set up, the
 * confirmed plan, and requirements of a superseded plan that still need
 * explicit reconciliation. Sections come from the active version only.
 */
export async function getMenuCoverage(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ menu: MenuCoverageView }>> {
  const venue = await resolveVenue(
    actor,
    isObject(input) ? input.venueId : null
  )
  if (!venue.ok) return venue
  const venueId = venue.venueId
  const [summary, plans, requirements, version, people] = await Promise.all([
    actor.db.rpc("venue_coverage_summary", { p_venue_id: venueId }),
    actor.db
      .from("menu_coverage_plans")
      .select(
        "id, status, menu_version_id, revision, reconciliation_required, reconciled_at, confirmed_at, created_at"
      )
      .eq("venue_id", venueId)
      .in("status", ["draft", "confirmed"]),
    actor.db.rpc("coverage_requirement_progress", { p_venue_id: venueId }),
    actor.db
      .from("menu_versions")
      .select("id, title, activated_at")
      .eq("venue_id", venueId)
      .eq("status", "active")
      .maybeSingle(),
    venuePeople(actor, venueId, true),
  ])
  if (summary.error) return coverageRpcFailure(summary.error, "menu summary")
  if (requirements.error)
    return coverageRpcFailure(requirements.error, "menu requirements")
  if (plans.error) return unavailableFailure("read menu plans", plans.error)
  if (version.error)
    return unavailableFailure("read active menu", version.error)
  const row = summary.data?.[0]
  if (!row) return failure("not_found", "This venue could not be found.")

  const sections = version.data
    ? await actor.db
        .from("menu_sections")
        .select("id, name, kind, position")
        .eq("version_id", version.data.id)
        .order("position")
    : { data: [], error: null }
  if (sections.error)
    return unavailableFailure("read menu sections", sections.error)

  const draft = (plans.data ?? []).find((p) => p.status === "draft") ?? null
  const current =
    (plans.data ?? []).find((p) => p.status === "confirmed") ?? null
  const menuRows = (requirements.data ?? []).filter(
    (r) => r.kind === "menu_section"
  )
  const views = (planId: string | null) =>
    menuRows
      .filter((r) => planId && r.menu_plan_id === planId)
      .map((r) => requirementView(r, people))
  return {
    ok: true,
    menu: {
      venue: { id: row.venue_id, name: row.venue_name },
      menuState: row.menu_state as MenuState,
      activeVersion: version.data
        ? {
            id: version.data.id,
            title: version.data.title,
            activatedAt: version.data.activated_at,
            sections: (sections.data ?? []).map((s) => ({
              sectionId: s.id,
              name: s.name,
              kind: s.kind,
              position: s.position,
            })),
          }
        : null,
      draftPlan: draft ? planView(draft) : null,
      currentPlan: current ? planView(current) : null,
      draft: views(draft?.id ?? null),
      current: views(current?.id ?? null),
      superseded: menuRows
        .filter((r) => r.menu_plan_status === "superseded")
        .map((r) => requirementView(r, people)),
    },
  }
}

/**
 * Starts (or returns) the draft plan for the venue's ACTIVE menu version: one
 * needs-setup task per section of that exact version, with a display
 * snapshot. Configure or exclude each, then confirm the plan.
 */
export async function startMenuCoverage(
  actor: MediaActor,
  input: unknown
): Promise<
  CoverageResult<{ planId: string; revision: number; created: boolean }>
> {
  if (!isObject(input) || !isUuid(input.menuVersionId))
    return failure("not_found", "This menu could not be found.")
  const venue = await resolveVenue(actor, input.venueId)
  if (!venue.ok) return venue
  const { data, error } = await actor.db.rpc("start_menu_coverage_plan", {
    p_venue_id: venue.venueId,
    p_menu_version_id: input.menuVersionId,
  })
  if (error) return coverageRpcFailure(error, "start menu plan")
  const row = data?.[0]
  if (!row) return unavailableFailure("start menu plan")
  return {
    ok: true,
    planId: row.plan_id,
    revision: row.revision,
    created: row.created,
  }
}

/**
 * Confirms a draft plan once every section is active or excluded. The
 * previous plan is superseded: its tasks without live photos retire, the
 * rest wait for explicit reconciliation.
 */
export async function confirmMenuCoverage(
  actor: MediaActor,
  input: unknown
): Promise<
  CoverageResult<{
    planId: string
    reconciliationRequired: boolean
    autoRetired: number
  }>
> {
  if (!isObject(input) || !isUuid(input.planId))
    return failure("not_found", "This menu plan could not be found.")
  if (!intInRange(input.expectedRevision, 1, MAX_REVISION)) return BAD_REQUEST
  const { data, error } = await actor.db.rpc("confirm_menu_coverage_plan", {
    p_plan_id: input.planId,
    p_expected_revision: input.expectedRevision,
  })
  if (error) return coverageRpcFailure(error, "confirm menu plan")
  const row = data?.[0]
  if (!row) return unavailableFailure("confirm menu plan")
  return {
    ok: true,
    planId: row.plan_id,
    reconciliationRequired: row.reconciliation_required,
    autoRetired: row.auto_retired,
  }
}

/** Discards a draft plan (its tasks retire as history). */
export async function discardMenuCoverage(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult> {
  if (!isObject(input) || !isUuid(input.planId))
    return failure("not_found", "This menu plan could not be found.")
  if (!intInRange(input.expectedRevision, 1, MAX_REVISION)) return BAD_REQUEST
  const { error } = await actor.db.rpc("discard_menu_coverage_plan", {
    p_plan_id: input.planId,
    p_expected_revision: input.expectedRevision,
  })
  if (error) return coverageRpcFailure(error, "discard menu plan")
  return { ok: true }
}

/**
 * Explicitly reconciles one superseded-plan task: carries chosen accepted
 * photos (null: all with available evidence) to a current task of the
 * confirmed plan, or carries nothing, then retires the old task. Carried
 * photos earn no new monthly credit. Never matched by name or section id.
 * Reconciliation completes when the last old task is reconciled.
 */
export async function reconcileMenuRequirement(
  actor: MediaActor,
  input: unknown
): Promise<
  CoverageResult<{ carried: number; reconciliationComplete: boolean }>
> {
  if (!isObject(input) || !isUuid(input.fromRequirementId)) return NOT_FOUND
  const toRequirementId = optionalUuid(input.toRequirementId)
  if (toRequirementId === undefined) return NOT_FOUND
  const submissionIds =
    input.submissionIds == null
      ? null
      : uuidList(input.submissionIds, 0, LIMITS.reconcileItemsMax)
  if (input.submissionIds != null && !submissionIds)
    return invalid({ submissionIds: "Choose up to 200 different photos." })
  if (!toRequirementId && submissionIds?.length)
    return invalid({
      toRequirementId: "Choose the new menu section to carry photos to.",
    })
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (!reason)
    return invalid({ reason: "Enter a reason of up to 500 characters." })
  const { data, error } = await actor.db.rpc("reconcile_menu_requirement", {
    p_old_requirement_id: input.fromRequirementId,
    // SQL NULL: carry nothing / carry all; the generated types mark these non-null.
    p_target_requirement_id: toRequirementId ?? (null as unknown as string),
    p_item_ids: submissionIds ?? (null as unknown as string[]),
    p_reason: reason,
  })
  if (error) return coverageRpcFailure(error, "reconcile menu section")
  const row = data?.[0]
  if (!row) return unavailableFailure("reconcile menu section")
  return {
    ok: true,
    carried: row.carried,
    reconciliationComplete: row.reconciliation_complete,
  }
}
