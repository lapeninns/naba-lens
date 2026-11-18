import "server-only"

import type { AmenityResult, SubmitResult } from "@/lib/amenities/contract"
import type { MediaActor } from "@/lib/server/media/types"

import { amenityAccess, amenityVenue } from "./context"
import { amenityRpcFailure, failure, invalid } from "./errors"
import { amenityKeyedRpc, amenityRpc } from "./rpc"
import {
  isObject,
  isUuid,
  parseAssign,
  parseKeys,
  parseNotes,
  parseReopen,
  parseRevisionInput,
  parseSubmit,
  parseVenueId,
} from "./validate"

// Every mutation takes the revision the caller saw. The database rejects a
// stale one (`amenity_conflict` -> revision_conflict with the current
// revision), bumps it by one and records one history event.
//
// The six check writes also take an optional `idempotencyKey` (B02 R10). With
// one, a retry after a lost reply returns the first result with
// `replayed: true` instead of meeting its own change as a stale revision.

/** Undefined: no key sent (the old signature). */
function requestKey(input: unknown): string | null | undefined {
  if (!isObject(input) || input.idempotencyKey === undefined) return undefined
  return isUuid(input.idempotencyKey) ? input.idempotencyKey : null
}

const KEY_INVALID = invalid({
  idempotencyKey: "Reload the page and try again.",
})

/** `replayed` only when the request carried a key. */
type KeyedRevision = { revision: number; replayed?: boolean }

/** Admin only: creates the venue's missing core checks. Safe to repeat. */
export async function enableAmenities(
  actor: MediaActor,
  input: unknown
): Promise<AmenityResult<{ created: number }>> {
  if (!isObject(input) || !isUuid(input.venueId))
    return invalid({ venueId: "Choose a venue." })
  const read = await amenityAccess(actor)
  if (!read.ok) return read
  if (!read.access.isAdmin)
    return failure("not_permitted", "Only an active admin can do this.")
  const { data, error } = await amenityRpc(actor, "amenity_enable_venue", {
    p_venue_id: input.venueId,
  })
  if (error) return amenityRpcFailure(error, "enable amenities")
  return { ok: true, created: data }
}

/** Adds catalogue entries; an existing key returns its check (restored if archived). */
export async function addChecks(
  actor: MediaActor,
  input: unknown
): Promise<AmenityResult<{ checkIds: string[]; replayed?: boolean }>> {
  const venueId = parseVenueId(input)
  if (!venueId.ok) return venueId
  const keys = parseKeys(input)
  if (!keys.ok) return keys
  const key = requestKey(input)
  if (key === null) return KEY_INVALID
  const venue = await amenityVenue(actor, venueId.value)
  if (!venue.ok) return venue
  if (key) {
    const { data, error } = await amenityKeyedRpc(actor, "amenity_add_checks", {
      p_venue_id: venue.venueId,
      p_keys: keys.value,
      p_idempotency_key: key,
    })
    if (error) return amenityRpcFailure(error, "add checks")
    return { ok: true, checkIds: data.checkIds, replayed: data.replayed }
  }
  const { data, error } = await amenityRpc(actor, "amenity_add_checks", {
    p_venue_id: venue.venueId,
    p_keys: keys.value,
  })
  if (error) return amenityRpcFailure(error, "add checks")
  return { ok: true, checkIds: data }
}

/**
 * Archive (not here) or restore a check, always with a reason (S2-MGR; spec
 * §4.4, AC29). Both go through amenity_check_set_applicability, which records
 * the reason in amenity_scope_events and wraps the keyed archive and restore;
 * the reasonless commands are no longer granted to signed-in users. A request
 * without a key gets one here, so a retry of the same call is still safe.
 */
async function setApplicability(
  actor: MediaActor,
  input: unknown,
  applicable: boolean
): Promise<AmenityResult<KeyedRevision>> {
  const parsed = parseRevisionInput(input)
  if (!parsed.ok) return parsed
  const key = requestKey(input)
  if (key === null) return KEY_INVALID
  const raw = isObject(input) ? input.reason : undefined
  const reason = typeof raw === "string" ? raw.trim() : ""
  if (!reason) return invalid({ reason: "Enter a reason." })
  if (reason.length > 500)
    return invalid({ reason: "Use up to 500 characters." })
  const { data, error } = await actor.db.rpc(
    "amenity_check_set_applicability",
    {
      p_check_id: parsed.value.checkId,
      p_applicable: applicable,
      p_reason: reason,
      p_revision: parsed.value.revision,
      p_idempotency_key: key ?? crypto.randomUUID(),
    }
  )
  if (error)
    return amenityRpcFailure(
      error,
      applicable ? "restore check" : "archive check"
    )
  const result = data as { revision?: unknown; replayed?: unknown } | null
  if (typeof result?.revision !== "number")
    return amenityRpcFailure(null, "archive check shape")
  return {
    ok: true,
    revision: result.revision,
    ...(key ? { replayed: result.replayed === true } : {}),
  }
}

/** Not here at this venue, with a reason (`{ checkId, revision, reason }`). */
export async function archiveCheck(
  actor: MediaActor,
  input: unknown
): Promise<AmenityResult<KeyedRevision>> {
  return setApplicability(actor, input, false)
}

/** Here again, with a reason (`{ checkId, revision, reason }`). */
export async function restoreCheck(
  actor: MediaActor,
  input: unknown
): Promise<AmenityResult<KeyedRevision>> {
  return setApplicability(actor, input, true)
}

/** `assigneeId: null` unassigns. */
export async function assignCheck(
  actor: MediaActor,
  input: unknown
): Promise<AmenityResult<KeyedRevision>> {
  const parsed = parseAssign(input)
  if (!parsed.ok) return parsed
  const key = requestKey(input)
  if (key === null) return KEY_INVALID
  if (key) {
    const { data, error } = await amenityKeyedRpc(
      actor,
      "amenity_assign_check",
      {
        p_check_id: parsed.value.checkId,
        p_assignee_id: parsed.value.assigneeId,
        p_revision: parsed.value.revision,
        p_idempotency_key: key,
      }
    )
    if (error) return amenityRpcFailure(error, "assign check")
    return { ok: true, ...data }
  }
  const { data, error } = await amenityRpc(actor, "amenity_assign_check", {
    p_check_id: parsed.value.checkId,
    p_assignee_id: parsed.value.assigneeId,
    p_revision: parsed.value.revision,
  })
  if (error) return amenityRpcFailure(error, "assign check")
  return { ok: true, revision: data }
}

/** Blank notes clear them. */
export async function setCheckNotes(
  actor: MediaActor,
  input: unknown
): Promise<AmenityResult<KeyedRevision>> {
  const parsed = parseNotes(input)
  if (!parsed.ok) return parsed
  const key = requestKey(input)
  if (key === null) return KEY_INVALID
  if (key) {
    const { data, error } = await amenityKeyedRpc(
      actor,
      "amenity_set_check_notes",
      {
        p_check_id: parsed.value.checkId,
        p_notes: parsed.value.notes,
        p_revision: parsed.value.revision,
        p_idempotency_key: key,
      }
    )
    if (error) return amenityRpcFailure(error, "set check notes")
    return { ok: true, ...data }
  }
  const { data, error } = await amenityRpc(actor, "amenity_set_check_notes", {
    p_check_id: parsed.value.checkId,
    p_notes: parsed.value.notes,
    p_revision: parsed.value.revision,
  })
  if (error) return amenityRpcFailure(error, "set check notes")
  return { ok: true, revision: data }
}

export async function reopenCheck(
  actor: MediaActor,
  input: unknown
): Promise<AmenityResult<KeyedRevision>> {
  const parsed = parseReopen(input)
  if (!parsed.ok) return parsed
  const key = requestKey(input)
  if (key === null) return KEY_INVALID
  if (key) {
    const { data, error } = await amenityKeyedRpc(
      actor,
      "amenity_reopen_check",
      {
        p_check_id: parsed.value.checkId,
        p_revision: parsed.value.revision,
        p_preset: parsed.value.preset,
        p_reason: parsed.value.reason,
        p_idempotency_key: key,
      }
    )
    if (error) return amenityRpcFailure(error, "reopen check")
    return { ok: true, ...data }
  }
  const { data, error } = await amenityRpc(actor, "amenity_reopen_check", {
    p_check_id: parsed.value.checkId,
    p_revision: parsed.value.revision,
    p_preset: parsed.value.preset,
    p_reason: parsed.value.reason,
  })
  if (error) return amenityRpcFailure(error, "reopen check")
  return { ok: true, revision: data }
}

/**
 * Records a finding. A valid submission becomes the check's current answer at
 * once (no review step). Retrying with the same idempotency key returns the
 * first result with `replayed: true`, even if the revision has moved on.
 */
export async function submitFinding(
  actor: MediaActor,
  input: unknown
): Promise<AmenityResult<SubmitResult>> {
  const parsed = parseSubmit(input)
  if (!parsed.ok) return parsed
  const s = parsed.value
  const { data, error } = await amenityRpc(actor, "amenity_submit_finding", {
    p_check_id: s.checkId,
    p_revision: s.revision,
    p_idempotency_key: s.idempotencyKey,
    p_answer: s.answer,
    p_finding: s.finding,
    p_limitations: s.limitations,
    p_reason: s.reason,
    p_asset_ids: s.assetIds,
    p_internal_metadata: s.wifi ? { ...s.wifi } : null,
    p_redaction_confirmed: s.redactionConfirmed,
  })
  if (error) return amenityRpcFailure(error, "submit finding")
  const row = data[0]
  if (!row) return amenityRpcFailure(null, "submit finding (no row)")
  return {
    ok: true,
    submissionId: row.submission_id,
    revision: row.revision,
    replayed: row.replayed,
  }
}
