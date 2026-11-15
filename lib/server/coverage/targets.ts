import "server-only"

import type { ManagerPhotoCtx } from "@/lib/server/menu-photos/context"

import {
  coverageRpcFailure,
  invalid,
  NOT_FOUND,
  unavailableFailure,
} from "./errors"
import { periodKeyOf, periodMonthDate, periodView } from "./time"
import type { CoverageResult, MonthlyProgress, PeriodView } from "./types"
import { intInRange, isObject, isUuid, LIMITS, optionalText } from "./validate"
import { monthlyView } from "./views"

// G-6 (docs/plans/goals-not-tasks.md, decisions 16 and 17): the venue default
// monthly photo target and each person's own number, for the /manager team
// screen. The current London month only; a past month stays an admin
// correction on /admin. The manager scope comes from the workspace
// (ManagerPhotoCtx) and the database checks it again in every call.

// The RPCs of 20261116140000_venue_default_photo_target.sql, typed here: the
// generator marks p_target_count and target_count non-null, but null clears
// the default and an unset default reads as null.
type DefaultRow = {
  revision: number
  target_count: number | null
  starts_on: string
}
type RpcClient = {
  rpc(
    fn: "venue_default_target" | "set_venue_default_target",
    args: Record<string, unknown>
  ): PromiseLike<{
    data: DefaultRow[] | null
    error: { code: string; message: string; details?: string } | null
  }>
}
const untyped = (ctx: ManagerPhotoCtx) => ctx.actor.db as unknown as RpcClient

const BAD_REQUEST = invalid({}, "This request is invalid. Reload the page.")
const MAX_REVISION = 2 ** 31 - 1
const revisionOrNull = (v: unknown): v is number | null =>
  v === null || intInRange(v, 1, MAX_REVISION)

export type VenueDefaultTarget = {
  /** Accepted photos per person per month; null when not set (or cleared). */
  targetCount: number | null
  /** Pass as `expectedRevision`; null before the first default. */
  revision: number | null
}

export type VenueTargetsView = {
  period: PeriodView
  venueDefault: VenueDefaultTarget
  /**
   * The venue's completion target (dishes and checks) applies this month:
   * photo targets are not used, so nothing here can be changed.
   */
  wholeVenue: boolean
  /** Current members of the venue, in the read's order. */
  people: MonthlyProgress[]
}

export async function getVenueTargets(
  ctx: ManagerPhotoCtx
): Promise<CoverageResult<{ view: VenueTargetsView }>> {
  const now = new Date()
  const period = periodKeyOf(now)
  const [progress, venueDefault] = await Promise.all([
    ctx.actor.db.rpc("coverage_staff_progress_v2", {
      p_venue_id: ctx.venueId,
      p_period_month: periodMonthDate(period),
    }),
    untyped(ctx).rpc("venue_default_target", { p_venue_id: ctx.venueId }),
  ])
  if (progress.error) return coverageRpcFailure(progress.error, "venue targets")
  if (venueDefault.error)
    return coverageRpcFailure(venueDefault.error, "venue default target")
  const rows = (progress.data ?? []).filter((row) => row.is_current_member)
  const current = venueDefault.data?.[0] ?? null
  return {
    ok: true,
    view: {
      period: periodView(period, now),
      venueDefault: {
        targetCount: current?.target_count ?? null,
        revision: current?.revision ?? null,
      },
      wholeVenue: rows.some(
        (row) => row.target_basis === "menu_items_and_amenities"
      ),
      people: rows.map((row) => monthlyView(row, now)),
    },
  }
}

/**
 * Sets the venue default from this month, or clears it (`targetCount: null`).
 * Changing or clearing a set default needs a reason. People on the default
 * follow it at once; people with their own number keep it.
 */
export async function setVenueDefaultTarget(
  ctx: ManagerPhotoCtx,
  input: unknown
): Promise<CoverageResult<VenueDefaultTarget>> {
  if (!isObject(input) || !revisionOrNull(input.expectedRevision))
    return BAD_REQUEST
  const errors: Record<string, string> = {}
  const count = input.targetCount
  if (count !== null && !intInRange(count, 1, LIMITS.targetCountMax))
    errors.targetCount = "Enter a whole number from 1 to 500."
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (reason === undefined) errors.reason = "Use up to 500 characters."
  if (Object.keys(errors).length) return invalid(errors)
  const { data, error } = await untyped(ctx).rpc("set_venue_default_target", {
    p_venue_id: ctx.venueId,
    p_target_count: count,
    ...(reason ? { p_reason: reason } : {}),
    ...(input.expectedRevision !== null
      ? { p_expected_revision: input.expectedRevision }
      : {}),
  })
  if (error) return coverageRpcFailure(error, "set venue default target")
  const row = data?.[0]
  if (!row) return unavailableFailure("set venue default target")
  return { ok: true, targetCount: row.target_count, revision: row.revision }
}

/**
 * One person's own number for this month at the venue. Changing a target
 * the person already has (their own or the default) needs a reason.
 */
export async function setPersonTarget(
  ctx: ManagerPhotoCtx,
  input: unknown
): Promise<CoverageResult<{ revision: number }>> {
  if (!isObject(input) || !isUuid(input.staffId)) return NOT_FOUND
  if (!revisionOrNull(input.expectedRevision)) return BAD_REQUEST
  const errors: Record<string, string> = {}
  if (!intInRange(input.targetCount, 1, LIMITS.targetCountMax))
    errors.targetCount = "Enter a whole number from 1 to 500."
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (reason === undefined) errors.reason = "Use up to 500 characters."
  if (Object.keys(errors).length) return invalid(errors)
  const { data, error } = await ctx.actor.db.rpc("set_monthly_target", {
    p_staff_id: input.staffId,
    p_venue_id: ctx.venueId,
    p_period_month: periodMonthDate(periodKeyOf(new Date())),
    p_target_count: input.targetCount as number,
    ...(reason ? { p_reason: reason } : {}),
    ...(input.expectedRevision !== null
      ? { p_expected_revision: input.expectedRevision as number }
      : {}),
  })
  if (error) return coverageRpcFailure(error, "set person target")
  const row = data?.[0]
  if (!row) return unavailableFailure("set person target")
  return { ok: true, revision: row.revision }
}

/**
 * Review c (5): move one person back to the venue default for this month.
 * Their own number stops carrying forward. A reason is required.
 */
export async function applyVenueDefaultForPerson(
  ctx: ManagerPhotoCtx,
  input: unknown
): Promise<CoverageResult<{ revision: number }>> {
  if (!isObject(input) || !isUuid(input.staffId)) return NOT_FOUND
  if (!intInRange(input.expectedRevision, 1, MAX_REVISION)) return BAD_REQUEST
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (reason === undefined)
    return invalid({ reason: "Use up to 500 characters." })
  if (!reason) return invalid({ reason: "Say why the target changes." })
  const { data, error } = await ctx.actor.db.rpc("use_venue_default_target", {
    p_venue_id: ctx.venueId,
    p_staff_id: input.staffId,
    p_reason: reason,
    p_expected_revision: input.expectedRevision as number,
  })
  if (error) return coverageRpcFailure(error, "use venue default target")
  const row = data?.[0]
  if (!row) return unavailableFailure("use venue default target")
  return { ok: true, revision: row.revision }
}
