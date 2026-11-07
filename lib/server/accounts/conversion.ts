// Admin conversion between a staff account and a venue manager account
// (venue manager workspace §4.7). Both directions run one admin RPC that locks
// the profile, changes the role, ends the old grant (profile trigger), inserts
// the new grant (to manager) and writes the account_role audit row in a single
// transaction. A retry with the same request id replays the first result.
//
// Results use the coverage failure shape, so the admin UI reuses
// useCoverageAction and its notices. Like the rest of lib/server/accounts this
// module stays free of `server-only`, so integration tests call it directly.

import {
  coverageRpcFailure,
  failure,
  invalid,
  NOT_FOUND,
  unavailableFailure,
  type DbError,
} from "@/lib/server/coverage/errors"
import type { CoverageResult } from "@/lib/server/coverage/types"
import {
  isObject,
  isRequestKey,
  isUuid,
  LIMITS,
  optionalText,
} from "@/lib/server/coverage/validate"

import {
  FORBIDDEN_MESSAGE,
  requireAdminCaller,
  type AccountsContext,
} from "./context"
import type { AccountRole } from "./directory"

export type ConversionInput = {
  requestId: string
  profileId: string
  venueId: string
  reason: string
}

export type ConversionOutcome = {
  profileId: string
  role: AccountRole
  venueId: string
  /** The new grant (conversion to manager only). */
  grantId: string | null
  /** True when this request id had already been applied. */
  replayed: boolean
}

/** One account_role audit row, newest first. */
export type AccountRoleChange = {
  id: number
  at: string
  actorName: string | null
  from: AccountRole | null
  to: AccountRole | null
  /** The venue the account was assigned to by the change. */
  venueId: string | null
  reason: string | null
}

const HISTORY_LIMIT = 10

function parseInput(
  input: unknown
):
  | { ok: true; value: ConversionInput }
  | { ok: false; result: CoverageResult<never> } {
  if (!isObject(input)) return { ok: false, result: invalid({}) }
  if (!isRequestKey(input.requestId))
    return {
      ok: false,
      result: invalid({ requestId: "This request is invalid. Reload." }),
    }
  if (!isUuid(input.profileId)) return { ok: false, result: NOT_FOUND }
  const fieldErrors: Record<string, string> = {}
  if (!isUuid(input.venueId)) fieldErrors.venueId = "Choose a venue."
  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (reason === undefined) fieldErrors.reason = "Use up to 500 characters."
  else if (reason === null) fieldErrors.reason = "Enter a reason."
  if (Object.keys(fieldErrors).length > 0 || !reason || !isUuid(input.venueId))
    return { ok: false, result: invalid(fieldErrors) }
  return {
    ok: true,
    value: {
      requestId: input.requestId,
      profileId: input.profileId,
      venueId: input.venueId,
      reason,
    },
  }
}

async function adminFailure(ctx: AccountsContext) {
  const auth = await requireAdminCaller(ctx.caller)
  if (auth.ok) return null
  return auth.code === "unauthenticated"
    ? failure("unauthenticated", auth.error)
    : failure("not_permitted", FORBIDDEN_MESSAGE)
}

/**
 * account_not_eligible carries the account's current role as its detail: the
 * target role means it was already converted; the source role means it is
 * inactive (an inactive account cannot be converted).
 */
function conversionFailure(
  error: DbError,
  to: AccountRole
): CoverageResult<never> {
  switch (error?.message) {
    case "cannot_convert_self":
      return failure("not_permitted", "You can't change your own account type.")
    case "account_not_found":
      return failure(
        "not_found",
        "This account could not be found. Reload the page."
      )
    case "account_not_eligible":
      return failure(
        "state_conflict",
        error.details === to
          ? to === "manager"
            ? "This account is already a venue manager account. Reload the page."
            : "This account is already a staff account. Reload the page."
          : "Only an active account can change type. Reactivate it first."
      )
    case "venue_inactive":
      return invalid(
        { venueId: "This venue is inactive or no longer exists." },
        "Choose an active venue."
      )
  }
  return coverageRpcFailure(error, "account conversion")
}

async function convert(
  ctx: AccountsContext,
  input: unknown,
  to: AccountRole
): Promise<CoverageResult<ConversionOutcome>> {
  const denied = await adminFailure(ctx)
  if (denied) return denied
  const parsed = parseInput(input)
  if (!parsed.ok) return parsed.result
  const { requestId, profileId, venueId, reason } = parsed.value
  const args = {
    p_profile_id: profileId,
    p_venue_id: venueId,
    p_reason: reason,
    p_client_request_key: requestId,
  }

  if (to === "manager") {
    const { data, error } = await ctx.caller.rpc(
      "convert_account_to_manager",
      args
    )
    if (error) return conversionFailure(error, to)
    const row = data?.[0]
    if (!row) return unavailableFailure("account conversion (empty result)")
    return {
      ok: true,
      profileId: row.profile_id,
      role: "manager",
      venueId: row.venue_id,
      grantId: row.grant_id,
      replayed: row.replayed,
    }
  }

  const { data, error } = await ctx.caller.rpc("convert_manager_to_staff", args)
  if (error) return conversionFailure(error, to)
  const row = data?.[0]
  if (!row) return unavailableFailure("account conversion (empty result)")
  return {
    ok: true,
    profileId: row.profile_id,
    role: "staff",
    venueId: row.venue_id,
    grantId: null,
    replayed: row.replayed,
  }
}

/**
 * Staff account → venue manager account for `venueId`. The account moves to
 * that venue and gets a grant there; its photos, credit and review history
 * stay. Its open photo tasks end.
 */
export function convertToManager(
  ctx: AccountsContext,
  input: unknown
): Promise<CoverageResult<ConversionOutcome>> {
  return convert(ctx, input, "manager")
}

/** Venue manager account → staff account at `venueId`. Its venue access ends now. */
export function convertToStaff(
  ctx: AccountsContext,
  input: unknown
): Promise<CoverageResult<ConversionOutcome>> {
  return convert(ctx, input, "staff")
}

function roleOf(value: unknown): AccountRole | null {
  return value === "staff" || value === "manager" ? value : null
}

function field(json: unknown, key: string): unknown {
  return isObject(json) ? json[key] : undefined
}

/**
 * The account's last account-type changes, read as the admin through RLS
 * (coverage_audit_events_select_admin). Actor names come from profiles,
 * which admins can read.
 */
export async function listAccountRoleHistory(
  ctx: AccountsContext,
  profileId: unknown
): Promise<CoverageResult<{ changes: AccountRoleChange[] }>> {
  const denied = await adminFailure(ctx)
  if (denied) return denied
  if (!isUuid(profileId)) return NOT_FOUND
  const { data, error } = await ctx.caller
    .from("coverage_audit_events")
    .select("id, created_at, actor_id, before, after, reason")
    .eq("entity", "account_role")
    .eq("entity_id", profileId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_LIMIT)
  if (error) return unavailableFailure("account role history", error)
  const rows = data ?? []

  const actorIds = [
    ...new Set(rows.flatMap((r) => (r.actor_id ? [r.actor_id] : []))),
  ]
  const names = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data: people, error: peopleError } = await ctx.caller
      .from("profiles")
      .select("id, display_name")
      .in("id", actorIds)
    if (peopleError)
      return unavailableFailure("account role history actors", peopleError)
    for (const p of people ?? []) names.set(p.id, p.display_name)
  }

  return {
    ok: true,
    changes: rows.map((r) => {
      const venue = field(r.after, "venueId")
      return {
        id: r.id,
        at: r.created_at,
        actorName: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
        from: roleOf(field(r.before, "role")),
        to: roleOf(field(r.after, "role")),
        venueId: isUuid(venue) ? venue : null,
        reason: r.reason,
      }
    }),
  }
}
