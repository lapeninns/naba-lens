// Row -> DTO mapping for the amenity services. Pure functions: no I/O.

import {
  CHECK_PROGRESS,
  evidenceHref,
  LEGACY_COVERAGE_MATCHES,
  type AmenityRpcs,
  type CatalogueOption,
  type CheckEventView,
  type CheckPermissions,
  type CheckProgress,
  type CheckRow,
  type CheckSummary,
  type EventRow,
  type EvidenceItem,
  type SubmissionAssetRow,
  type SubmissionRow,
  type SubmissionView,
  type SubmittableAsset,
  type WifiMetadata,
} from "@/lib/amenities/contract"
import type { Access } from "@/lib/server/coverage/context"

const RECENT_LIMIT = 10

type CatalogueRow =
  AmenityRpcs["amenity_catalogue_for_venue"]["returns"][number]
type SubmittableRow =
  AmenityRpcs["amenity_submittable_assets"]["returns"][number]

const person = (id: string | null, name: string | null) =>
  id ? { id, displayName: name } : null

export function checkSummary(row: CheckRow): CheckSummary {
  return {
    id: row.id,
    venueId: row.venue_id,
    entry: {
      key: row.template_key,
      category: row.category,
      question: row.question,
      captureBrief: row.capture_brief,
      evidenceRule: row.evidence_rule,
      isCore: row.is_core,
      position: row.position,
      version: row.catalogue_version,
    },
    status: row.status,
    progress: row.progress,
    answer: row.answer,
    assignee: person(row.assignee_user_id, row.assignee_name),
    answeredBy: person(row.answered_by, row.answered_by_name),
    answeredAt: row.answered_at,
    recheckReason: row.recheck_reason,
    notes: row.notes,
    revision: row.revision,
    updatedAt: row.updated_at,
  }
}

/** Catalogue order, then key, so lists are stable. */
export function byPosition(a: CheckSummary, b: CheckSummary): number {
  return (
    a.entry.position - b.entry.position ||
    a.entry.key.localeCompare(b.entry.key)
  )
}

const newestFirst = (a: string | null, b: string | null) =>
  (b ?? "").localeCompare(a ?? "")

export function venueLists(rows: CheckRow[]) {
  const checks = rows.map(checkSummary).sort(byPosition)
  const active = checks.filter((c) => c.status === "active")
  const archived = checks.filter((c) => c.status === "archived")
  const counts = Object.fromEntries(
    CHECK_PROGRESS.map((p) => [p, 0])
  ) as Record<CheckProgress, number>
  for (const c of active) counts[c.progress] += 1
  const recentlyCompleted = active
    .filter((c) => c.progress === "complete")
    .sort((a, b) => newestFirst(a.answeredAt, b.answeredAt))
    .slice(0, RECENT_LIMIT)
  return { active, archived, recentlyCompleted, counts }
}

/** Assigned to the caller, active and not complete. */
export function myTasks(rows: CheckRow[], userId: string): CheckSummary[] {
  return rows
    .map(checkSummary)
    .filter(
      (c) =>
        c.status === "active" &&
        c.progress !== "complete" &&
        c.assignee?.id === userId
    )
    .sort(byPosition)
}

export function evidenceItem(row: SubmissionAssetRow): EvidenceItem {
  const photo = row.evidence_kind === "photo"
  const { available } = row
  return {
    assetId: row.asset_id,
    kind: row.evidence_kind,
    available,
    thumbUrl:
      photo && available && row.has_thumbnail
        ? evidenceHref(row.asset_id, "thumb")
        : null,
    previewUrl:
      photo && available && row.has_preview
        ? evidenceHref(row.asset_id, "preview")
        : null,
    streamUrl:
      !photo && available ? evidenceHref(row.asset_id, "stream") : null,
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

/**
 * Wi-Fi notes from a submission's internal metadata, which the database only
 * returns to the submitter, the venue's manager and admins. Accepts camelCase
 * (what this service writes) or snake_case keys; anything incomplete is null.
 */
export function wifiFrom(
  metadata: Record<string, unknown> | null
): WifiMetadata | null {
  if (!metadata) return null
  const pick = (camel: string, snake: string) =>
    metadata[camel] ?? metadata[snake]
  const testSpot = pick("testSpot", "test_spot")
  const testedOn = pick("testedOn", "tested_on")
  const downloadMbps = num(pick("downloadMbps", "download_mbps"))
  const uploadMbps = num(pick("uploadMbps", "upload_mbps"))
  if (
    typeof testSpot !== "string" ||
    typeof testedOn !== "string" ||
    downloadMbps === null ||
    uploadMbps === null
  )
    return null
  return { testSpot, testedOn, downloadMbps, uploadMbps }
}

/** Newest first. */
export function submissionViews(
  rows: SubmissionRow[],
  assets: SubmissionAssetRow[],
  currentId: string | null
): SubmissionView[] {
  const bySubmission = new Map<string, EvidenceItem[]>()
  for (const a of assets) {
    const list = bySubmission.get(a.submission_id) ?? []
    list.push(evidenceItem(a))
    bySubmission.set(a.submission_id, list)
  }
  return [...rows]
    .sort((a, b) => newestFirst(a.created_at, b.created_at))
    .map((row) => ({
      id: row.id,
      answer: row.answer,
      finding: row.finding,
      limitations: row.limitations,
      reason: row.reason,
      submittedBy: { id: row.submitted_by, displayName: row.submitted_by_name },
      submittedAt: row.created_at,
      templateVersion: row.template_version,
      evidenceRule: row.evidence_rule,
      evidence: bySubmission.get(row.id) ?? [],
      wifi: wifiFrom(row.internal_metadata),
      isCurrent: row.id === currentId,
    }))
}

/** Newest first. */
export function eventViews(rows: EventRow[]): CheckEventView[] {
  return [...rows]
    .sort((a, b) => newestFirst(a.created_at, b.created_at))
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      actor: person(row.actor_id, row.actor_name),
      at: row.created_at,
      reason: row.reason,
      detail: row.detail ?? {},
    }))
}

/**
 * What the UI should offer. The database re-checks every action; these flags
 * only decide which controls are shown. Managers (manager accounts, and staff
 * still holding a grant) act on their effective managed venue, admins on any
 * venue; other staff may submit only while assigned.
 */
export function checkPermissions(
  row: CheckRow,
  access: Access
): CheckPermissions {
  const manages =
    access.isAdmin ||
    (access.managerVenueId !== null && access.managerVenueId === row.venue_id)
  const active = row.status === "active"
  const assigned =
    access.isStaff &&
    access.venueId === row.venue_id &&
    row.assignee_user_id === access.userId
  return {
    canAssign: manages && active,
    canArchive: manages && active,
    canRestore: manages && !active,
    canReopen: manages && active && row.progress === "complete",
    canSubmit: active && (manages || assigned),
    canAttachLegacy:
      manages &&
      active &&
      (LEGACY_COVERAGE_MATCHES[row.template_key]?.length ?? 0) > 0,
  }
}

export function catalogueOption(row: CatalogueRow): CatalogueOption {
  return {
    key: row.key,
    category: row.category,
    question: row.question,
    captureBrief: row.capture_brief,
    evidenceRule: row.evidence_rule,
    isCore: row.is_core,
    position: row.position,
    version: row.catalogue_version,
    existing:
      row.check_id && row.check_status
        ? { checkId: row.check_id, status: row.check_status }
        : null,
  }
}

export function submittableAsset(row: SubmittableRow): SubmittableAsset {
  const photo = row.media_type === "image"
  return {
    assetId: row.asset_id,
    kind: photo ? "photo" : "video",
    createdAt: row.created_at,
    source: row.source,
    thumbUrl:
      photo && row.has_thumbnail ? evidenceHref(row.asset_id, "thumb") : null,
  }
}
