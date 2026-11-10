import "server-only"

import type { MediaActor } from "@/lib/server/media/types"

import { invalid, scoringRpcFailure, unavailableFailure } from "./errors"
import { isPeriodKey, periodMonthDate, periodOfDate } from "./time"
import type { CoverageResult, PeriodKey } from "./types"
import {
  intInRange,
  isObject,
  isRequestKey,
  isUuid,
  LIMITS,
  optionalText,
} from "./validate"

export type ScoringPolicyKey = "combined" | "accepted_photos"

const POLICY_KEYS: readonly ScoringPolicyKey[] = ["combined", "accepted_photos"]
const MAX_VERSION = 2 ** 31 - 1

export type ScoringAssignmentView = {
  venueId: string
  startsOn: PeriodKey
  policyKey: ScoringPolicyKey
  policyVersion: number
  /** The venue target for `combined`; null for the accepted-photo basis. */
  targetCount: number | null
  reason: string
  approvedBy: string
  approvedAt: string
  /** The current-month first enrolment, under a recorded owner approval. */
  firstEnrolment: boolean
}

type AssignmentRow = {
  venue_id: string
  starts_on: string
  policy_key: ScoringPolicyKey
  policy_version: number
  target_count: number | null
  reason: string
  approved_by: string
  approved_at: string
  first_enrolment: boolean
  replayed: boolean
}

// Not yet in lib/db/types.ts: regenerate the types on the isolated stack,
// then call actor.db.rpc directly.
type AssignPolicyRpc = (
  fn: "scoring_assign_policy",
  args: {
    p_venue: string
    p_starts_on: string
    p_policy_key: ScoringPolicyKey
    p_version: number
    p_target_count: number | null
    p_reason: string
    p_request_key: string
  }
) => PromiseLike<{
  data: AssignmentRow[] | null
  error: { message?: string; code?: string; details?: string | null } | null
}>

/**
 * Admin: assigns a registered scoring policy to a venue from a London month.
 * Ordinary assignments start next month or later; the database allows the
 * current month only for a first `combined` v1 enrolment with a recorded
 * owner approval for this `requestId`. Retrying with the same `requestId` and
 * input returns the recorded assignment.
 */
export async function assignScoringPolicy(
  actor: MediaActor,
  input: unknown
): Promise<
  CoverageResult<{ assignment: ScoringAssignmentView; replayed: boolean }>
> {
  if (!isObject(input)) return invalid({}, "This request is invalid.")
  if (!isRequestKey(input.requestId))
    return invalid({ requestId: "This request is invalid. Reload the page." })
  const errors: Record<string, string> = {}
  if (!isUuid(input.venueId)) errors.venueId = "Choose a venue."
  if (!isPeriodKey(input.startsOn)) errors.startsOn = "Choose a month."
  const policyKey = POLICY_KEYS.find((key) => key === input.policyKey)
  if (!policyKey || !intInRange(input.policyVersion, 1, MAX_VERSION))
    errors.policy = "Choose a registered scoring policy."
  const targetCount = input.targetCount ?? null
  if (
    policyKey === "combined" &&
    !intInRange(targetCount, 1, LIMITS.targetCountMax)
  )
    errors.targetCount = "Enter a whole number from 1 to 500."
  if (policyKey === "accepted_photos" && targetCount !== null)
    errors.targetCount = "The photo basis uses each person's own target."
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (!reason) errors.reason = "Enter a reason of up to 500 characters."
  if (Object.keys(errors).length) return invalid(errors)

  const rpc = actor.db.rpc.bind(actor.db) as unknown as AssignPolicyRpc
  const { data, error } = await rpc("scoring_assign_policy", {
    p_venue: input.venueId as string,
    p_starts_on: periodMonthDate(input.startsOn as PeriodKey),
    p_policy_key: policyKey as ScoringPolicyKey,
    p_version: input.policyVersion as number,
    p_target_count: targetCount as number | null,
    p_reason: reason as string,
    p_request_key: input.requestId,
  })
  if (error) return scoringRpcFailure(error, "assign scoring policy")
  const row = data?.[0]
  if (!row) return unavailableFailure("assign scoring policy")
  return {
    ok: true,
    replayed: row.replayed,
    assignment: {
      venueId: row.venue_id,
      startsOn: periodOfDate(row.starts_on),
      policyKey: row.policy_key,
      policyVersion: row.policy_version,
      targetCount: row.target_count,
      reason: row.reason,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      firstEnrolment: row.first_enrolment,
    },
  }
}
