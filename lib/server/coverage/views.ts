import "server-only"

import { isDepartment } from "@/lib/config/departments"
import type { Database } from "@/lib/db/types"
import { avatarUrl, mediaRoutes } from "@/lib/server/media/library"
import type { MediaActor } from "@/lib/server/media/types"

import { unavailableFailure } from "./errors"
import { dueView, periodOfDate, periodView } from "./time"
import type {
  AmenityPresence,
  AssetIneligibleReason,
  CoveragePerson,
  CoverageResult,
  CoverageTemplateKey,
  EvidenceAsset,
  MenuPlanStatus,
  MenuState,
  MonthlyProgress,
  MonthlySetupGap,
  MonthlyTargetSource,
  PreparationRunView,
  RequirementKind,
  RequirementSetupIssue,
  RequirementStatus,
  RequirementView,
  SubmissionOrigin,
  SubmissionState,
  SubmissionView,
  SubmittablePhoto,
  VenueCoverageSummary,
} from "./types"

type Fns = Database["public"]["Functions"]
export type ProgressRow = Fns["coverage_staff_progress"]["Returns"][number]
export type RequirementRow =
  Fns["coverage_requirement_progress"]["Returns"][number]
export type ItemRow = Fns["coverage_items_page"]["Returns"][number]
export type CandidateRow = Fns["coverage_candidate_assets"]["Returns"][number]
export type SummaryRow = Fns["venue_coverage_summary"]["Returns"][number]
export type RunRow =
  Database["public"]["Tables"]["coverage_preparation_runs"]["Row"]
export type ReadableAssetRow =
  Fns["community_readable_assets"]["Returns"][number]

/** Scoped task-evidence routes: authorise per request, then sign for 60 s. */
export const evidenceRoutes = {
  thumbnail: (assetId: string) => `/api/coverage/evidence/${assetId}/thumb`,
  preview: (assetId: string) => `/api/coverage/evidence/${assetId}/preview`,
}

export function evidenceAsset(
  id: string,
  hasThumbnail: boolean,
  hasPreview: boolean,
  width: number | null,
  height: number | null,
  available: boolean
): EvidenceAsset {
  return {
    id,
    thumbnailUrl:
      available && hasThumbnail ? evidenceRoutes.thumbnail(id) : null,
    previewUrl: available && hasPreview ? evidenceRoutes.preview(id) : null,
    width,
    height,
    available,
  }
}

export function personFromProgress(row: ProgressRow): CoveragePerson {
  return {
    id: row.staff_id,
    displayName: row.display_name,
    avatarUrl: avatarUrl(row.staff_id, row.avatar_path),
    department: isDepartment(row.department) ? row.department : null,
    jobTitle: row.job_title,
    active: row.is_current_member,
  }
}

export function monthlyView(
  row: ProgressRow,
  now: Date = new Date()
): MonthlyProgress {
  return {
    targetId: row.target_id,
    period: periodView(periodOfDate(row.period_month), now),
    venue: { id: row.venue_id, name: row.venue_name },
    person: personFromProgress(row),
    isCurrentMember: row.is_current_member,
    isManager: row.is_manager,
    status: row.needs_setup ? "needs_setup" : "set",
    setupMissing: row.setup_missing.filter(
      (gap): gap is MonthlySetupGap => gap === "team" || gap === "target"
    ),
    targetCount: row.target_count,
    source: row.target_source as MonthlyTargetSource | null,
    revision: row.target_revision,
    accepted: row.accepted_count,
    pending: row.pending_count,
    needsAnotherPhoto: row.needs_another_photo_count,
    lateAcceptances: row.late_accepted_count,
    evidenceRemoved: row.evidence_removed_count,
    complete: row.complete,
    due: row.due_on ? dueView(row.due_on, row.overdue) : null,
  }
}

function snapshotField(snapshot: unknown, key: string): unknown {
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>)[key]
    : undefined
}

const asString = (v: unknown) => (typeof v === "string" ? v : null)
const asNumber = (v: unknown) => (typeof v === "number" ? v : null)

export function requirementView(
  row: RequirementRow,
  people: Map<string, CoveragePerson>
): RequirementView {
  const kind = row.kind as RequirementKind
  const status = row.status as RequirementStatus
  const presence = row.amenity_presence as AmenityPresence | null
  const issues: RequirementSetupIssue[] = []
  if (status === "needs_setup") issues.push("unconfirmed")
  if (kind === "amenity" && status !== "retired") {
    if (!presence || presence === "unknown") issues.push("fact_unknown")
    else if (!row.amenity_confirmed) issues.push("fact_unconfirmed")
    else if (presence === "absent" && status === "needs_setup")
      issues.push("fact_absent")
  }
  if (status === "active" && row.assignee_ids.length === 0)
    issues.push("no_assignees")
  if (row.needs_reassignment) issues.push("needs_reassignment")

  const snapshot = row.section_snapshot
  return {
    id: row.requirement_id,
    venueId: row.venue_id,
    kind,
    title: row.title,
    guidance: row.guidance,
    photoTarget: row.photo_target,
    due: row.due_on ? dueView(row.due_on, row.overdue) : null,
    status,
    statusReason: row.status_reason,
    isCurrent: row.is_current,
    setupIssues: issues,
    templateKey: row.amenity_key as CoverageTemplateKey | null,
    menuSection:
      kind === "menu_section" && row.menu_plan_id && row.menu_version_id
        ? {
            menuPlanId: row.menu_plan_id,
            menuPlanStatus: row.menu_plan_status as MenuPlanStatus | null,
            menuVersionId: row.menu_version_id,
            sectionName: asString(snapshotField(snapshot, "name")) ?? row.title,
            sectionSlug: asString(snapshotField(snapshot, "slug")),
            sectionKind: asString(snapshotField(snapshot, "kind")),
            position: asNumber(snapshotField(snapshot, "position")),
            itemCount: asNumber(snapshotField(snapshot, "itemCount")),
          }
        : null,
    amenity:
      kind === "amenity"
        ? { presence, confirmed: row.amenity_confirmed }
        : null,
    assigneeIds: row.assignee_ids,
    assignees: row.assignee_ids.flatMap((id) => {
      const person = people.get(id)
      return person ? [person] : []
    }),
    needsReassignment: row.needs_reassignment,
    progress: {
      target: row.photo_target,
      accepted: row.accepted_count,
      pending: row.pending_count,
      needsAnotherPhoto: row.needs_another_photo_count,
      evidenceRemoved: row.evidence_removed_count,
      satisfied: row.satisfied,
      overdue: row.overdue,
    },
    revision: row.revision,
  }
}

export function submissionView(
  row: ItemRow,
  names: Map<string, string>
): SubmissionView {
  const state = row.state as SubmissionState
  const period = periodOfDate(row.submitted_month)
  const decided =
    (state === "accepted" || state === "needs_another_photo") &&
    row.decided_at &&
    row.decided_by
  return {
    id: row.item_id,
    revision: row.revision,
    state,
    origin: row.origin as SubmissionOrigin,
    venueId: row.venue_id,
    period,
    uploadedPeriod: periodOfDate(row.uploaded_month),
    requirement: row.requirement_id
      ? { id: row.requirement_id, title: row.requirement_title }
      : null,
    asset: evidenceAsset(
      row.asset_id,
      row.has_thumbnail,
      row.has_preview,
      row.width,
      row.height,
      row.evidence_available
    ),
    author: {
      id: row.author_id,
      displayName: row.author_name,
      active: row.author_active,
    },
    submittedById: row.submitted_by,
    submittedAt: row.submitted_at,
    countsTowardMonthly: row.monthly_eligible,
    decision:
      decided && row.decided_at && row.decided_by
        ? {
            decision: state === "accepted" ? "accept" : "needs_another_photo",
            reason: row.decision_reason,
            decidedAt: row.decided_at,
            decidedBy: {
              id: row.decided_by,
              displayName: names.get(row.decided_by) ?? null,
            },
            selfReview: row.self_review === true,
            lateAcceptance:
              state === "accepted" &&
              new Date(row.decided_at).getTime() >=
                new Date(periodView(period).endsAt).getTime(),
          }
        : null,
    archived: row.archived,
    replacesSubmissionId: row.replaces_item_id,
  }
}

/** A ready photo listed for submitting or attaching; URLs are the existing media routes. */
export function candidateView(
  row: CandidateRow,
  reason: AssetIneligibleReason | null,
  countsTowardMonthly: boolean
): SubmittablePhoto {
  return {
    assetId: row.asset_id,
    thumbnailUrl: row.has_thumbnail
      ? mediaRoutes.thumbnail(row.asset_id)
      : null,
    previewUrl: row.has_preview ? mediaRoutes.preview(row.asset_id) : null,
    width: row.width,
    height: row.height,
    uploadedAt: row.created_at,
    uploadedPeriod: periodOfDate(row.uploaded_month),
    uploader: {
      id: row.uploader_id,
      displayName: row.uploader_name,
      active: row.uploader_active,
    },
    countsTowardMonthly,
    live:
      row.live_item_id && row.live_item_state
        ? {
            submissionId: row.live_item_id,
            state: row.live_item_state as "submitted" | "accepted",
            requirementId: row.live_requirement_id,
          }
        : null,
    eligible: reason === null,
    reason,
  }
}

/** Items already answered by a replacement photo. */
export function replacedIds(rows: ItemRow[]): Set<string> {
  return new Set(
    rows.flatMap((r) => (r.replaces_item_id ? [r.replaces_item_id] : []))
  )
}

export function summaryView(row: SummaryRow): VenueCoverageSummary {
  return {
    venue: { id: row.venue_id, name: row.venue_name, active: row.venue_active },
    applicable: row.applicable_count,
    satisfied: row.satisfied_count,
    needsSetup: row.needs_setup_count,
    notApplicable: row.not_applicable_count,
    pendingReview: row.pending_review_count,
    overdue: row.overdue_count,
    needsReassignment: row.needs_reassignment_count,
    amenityUnknown: row.amenity_unknown_count,
    menuState: row.menu_state as MenuState,
    pendingReconciliation: row.pending_reconciliation_count,
    complete: row.complete,
  }
}

export function runView(row: RunRow): PreparationRunView {
  return {
    id: row.id,
    period: periodOfDate(row.period_month),
    venueId: row.scope_venue_id,
    trigger: row.run_trigger as PreparationRunView["trigger"],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as PreparationRunView["status"],
    staffConsidered: row.staff_considered,
    targetsCopied: row.targets_copied,
    placeholdersCreated: row.placeholders_created,
    alreadyPresent: row.already_present,
    candidatesAdded: row.candidates_added,
    errorCode: row.error_code,
  }
}

/**
 * People of a venue as narrow projections. Managers and admins read the
 * coverage roster (current members plus anyone with a target this month);
 * other staff read the community directory (active colleagues only).
 */
export async function venuePeople(
  actor: MediaActor,
  venueId: string,
  canManage: boolean
): Promise<Map<string, CoveragePerson>> {
  const people = new Map<string, CoveragePerson>()
  if (canManage) {
    const { data } = await actor.db.rpc("coverage_staff_progress", {
      p_venue_id: venueId,
    })
    for (const row of data ?? [])
      people.set(row.staff_id, personFromProgress(row))
  } else {
    const { data } = await actor.db.rpc("community_members", {
      p_venue: venueId,
      p_limit: 101,
    })
    for (const row of data ?? []) {
      people.set(row.id, {
        id: row.id,
        displayName: row.display_name,
        avatarUrl: avatarUrl(row.id, row.avatar_path),
        department: isDepartment(row.department) ? row.department : null,
        jobTitle: row.job_title,
        active: true,
      })
    }
  }
  return people
}

/**
 * Display names for decision makers and other record ids. Admins may read any
 * profile name; everyone else sees names of the venue's people and themself.
 */
export async function nameMap(
  actor: MediaActor,
  people: Map<string, CoveragePerson>,
  ids: Iterable<string | null>
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (const [id, person] of people) names.set(id, person.displayName)
  names.set(actor.profile.id, actor.profile.displayName)
  const missing = [...new Set(ids)].filter(
    (id): id is string => !!id && !names.has(id)
  )
  if (missing.length && actor.profile.role === "admin") {
    const { data } = await actor.db
      .from("profiles")
      .select("id, display_name")
      .in("id", missing)
    for (const row of data ?? []) names.set(row.id, row.display_name)
  }
  return names
}

/**
 * Ready, undeleted photos the caller may view: their own, active colleagues'
 * and, for admins, anyone's. Colleagues' media rows are not readable directly.
 */
export async function readableAssets(
  actor: MediaActor,
  ids: string[]
): Promise<CoverageResult<{ byId: Map<string, ReadableAssetRow> }>> {
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100))
  const results = await Promise.all(
    batches.map((batch) =>
      actor.db.rpc("community_readable_assets", { p_asset_ids: batch })
    )
  )
  const byId = new Map<string, ReadableAssetRow>()
  for (const { data, error } of results) {
    if (error) return unavailableFailure("read photos", error)
    for (const row of data ?? []) byId.set(row.id, row)
  }
  return { ok: true, byId }
}

// Cursor timestamps end up inside PostgREST filter strings, so only the ISO
// form the database returns is accepted: Date.parse alone also admits text
// such as `Nov 1 2026 (",id.gt.0)`.
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

/** Opaque keyset cursor over (timestamp, id) with any id type. */
export function encodeKey(at: string, id: string | number): string {
  return Buffer.from(JSON.stringify([at, id])).toString("base64url")
}

export function decodeKey(
  cursor: string | null | undefined
): { at: string; id: string } | null {
  if (!cursor) return null
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (
      Array.isArray(value) &&
      typeof value[0] === "string" &&
      ISO_TIMESTAMP.test(value[0]) &&
      !Number.isNaN(Date.parse(value[0])) &&
      (typeof value[1] === "string" || typeof value[1] === "number") &&
      /^[0-9a-f-]{1,36}$/i.test(String(value[1]))
    )
      return { at: value[0], id: String(value[1]) }
  } catch {}
  return null
}
