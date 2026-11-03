import "server-only"

import { decodeCursor, encodeCursor } from "@/lib/server/media/library"
import type { MediaActor } from "@/lib/server/media/types"

import { resolveVenue } from "./context"
import { coverageRpcFailure, failure, invalid, NOT_FOUND } from "./errors"
import {
  isPeriodKey,
  periodKeyOf,
  periodMonthDate,
  periodOfDate,
  periodView,
} from "./time"
import type {
  AssetIneligibleReason,
  CoverageResult,
  MonthlyProgress,
  Page,
  PeriodView,
  RequirementView,
  StaffMonthView,
  SubmissionState,
  SubmissionView,
  SubmittablePhoto,
  VenueCoverageView,
} from "./types"
import { isObject, isUuid, LIMITS, optionalUuid } from "./validate"
import {
  candidateView,
  monthlyView,
  nameMap,
  requirementView,
  submissionView,
  summaryView,
  venuePeople,
  type CandidateRow,
} from "./views"

const STATES: SubmissionState[] = [
  "submitted",
  "accepted",
  "needs_another_photo",
]

const objectOrEmpty = (input: unknown) =>
  isObject(input) ? input : input == null ? {} : null

/** Venue completion and every requirement (except retired) with progress. */
export async function getVenueCoverage(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ coverage: VenueCoverageView }>> {
  const args = objectOrEmpty(input)
  if (!args) return invalid({})
  const venue = await resolveVenue(actor, args.venueId)
  if (!venue.ok) return venue
  const [summary, requirements, people] = await Promise.all([
    actor.db.rpc("venue_coverage_summary", { p_venue_id: venue.venueId }),
    actor.db.rpc("coverage_requirement_progress", {
      p_venue_id: venue.venueId,
    }),
    venuePeople(actor, venue.venueId, true),
  ])
  if (summary.error) return coverageRpcFailure(summary.error, "venue summary")
  if (requirements.error)
    return coverageRpcFailure(requirements.error, "venue requirements")
  const row = summary.data?.[0]
  if (!row) return failure("not_found", "This venue could not be found.")
  return {
    ok: true,
    coverage: {
      summary: summaryView(row),
      period: periodView(periodKeyOf(new Date())),
      requirements: (requirements.data ?? []).map((r) =>
        requirementView(r, people)
      ),
    },
  }
}

/**
 * Photos waiting for the manager's review at their own venue: the same
 * `pending_review_count` the venue overview shows. Anyone who is not a
 * manager (admins included, as they have no own venue) is refused.
 */
export async function getManagerReviewCount(
  actor: MediaActor
): Promise<CoverageResult<{ count: number }>> {
  const venue = await resolveVenue(actor, undefined)
  if (!venue.ok) return venue
  const summary = await actor.db.rpc("venue_coverage_summary", {
    p_venue_id: venue.venueId,
  })
  if (summary.error) return coverageRpcFailure(summary.error, "venue summary")
  const row = summary.data?.[0]
  if (!row) return failure("not_found", "This venue could not be found.")
  return { ok: true, count: row.pending_review_count }
}

/** One requirement of the venue (retired ones included, as history). */
export async function getVenueRequirement(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ requirement: RequirementView }>> {
  if (!isObject(input) || !isUuid(input.requirementId)) return NOT_FOUND
  const venue = await resolveVenue(actor, input.venueId)
  if (!venue.ok) return venue
  const [requirements, people] = await Promise.all([
    actor.db.rpc("coverage_requirement_progress", {
      p_venue_id: venue.venueId,
      p_include_closed: true,
    }),
    venuePeople(actor, venue.venueId, true),
  ])
  if (requirements.error)
    return coverageRpcFailure(requirements.error, "venue requirement")
  const row = (requirements.data ?? []).find(
    (r) => r.requirement_id === input.requirementId
  )
  if (!row) return failure("not_found", "This task could not be found.")
  return { ok: true, requirement: requirementView(row, people) }
}

/**
 * Monthly targets and progress for active staff at the venue, plus anyone
 * with a target there that month (history after a transfer). No emails.
 */
export async function getVenueRoster(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ period: PeriodView; roster: MonthlyProgress[] }>> {
  const args = objectOrEmpty(input)
  if (!args) return invalid({})
  if (args.period != null && !isPeriodKey(args.period))
    return invalid({ period: "Choose a month." })
  const venue = await resolveVenue(actor, args.venueId)
  if (!venue.ok) return venue
  const period = (args.period as string | null | undefined) ?? null
  const { data, error } = await actor.db.rpc("coverage_staff_progress", {
    p_venue_id: venue.venueId,
    ...(period ? { p_period_month: periodMonthDate(period) } : {}),
  })
  if (error) return coverageRpcFailure(error, "venue roster")
  const now = new Date()
  const rows = data ?? []
  const key = rows[0]
    ? periodOfDate(rows[0].period_month)
    : (period ?? periodKeyOf(now))
  return {
    ok: true,
    period: periodView(key, now),
    roster: rows.map((r) => monthlyView(r, now)),
  }
}

/** One person's month at this venue: target, progress and photos submitted here. */
export async function getStaffMonth(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ month: StaffMonthView }>> {
  if (!isObject(input) || !isUuid(input.staffId)) return NOT_FOUND
  if (!isPeriodKey(input.period)) return invalid({ period: "Choose a month." })
  const venue = await resolveVenue(actor, input.venueId)
  if (!venue.ok) return venue
  const month = periodMonthDate(input.period)
  const [progress, items, people] = await Promise.all([
    actor.db.rpc("coverage_staff_progress", {
      p_venue_id: venue.venueId,
      p_period_month: month,
      p_staff_id: input.staffId,
    }),
    actor.db.rpc("coverage_items_page", {
      p_venue_id: venue.venueId,
      p_author_id: input.staffId,
      p_period_month: month,
      p_newest_first: true,
      p_limit: 101,
    }),
    venuePeople(actor, venue.venueId, true),
  ])
  if (progress.error) return coverageRpcFailure(progress.error, "staff month")
  if (items.error) return coverageRpcFailure(items.error, "staff month photos")
  const row = (progress.data ?? []).find((r) => r.staff_id === input.staffId)
  const rows = (items.data ?? []).slice(0, 100)
  if (!row && !rows.length) return NOT_FOUND
  const names = await nameMap(
    actor,
    people,
    rows.map((r) => r.decided_by)
  )
  const now = new Date()
  return {
    ok: true,
    month: {
      period: periodView(input.period, now),
      monthly: row ? monthlyView(row, now) : null,
      submissions: rows.map((r) => submissionView(r, names)),
    },
  }
}

/** The review queue (submitted, oldest first) or any filtered list of the venue's photos. */
export async function listReviewQueue(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<Page<SubmissionView>>> {
  const args = objectOrEmpty(input)
  if (!args) return invalid({})
  const state = args.state ?? "submitted"
  if (state !== "all" && !STATES.includes(state as SubmissionState))
    return invalid({ state: "Choose a state." })
  const requirementId = optionalUuid(args.requirementId)
  const staffId = optionalUuid(args.staffId)
  if (requirementId === undefined || staffId === undefined) return NOT_FOUND
  if (args.period != null && !isPeriodKey(args.period))
    return invalid({ period: "Choose a month." })
  const cursor = typeof args.cursor === "string" ? args.cursor : null
  const after = decodeCursor(cursor)
  if (cursor && !after) return invalid({ cursor: "Invalid page cursor." })
  const venue = await resolveVenue(actor, args.venueId)
  if (!venue.ok) return venue

  const [items, people] = await Promise.all([
    actor.db.rpc("coverage_items_page", {
      p_venue_id: venue.venueId,
      p_states: state === "all" ? STATES : [state as string],
      ...(requirementId ? { p_requirement_id: requirementId } : {}),
      ...(staffId ? { p_author_id: staffId } : {}),
      ...(args.period
        ? { p_period_month: periodMonthDate(args.period as string) }
        : {}),
      ...(after
        ? { p_after_submitted_at: after.createdAt, p_after_id: after.id }
        : {}),
      p_limit: LIMITS.pageSize + 1,
      p_newest_first: args.newestFirst === true,
    }),
    venuePeople(actor, venue.venueId, true),
  ])
  if (items.error) return coverageRpcFailure(items.error, "review queue")
  const rows = items.data ?? []
  const page = rows.slice(0, LIMITS.pageSize)
  const last = rows.length > LIMITS.pageSize ? page[page.length - 1] : null
  const names = await nameMap(
    actor,
    people,
    page.map((r) => r.decided_by)
  )
  return {
    ok: true,
    items: page.map((r) => submissionView(r, names)),
    nextCursor: last ? encodeCursor(last.submitted_at, last.item_id) : null,
  }
}

function attachBlock(
  target: string | null,
  row: CandidateRow
): AssetIneligibleReason | null {
  if (!row.live_item_id) return null
  if (row.live_requirement_id === target) return "already_submitted"
  // A monthly-only photo can be linked to the task; one on another task cannot.
  return row.live_requirement_id ? "counted_elsewhere" : null
}

/**
 * Ready photos uploaded at the venue, newest first, for attaching to a task.
 * Managers see active colleagues' (and own) photos; admins also see retained
 * photos of people who have left. Attaching never earns monthly credit.
 */
export async function listVenuePhotos(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<Page<SubmittablePhoto>>> {
  const args = objectOrEmpty(input)
  if (!args) return invalid({})
  const requirementId = optionalUuid(args.requirementId)
  const uploaderId = optionalUuid(args.uploaderId)
  if (requirementId === undefined || uploaderId === undefined) return NOT_FOUND
  const cursor = typeof args.cursor === "string" ? args.cursor : null
  const after = decodeCursor(cursor)
  if (cursor && !after) return invalid({ cursor: "Invalid page cursor." })
  const venue = await resolveVenue(actor, args.venueId)
  if (!venue.ok) return venue
  const { data, error } = await actor.db.rpc("coverage_candidate_assets", {
    p_venue_id: venue.venueId,
    ...(uploaderId ? { p_uploader_id: uploaderId } : {}),
    ...(after
      ? { p_after_created_at: after.createdAt, p_after_id: after.id }
      : {}),
    p_limit: LIMITS.pageSize + 1,
  })
  if (error) return coverageRpcFailure(error, "venue photos")
  const rows = data ?? []
  const page = rows.slice(0, LIMITS.pageSize)
  const last = rows.length > LIMITS.pageSize ? page[page.length - 1] : null
  return {
    ok: true,
    items: page.map((row) =>
      candidateView(row, attachBlock(requirementId, row), false)
    ),
    nextCursor: last ? encodeCursor(last.created_at, last.asset_id) : null,
  }
}
