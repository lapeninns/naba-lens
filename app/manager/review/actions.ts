"use server"

import { setSlotPrimaryPhoto } from "@/lib/server/album"
import { apiError } from "@/lib/server/http/errors"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"
import {
  decideAmenityPhotoChecked,
  decideBatch,
  decidePlacePhoto,
  fixSlotLabel,
  fromCoverageFailure,
  listFixLabelSlots,
  setAsidePhoto,
  setDishLevel,
  type FixLabelSlot,
  type ReviewFailure,
  type ReviewResult,
} from "@/lib/server/review/inbox"
import type { BatchOutcome } from "@/lib/review/inbox"

// S2-REVIEW Server Functions (spec §7 M2): the photo detail's decisions and
// batch decisions. Inputs are `unknown` (public POST endpoints) and every
// call re-authorises: a manager's venue always comes from their workspace
// scope, an admin names it. The database checks the venue, the role, the
// caller's own photo and the stale-decision rule each time. Nothing is
// revalidated: the screens refresh themselves after a decision.

type Input = Record<string, unknown>
const obj = (input: unknown): Input =>
  input && typeof input === "object" ? (input as Input) : {}

async function scoped(input: Input) {
  const scope = await getManagerPhotoCtx(input.venueId)
  if (scope.ok) return scope
  const failure: ReviewFailure = apiError(
    scope.code === "not_found"
      ? "not_found"
      : scope.code === "unavailable"
        ? "unavailable"
        : scope.code === "account_inactive"
          ? "account_inactive"
          : "forbidden",
    { message: scope.message }
  )
  return { ok: false as const, failure }
}

/** Not used, Mark duplicate or Restore on a whole photo. */
export async function setAsidePhotoAction(
  input: unknown
): Promise<ReviewResult<{ dispositionId: number }>> {
  const i = obj(input)
  const scope = await scoped(i)
  if (!scope.ok) return scope.failure
  return setAsidePhoto(scope.ctx, {
    assetId: i.assetId,
    action: i.action,
    reason: i.reason,
    reasonCode: i.reasonCode,
    duplicateOf: i.duplicateOf,
    expectedDispositionId: i.expectedDispositionId,
  })
}

/** Approve for public use or Keep as reference on one dish label. */
export async function setDishLevelAction(
  input: unknown
): Promise<ReviewResult<{ itemRevision: number }>> {
  const i = obj(input)
  const scope = await scoped(i)
  if (!scope.ok) return scope.failure
  return setDishLevel(scope.ctx, {
    assetId: i.assetId,
    itemId: i.itemId,
    variantId: i.variantId ?? null,
    level: i.level,
    expectedRevision: i.expectedRevision,
    requestKey: typeof i.requestKey === "string" ? i.requestKey : null,
  })
}

/** One decision on a place photo, against the decision the screen saw. */
export async function decidePlacePhotoAction(
  input: unknown
): Promise<ReviewResult<{ decisionId: number | null; state: string }>> {
  const i = obj(input)
  const scope = await scoped(i)
  if (!scope.ok) return scope.failure
  return decidePlacePhoto(scope.ctx, {
    labelId: i.labelId,
    action: i.action,
    level: i.level,
    reason: i.reason,
    expectedDecisionId: i.expectedDecisionId,
  })
}

/** One decision on an amenity photo, against the decision the screen saw. */
export async function decideAmenityPhotoAction(
  input: unknown
): Promise<ReviewResult<{ decisionId: number | null; state: string }>> {
  const i = obj(input)
  const scope = await scoped(i)
  if (!scope.ok) return scope.failure
  return decideAmenityPhotoChecked(scope.ctx, {
    checkId: i.checkId,
    assetId: i.assetId,
    action: i.action,
    level: i.level,
    reason: i.reason,
    expectedDecisionId: i.expectedDecisionId,
  })
}

/** One decision on each selected photo, each checked on its own. */
export async function decideBatchAction(
  input: unknown
): Promise<ReviewResult<{ outcomes: BatchOutcome[] }>> {
  const i = obj(input)
  const scope = await scoped(i)
  if (!scope.ok) return scope.failure
  return decideBatch(scope.ctx, {
    action: i.action,
    items: i.items,
    reason: i.reason,
  })
}

/** Select primary for a place or amenity slot (dishes use set_preferred). */
export async function setSlotPrimaryAction(
  input: unknown
): Promise<ReviewResult<{ changed: boolean }>> {
  const i = obj(input)
  const scope = await scoped(i)
  if (!scope.ok) return scope.failure
  const result = await setSlotPrimaryPhoto(scope.ctx.actor, {
    slotKind: i.slotKind,
    slotId: i.slotId,
    assetId: i.assetId,
  })
  if (result.ok) return { ok: true, changed: result.changed }
  return fromCoverageFailure(result)
}

/** The venue's places and amenity checks, for the Fix label picker (S3-R13). */
export async function loadFixLabelSlotsAction(
  input: unknown
): Promise<ReviewResult<{ slots: FixLabelSlot[] }>> {
  const i = obj(input)
  const scope = await scoped(i)
  if (!scope.ok) return scope.failure
  return listFixLabelSlots(scope.ctx)
}

/** Fix label to a place or an amenity, or off one onto a dish (S3-R13 X8). */
export async function fixSlotLabelAction(
  input: unknown
): Promise<ReviewResult<{ toKind: string }>> {
  const i = obj(input)
  const scope = await scoped(i)
  if (!scope.ok) return scope.failure
  return fixSlotLabel(scope.ctx, {
    assetId: i.assetId,
    fromKind: i.fromKind,
    fromId: i.fromId,
    fromVariantId: i.fromVariantId,
    toKind: i.toKind,
    toId: i.toId,
    toVariantId: i.toVariantId,
    level: i.level,
    reason: i.reason,
    expectedRevision: i.expectedRevision,
  })
}
