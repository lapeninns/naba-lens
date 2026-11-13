import "server-only"

import { publicUseGrantsEnabled } from "@/lib/config/media-use"
import { isObject, isUuid, optionalText } from "@/lib/server/coverage/validate"
import type { MediaActor } from "@/lib/server/media/types"

import { mediaUseFailure, mediaUseInvalid, mediaUseRpcFailure } from "./errors"
import { mediaUseRpc } from "./rpc"
import {
  REQUEST_KEY_PATTERN,
  SUBJECT_KIND_FOR_PURPOSE,
  USE_LIMITS,
  USE_PURPOSES,
  USE_WITHDRAW_REASONS,
  type AssetUseStatus,
  type AssetUseWithdrawn,
  type UseGrantCreated,
  type UseGrantWithdrawn,
  type UsePurpose,
  type UseResult,
  type UseWithdrawReason,
} from "./types"

const DESTINATION_KEY = /^[a-z0-9_]{3,64}$/
const PROFILE_KEY = /^[a-z0-9_]{1,64}$/
const CLEARANCE_VERSION = /^[a-z0-9_.-]{1,40}$/
const CLEARANCE_KEY = /^[a-z0-9_]{1,80}$/

const NOT_FOUND = mediaUseFailure("not_found", "This file could not be found.")

/** An ISO timestamp with a zone, or null when absent. Undefined: invalid. */
function optionalInstant(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === "") return null
  if (typeof v !== "string" || !/(Z|[+-]\d{2}:?\d{2})$/.test(v))
    return undefined
  return Number.isNaN(Date.parse(v)) ? undefined : v
}

function clearanceMap(v: unknown): Record<string, boolean> | null {
  if (!isObject(v)) return null
  const entries = Object.entries(v)
  if (entries.length === 0 || entries.length > 20) return null
  for (const [key, value] of entries)
    if (!CLEARANCE_KEY.test(key) || typeof value !== "boolean") return null
  return v as Record<string, boolean>
}

/**
 * Grants one purpose-specific use of an asset (B05-02d). The database checks
 * who may grant (an active admin by default, never on their own upload), the
 * asset, destination, subject, period and the clearance checklist; a retry
 * with the same request key returns the same grant.
 */
export async function createUseGrant(
  actor: MediaActor,
  input: unknown
): Promise<UseResult<UseGrantCreated>> {
  if (!publicUseGrantsEnabled())
    return mediaUseFailure("disabled", "Granting use is switched off.")
  if (!isObject(input)) return mediaUseInvalid({ form: "Reload the page." })
  const errors: Record<string, string> = {}
  const requestKey = input.requestKey
  if (typeof requestKey !== "string" || !REQUEST_KEY_PATTERN.test(requestKey))
    errors.requestKey = "Reload the page and try again."
  if (!isUuid(input.assetId)) return NOT_FOUND
  const destinationKey = input.destinationKey
  if (
    typeof destinationKey !== "string" ||
    !DESTINATION_KEY.test(destinationKey)
  )
    errors.destinationKey = "Choose where the photo is used."
  const purpose = input.purpose as UsePurpose
  if (!USE_PURPOSES.includes(purpose))
    errors.purpose = "Choose what the photo is used for."
  const subjectId = input.subjectId ?? null
  const kind = USE_PURPOSES.includes(purpose)
    ? SUBJECT_KIND_FOR_PURPOSE[purpose]
    : null
  if (kind && (kind === "none" ? subjectId !== null : !isUuid(subjectId)))
    errors.subjectId = "Choose what the photo shows."
  const profileKey = input.profileKey ?? null
  if (
    profileKey !== null &&
    (typeof profileKey !== "string" || !PROFILE_KEY.test(profileKey))
  )
    errors.profileKey = "Choose a public version profile."
  const from = optionalInstant(input.effectiveFrom)
  const until = optionalInstant(input.effectiveUntil)
  if (from === undefined) errors.effectiveFrom = "Enter a valid start."
  if (until === undefined) errors.effectiveUntil = "Enter a valid end."
  else if (
    until &&
    Date.parse(until) <= Date.parse(from ?? new Date().toISOString())
  )
    errors.effectiveUntil = "The end must be after the start."
  const version = input.clearanceVersion
  if (typeof version !== "string" || !CLEARANCE_VERSION.test(version))
    errors.clearanceVersion = "Reload the page to get the current checklist."
  const clearance = clearanceMap(input.clearance)
  if (!clearance || Object.values(clearance).some((v) => !v))
    errors.clearance = "Confirm every item on the checklist."
  const note = optionalText(input.note, USE_LIMITS.noteMax)
  if (note === undefined)
    errors.note = `Keep the note under ${USE_LIMITS.noteMax} characters.`
  if (Object.keys(errors).length > 0) return mediaUseInvalid(errors)

  const { data, error } = await mediaUseRpc(
    actor.db,
    "media_use_grant_create",
    {
      p_request_key: requestKey as string,
      p_asset_id: input.assetId as string,
      p_destination_key: destinationKey as string,
      p_purpose: purpose,
      p_subject_kind: kind!,
      p_subject_id: subjectId as string | null,
      p_profile_key: profileKey as string | null,
      p_effective_from: from ?? null,
      p_effective_until: until ?? null,
      p_clearance_version: version as string,
      p_clearance: clearance!,
      p_note: note ?? null,
    }
  )
  if (error) return mediaUseRpcFailure(error, "use grant create")
  return { ok: true, ...data }
}

function withdrawInput(input: Record<string, unknown>) {
  const errors: Record<string, string> = {}
  const requestKey = input.requestKey
  if (typeof requestKey !== "string" || !REQUEST_KEY_PATTERN.test(requestKey))
    errors.requestKey = "Reload the page and try again."
  const reason = input.reasonCode as UseWithdrawReason
  if (!USE_WITHDRAW_REASONS.includes(reason))
    errors.reasonCode = "Choose a reason."
  const note = optionalText(input.note, USE_LIMITS.noteMax)
  if (note === undefined)
    errors.note = `Keep the note under ${USE_LIMITS.noteMax} characters.`
  return {
    errors,
    requestKey: requestKey as string,
    reason,
    note: note ?? null,
  }
}

/** Withdraws one grant. Terminal and safe to repeat; works with the switch off. */
export async function withdrawUseGrant(
  actor: MediaActor,
  input: unknown
): Promise<UseResult<UseGrantWithdrawn>> {
  if (!isObject(input) || !isUuid(input.grantId))
    return mediaUseFailure("not_found", "This use grant could not be found.")
  const parsed = withdrawInput(input)
  if (Object.keys(parsed.errors).length > 0)
    return mediaUseInvalid(parsed.errors)
  const { data, error } = await mediaUseRpc(
    actor.db,
    "media_use_grant_withdraw",
    {
      p_request_key: parsed.requestKey,
      p_grant_id: input.grantId,
      p_reason_code: parsed.reason,
      p_note: parsed.note,
    }
  )
  if (error) return mediaUseRpcFailure(error, "use grant withdraw")
  return { ok: true, ...data }
}

/** Withdraws every grant on an asset. Safe to repeat; works with the switch off. */
export async function withdrawAssetUse(
  actor: MediaActor,
  input: unknown
): Promise<UseResult<AssetUseWithdrawn>> {
  if (!isObject(input) || !isUuid(input.assetId)) return NOT_FOUND
  const parsed = withdrawInput(input)
  if (Object.keys(parsed.errors).length > 0)
    return mediaUseInvalid(parsed.errors)
  const { data, error } = await mediaUseRpc(
    actor.db,
    "media_use_withdraw_asset",
    {
      p_request_key: parsed.requestKey,
      p_asset_id: input.assetId,
      p_reason_code: parsed.reason,
      p_note: parsed.note,
    }
  )
  if (error) return mediaUseRpcFailure(error, "asset use withdraw")
  return { ok: true, ...data }
}

/**
 * An asset's use state for its uploader (labels only), its venue manager or
 * an admin (purpose, period and the granter's first name). Anyone else:
 * not found.
 */
export async function getAssetUseStatus(
  actor: MediaActor,
  input: unknown
): Promise<UseResult<{ status: AssetUseStatus }>> {
  if (!isObject(input) || !isUuid(input.assetId)) return NOT_FOUND
  const { data, error } = await mediaUseRpc(actor.db, "asset_use_status", {
    p_asset_id: input.assetId,
  })
  if (error) return mediaUseRpcFailure(error, "asset use status")
  return { ok: true, status: data }
}
