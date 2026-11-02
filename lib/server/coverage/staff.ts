import "server-only"

import { decodeCursor, encodeCursor } from "@/lib/server/media/library"
import type { MediaActor } from "@/lib/server/media/types"

import { readAccess, scopeOf, staffOnly, type Access } from "./context"
import {
  coverageRpcFailure,
  failure,
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
  AssetIneligibleReason,
  CoverageFailure,
  CoverageResult,
  MyAssignment,
  MyMonthView,
  MyTasksView,
  Page,
  RequirementView,
  SkippedPhoto,
  SubmittablePhoto,
  SubmittedPhoto,
  SubmissionState,
} from "./types"
import {
  isObject,
  isRequestKey,
  isUuid,
  LIMITS,
  optionalUuid,
  uuidList,
} from "./validate"
import {
  candidateView,
  monthlyView,
  nameMap,
  replacedIds,
  requirementView,
  submissionView,
  venuePeople,
  type ItemRow,
} from "./views"

const BAD_REQUEST = invalid({}, "This request is invalid. Reload the page.")
const NO_VENUE = failure(
  "needs_setup",
  "You need to be assigned to an active venue first. Ask an admin to check your venue."
)

async function staffAccess(
  actor: MediaActor
): Promise<CoverageResult<{ access: Access }>> {
  const read = await readAccess(actor)
  if (!read.ok) return read
  return staffOnly(read.access) ?? read
}

async function openAssignmentIds(
  actor: MediaActor
): Promise<CoverageResult<{ ids: Set<string> }>> {
  const { data, error } = await actor.db
    .from("coverage_requirement_assignees")
    .select("requirement_id")
    .eq("staff_id", actor.profile.id)
    .is("ended_at", null)
  if (error) return unavailableFailure("read assignments", error)
  return { ok: true, ids: new Set((data ?? []).map((r) => r.requirement_id)) }
}

function sortAssignments(a: MyAssignment, b: MyAssignment) {
  const ra = a.requirement
  const rb = b.requirement
  const overdue = Number(!!rb.due?.overdue) - Number(!!ra.due?.overdue)
  if (overdue) return overdue
  const da = ra.due?.dueOn ?? "9999-12-31"
  const db = rb.due?.dueOn ?? "9999-12-31"
  if (da !== db) return da < db ? -1 : 1
  return ra.title.localeCompare(rb.title)
}

function assignmentOf(
  requirement: RequirementView,
  assigned: boolean,
  canSubmit: boolean,
  items: ItemRow[],
  names: Map<string, string>
): MyAssignment {
  const mine = items.filter((i) => i.requirement_id === requirement.id)
  return {
    requirement,
    assigned,
    canSubmit: canSubmit && assigned && requirement.isCurrent,
    mySubmissions: mine.map((i) => submissionView(i, names)),
    myAccepted: mine.filter((i) => i.state === "accepted" && !i.archived)
      .length,
    myPending: mine.filter((i) => i.state === "submitted").length,
  }
}

/** The staff landing: monthly progress, assigned tasks and open "needs another photo" requests. */
export async function getMyTasks(
  actor: MediaActor
): Promise<CoverageResult<{ tasks: MyTasksView }>> {
  const read = await staffAccess(actor)
  if (!read.ok) return read
  const { access } = read
  const scope = scopeOf(actor, access)
  const venueId = access.venueId
  const now = new Date()

  const [progress, assigned, requirements, items, people] = await Promise.all([
    actor.db.rpc("coverage_staff_progress", {}),
    openAssignmentIds(actor),
    venueId
      ? actor.db.rpc("coverage_requirement_progress", { p_venue_id: venueId })
      : Promise.resolve({ data: [], error: null }),
    actor.db.rpc("coverage_items_page", {
      p_author_id: actor.profile.id,
      ...(venueId ? { p_venue_id: venueId } : {}),
      p_newest_first: true,
      p_limit: 101,
    }),
    venueId
      ? venuePeople(actor, venueId, access.managerVenueId === venueId)
      : Promise.resolve(new Map()),
  ])
  if (progress.error) return coverageRpcFailure(progress.error, "my progress")
  if (!assigned.ok) return assigned
  if (requirements.error)
    return coverageRpcFailure(requirements.error, "my requirements")
  if (items.error) return coverageRpcFailure(items.error, "my photos")

  const rows = items.data ?? []
  const names = await nameMap(
    actor,
    people,
    rows.map((r) => r.decided_by)
  )
  const progressRows = progress.data ?? []
  const current = progressRows.find((r) => r.venue_id === venueId) ?? null
  const periodKey = current
    ? periodOfDate(current.period_month)
    : periodKeyOf(now)
  const replaced = replacedIds(rows)

  const assignments = (requirements.data ?? [])
    .filter((r) => assigned.ids.has(r.requirement_id) && r.status !== "retired")
    .map((r) =>
      assignmentOf(
        requirementView(r, people),
        true,
        scope.canSubmit,
        rows,
        names
      )
    )
    .sort(sortAssignments)

  return {
    ok: true,
    tasks: {
      scope,
      period: periodView(periodKey, now),
      monthly: current ? monthlyView(current, now) : null,
      assignments,
      needsAnotherPhoto: rows
        .filter(
          (r) =>
            r.state === "needs_another_photo" &&
            !r.archived &&
            !replaced.has(r.item_id)
        )
        .map((r) => submissionView(r, names)),
      pendingReview: rows.filter((r) => r.state === "submitted").length,
    },
  }
}

/** One task at the caller's current venue, with their own photos on it. */
export async function getMyAssignment(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ assignment: MyAssignment }>> {
  if (!isObject(input) || !isUuid(input.requirementId)) return NOT_FOUND
  const requirementId = input.requirementId
  const read = await staffAccess(actor)
  if (!read.ok) return read
  const { access } = read
  if (!access.venueId) return NOT_FOUND
  const venueId = access.venueId

  const [requirements, assigned, items, people] = await Promise.all([
    actor.db.rpc("coverage_requirement_progress", {
      p_venue_id: venueId,
      p_include_closed: true,
    }),
    openAssignmentIds(actor),
    actor.db.rpc("coverage_items_page", {
      p_author_id: actor.profile.id,
      p_requirement_id: requirementId,
      p_newest_first: true,
      p_limit: 101,
    }),
    venuePeople(actor, venueId, access.managerVenueId === venueId),
  ])
  if (requirements.error)
    return coverageRpcFailure(requirements.error, "my requirement")
  if (!assigned.ok) return assigned
  if (items.error) return coverageRpcFailure(items.error, "my photos")
  const row = (requirements.data ?? []).find(
    (r) => r.requirement_id === requirementId
  )
  if (!row) return NOT_FOUND
  const rows = items.data ?? []
  const names = await nameMap(
    actor,
    people,
    rows.map((r) => r.decided_by)
  )
  return {
    ok: true,
    assignment: assignmentOf(
      requirementView(row, people),
      assigned.ids.has(requirementId),
      scopeOf(actor, access).canSubmit,
      rows,
      names
    ),
  }
}

/** A past or current month: progress per venue (a transfer can give two) and own photos. */
export async function getMyMonth(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ month: MyMonthView }>> {
  if (!isObject(input) || !isPeriodKey(input.period))
    return invalid({ period: "Choose a month." })
  const period = input.period
  const read = await staffAccess(actor)
  if (!read.ok) return read
  const { access } = read
  const month = periodMonthDate(period)
  const [progress, items, people] = await Promise.all([
    actor.db.rpc("coverage_staff_progress", { p_period_month: month }),
    actor.db.rpc("coverage_items_page", {
      p_author_id: actor.profile.id,
      p_period_month: month,
      p_newest_first: true,
      p_limit: 101,
    }),
    access.venueId
      ? venuePeople(
          actor,
          access.venueId,
          access.managerVenueId === access.venueId
        )
      : Promise.resolve(new Map()),
  ])
  if (progress.error) return coverageRpcFailure(progress.error, "my month")
  if (items.error) return coverageRpcFailure(items.error, "my month photos")
  const rows = (items.data ?? []).slice(0, 100)
  const names = await nameMap(
    actor,
    people,
    rows.map((r) => r.decided_by)
  )
  const now = new Date()
  return {
    ok: true,
    month: {
      period: periodView(period, now),
      monthly: (progress.data ?? []).map((r) => monthlyView(r, now)),
      submissions: rows.map((r) => submissionView(r, names)),
    },
  }
}

type LiveItem = {
  state: "submitted" | "accepted"
  requirementId: string | null
  /** Null when the caller cannot tell (candidate listing). */
  origin: string | null
}

/** Why the author cannot submit this photo to `target` (null: they can). */
function ownPhotoBlock(
  target: string | null,
  live: LiveItem | null,
  declined: boolean,
  uploadedThisMonth: boolean
): AssetIneligibleReason | null {
  if (live) {
    if (live.requirementId === target) return "already_submitted"
    // Only the author's own pending photo may move to another task, and it
    // never silently leaves a task for a monthly-only submission.
    if (
      target === null ||
      live.state !== "submitted" ||
      (live.origin !== null && live.origin !== "submitted")
    )
      return "counted_elsewhere"
    return null
  }
  if (declined) return "declined_here"
  if (target === null && !uploadedThisMonth) return "outside_period"
  return null
}

async function declinedAssets(
  actor: MediaActor,
  requirementId: string | null,
  assetIds?: string[]
): Promise<CoverageResult<{ ids: Set<string> }>> {
  if (!requirementId) return { ok: true, ids: new Set() }
  let query = actor.db
    .from("coverage_submission_items")
    .select("asset_id")
    .eq("author_id", actor.profile.id)
    .eq("requirement_id", requirementId)
    .eq("state", "needs_another_photo")
  if (assetIds) query = query.in("asset_id", assetIds)
  const { data, error } = await query
  if (error) return unavailableFailure("read declined photos", error)
  return { ok: true, ids: new Set((data ?? []).map((r) => r.asset_id)) }
}

async function requirementAtVenue(
  actor: MediaActor,
  requirementId: string,
  venueId: string
): Promise<CoverageFailure | null> {
  const { data, error } = await actor.db
    .from("coverage_requirements")
    .select("id, venue_id")
    .eq("id", requirementId)
    .maybeSingle()
  if (error) return unavailableFailure("read requirement", error)
  if (!data || data.venue_id !== venueId)
    return failure("not_found", "This task could not be found.")
  return null
}

/** Own ready photos at the current venue, newest first, with eligibility for `requirementId`. */
export async function listMySubmittablePhotos(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<Page<SubmittablePhoto>>> {
  if (!isObject(input)) return BAD_REQUEST
  const requirementId = optionalUuid(input.requirementId)
  if (requirementId === undefined) return NOT_FOUND
  const cursor = typeof input.cursor === "string" ? input.cursor : null
  const after = decodeCursor(cursor)
  if (cursor && !after) return invalid({ cursor: "Invalid page cursor." })
  const read = await staffAccess(actor)
  if (!read.ok) return read
  const { access } = read
  if (!access.venueId || !access.venueActive) return NO_VENUE
  if (requirementId) {
    const missing = await requirementAtVenue(
      actor,
      requirementId,
      access.venueId
    )
    if (missing) return missing
  }

  const [candidates, declined] = await Promise.all([
    actor.db.rpc("coverage_candidate_assets", {
      ...(after
        ? { p_after_created_at: after.createdAt, p_after_id: after.id }
        : {}),
      p_limit: LIMITS.pageSize + 1,
    }),
    declinedAssets(actor, requirementId),
  ])
  if (candidates.error)
    return coverageRpcFailure(candidates.error, "submittable photos")
  if (!declined.ok) return declined
  const rows = candidates.data ?? []
  const page = rows.slice(0, LIMITS.pageSize)
  const last = rows.length > LIMITS.pageSize ? page[page.length - 1] : null
  return {
    ok: true,
    items: page.map((row) =>
      candidateView(
        row,
        ownPhotoBlock(
          requirementId,
          row.live_item_id && row.live_item_state
            ? {
                state: row.live_item_state as LiveItem["state"],
                requirementId: row.live_requirement_id,
                origin: null,
              }
            : null,
          declined.ids.has(row.asset_id),
          row.monthly_eligible_now
        ),
        row.monthly_eligible_now
      )
    ),
    nextCursor: last ? encodeCursor(last.created_at, last.asset_id) : null,
  }
}

/** Splits the requested own photos into those to send and those to skip, with reasons. */
async function precheckOwnPhotos(
  actor: MediaActor,
  venueId: string,
  assetIds: string[],
  requirementId: string | null
): Promise<CoverageResult<{ send: string[]; skipped: SkippedPhoto[] }>> {
  const [assets, live, declined] = await Promise.all([
    actor.db
      .from("media_assets")
      .select(
        "id, uploader_id, venue_id, upload_state, deleted_at, media_type, created_at"
      )
      .in("id", assetIds),
    actor.db
      .from("coverage_submission_items")
      .select("asset_id, state, requirement_id, origin")
      .in("asset_id", assetIds)
      .in("state", ["submitted", "accepted"])
      .is("archived_at", null),
    declinedAssets(actor, requirementId, assetIds),
  ])
  if (assets.error) return unavailableFailure("read photos", assets.error)
  if (live.error) return unavailableFailure("read live photos", live.error)
  if (!declined.ok) return declined
  const byId = new Map((assets.data ?? []).map((a) => [a.id, a]))
  const liveById = new Map((live.data ?? []).map((l) => [l.asset_id, l]))
  const thisMonth = periodKeyOf(new Date())
  const send: string[] = []
  const skipped: SkippedPhoto[] = []
  for (const id of assetIds) {
    const asset = byId.get(id)
    let reason: AssetIneligibleReason | null
    if (!asset || asset.uploader_id !== actor.profile.id || asset.deleted_at)
      reason = "not_found"
    else if (asset.upload_state !== "ready") reason = "not_ready"
    else if (asset.media_type !== "image") reason = "not_image"
    else if (asset.venue_id !== venueId) reason = "wrong_venue"
    else {
      const l = liveById.get(id)
      reason = ownPhotoBlock(
        requirementId,
        l
          ? {
              state: l.state as LiveItem["state"],
              requirementId: l.requirement_id,
              origin: l.origin,
            }
          : null,
        declined.ids.has(id),
        periodKeyOf(new Date(asset.created_at)) === thisMonth
      )
      // Already live on this task: the database reports it as reused.
      if (reason === "already_submitted") reason = null
    }
    if (reason) skipped.push({ assetId: id, reason })
    else send.push(id)
  }
  return { ok: true, send, skipped }
}

/**
 * Staff submit 1..10 of their own ready photos for their monthly target and,
 * optionally, one task they are assigned to. Ineligible photos are skipped
 * with reasons; the request fails only when none can be submitted. Retrying
 * with the same `requestId` returns the first outcome.
 */
export async function submitPhotos(
  actor: MediaActor,
  input: unknown
): Promise<
  CoverageResult<{
    submitted: SubmittedPhoto[]
    skipped: SkippedPhoto[]
    replayed: boolean
  }>
> {
  if (!isObject(input)) return BAD_REQUEST
  if (!isRequestKey(input.requestId))
    return invalid({ requestId: "This request is invalid. Reload the page." })
  const requestId = input.requestId
  const requirementId = optionalUuid(input.requirementId)
  if (requirementId === undefined) return NOT_FOUND
  const assetIds = uuidList(input.assetIds, 1, LIMITS.batchMax)
  if (!assetIds)
    return invalid({ assetIds: "Choose between 1 and 10 different photos." })
  const replaces = optionalUuid(input.replacesSubmissionId)
  if (replaces === undefined) return NOT_FOUND

  const read = await staffAccess(actor)
  if (!read.ok) return read
  const { access } = read

  const prior = await actor.db
    .from("coverage_submissions")
    .select("kind, asset_ids, requirement_id")
    .eq("submitted_by", actor.profile.id)
    .eq("client_request_key", requestId)
    .maybeSingle()
  if (prior.error) return unavailableFailure("read submission", prior.error)

  let send: string[]
  let skipped: SkippedPhoto[] = []
  if (prior.data) {
    if (
      prior.data.kind !== "staff_submit" ||
      prior.data.requirement_id !== requirementId
    )
      return coverageRpcFailure(
        { message: "idempotency_key_reused", code: "22023" },
        "submit photos"
      )
    send = prior.data.asset_ids
    skipped = assetIds
      .filter((id) => !send.includes(id))
      .map((assetId) => ({ assetId, reason: "not_found" as const }))
  } else {
    if (!access.venueId || !access.venueActive) return NO_VENUE
    if (requirementId) {
      const missing = await requirementAtVenue(
        actor,
        requirementId,
        access.venueId
      )
      if (missing) return missing
      const assigned = await openAssignmentIds(actor)
      if (!assigned.ok) return assigned
      if (!assigned.ids.has(requirementId))
        return failure(
          "not_permitted",
          "You can add photos to this task only while it is assigned to you."
        )
    }
    const checked = await precheckOwnPhotos(
      actor,
      access.venueId,
      assetIds,
      requirementId
    )
    if (!checked.ok) return checked
    if (!checked.send.length)
      return failure(
        "asset_ineligible",
        "None of these photos can be submitted here.",
        { assetErrors: checked.skipped }
      )
    send = checked.send
    skipped = checked.skipped
  }

  const { data, error } = await actor.db.rpc("submit_coverage_photos", {
    p_asset_ids: send,
    ...(requirementId ? { p_requirement_id: requirementId } : {}),
    p_client_request_key: requestId,
    ...(replaces ? { p_replaces_item_id: replaces } : {}),
  })
  if (error) return coverageRpcFailure(error, "submit photos", send)
  return {
    ok: true,
    submitted: (data ?? []).map((r) => ({
      submissionId: r.item_id,
      assetId: r.asset_id,
      state: r.state as SubmissionState,
      revision: r.revision,
      reused: r.reused,
    })),
    skipped,
    replayed: (data ?? []).some((r) => r.replayed),
  }
}
