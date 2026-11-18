import "server-only"

// The manager review inbox's server half (Full App v1 S2-REVIEW; spec §7 M2):
// the photo detail read, Not used / Mark duplicate / Restore, stale-checked
// place and amenity decisions, the amenity photo queue, and batch decisions.
// Every call goes through the caller's own session; the database checks the
// venue, the role and the stale-decision rule each time
// (20261118110000_review_inbox.sql). Errors use the shared envelope
// (lib/server/http/errors.ts).

import { setMenuItemPhotoLevel } from "@/lib/server/album"
import { apiError, fromDbError, type ApiError } from "@/lib/server/http/errors"
import { redactError } from "@/lib/server/log/redact"
import type { ManagerPhotoCtx } from "@/lib/server/menu-photos"
import { isUuid } from "@/lib/server/coverage/validate"
import {
  parsePhotoDetail,
  RevisionChain,
  type BatchAction,
  type BatchItem,
  type BatchOutcome,
  type PhotoDetail,
  type ReviewLevel,
} from "@/lib/review/inbox"

/** The decision someone else made first (a stale screen's conflict). */
export type LatestDecision = {
  action: string | null
  level: string | null
  reason: string | null
  by: string | null
  at: string | null
}

export type ReviewFailure = ApiError & { latest?: LatestDecision }
export type ReviewResult<T = object> = ({ ok: true } & T) | ReviewFailure

/** Plain words for the database's refusals (spec §13 error taxonomy). */
const WORDS: Record<
  string,
  { code: Parameters<typeof apiError>[0]; message: string; nextAction?: string }
> = {
  reason_required: {
    code: "invalid_input",
    message: "Say why this photo is not used.",
  },
  invalid_reason: { code: "invalid_input", message: "Shorten the reason." },
  self_review_not_allowed: {
    code: "forbidden",
    message: "This is your photo. Another reviewer decides on it.",
  },
  withdraw_first: {
    code: "conflict",
    message: "This photo has a decision. Withdraw it first.",
    nextAction: "Withdraw the decision, then try again.",
  },
  duplicate_target_invalid: {
    code: "invalid_input",
    message: "Choose a photo that is already in the album at this venue.",
  },
  already_set_aside: {
    code: "conflict",
    message: "This photo is already set aside.",
  },
  nothing_to_restore: {
    code: "conflict",
    message: "This photo is not set aside.",
  },
  media_asset_not_found: {
    code: "not_found",
    message: "This photo could not be found at your venue.",
  },
  area_photo_not_found: {
    code: "not_found",
    message: "This place photo could not be found.",
  },
  amenity_photo_not_found: {
    code: "not_found",
    message: "This amenity photo could not be found.",
  },
  area_photo_conflict: {
    code: "stale_version",
    message: "Someone else decided this photo first.",
  },
  amenity_photo_conflict: {
    code: "stale_version",
    message: "Someone else decided this photo first.",
  },
  invalid_decision: { code: "invalid_input", message: "Choose a decision." },
  invalid_level: { code: "invalid_input", message: "Choose a level." },
  invalid_media_type: { code: "invalid_input", message: "Reload the page." },
}

function latestOf(details: string | undefined): LatestDecision | undefined {
  if (!details) return undefined
  try {
    const d = JSON.parse(details) as Record<string, unknown>
    const s = (v: unknown) => (typeof v === "string" ? v : null)
    if (!s(d.action)) return undefined
    return {
      action: s(d.action),
      level: s(d.level),
      reason: s(d.reason),
      by: s(d.by),
      at: s(d.at),
    }
  } catch {
    return undefined
  }
}

/** A database error as the shared envelope, with the latest decision on a conflict. */
export function reviewFailure(
  error: { message?: string; code?: string; details?: string } | null,
  what: string
): ReviewFailure {
  const message = error?.message ?? ""
  if (message === "review_conflict" || message === "coverage_conflict") {
    return {
      ...apiError("stale_version", {
        message: "Someone else decided this photo since you opened it.",
        nextAction: "Check the latest decision below, then decide again.",
      }),
      ...(message === "review_conflict"
        ? { latest: latestOf(error?.details) }
        : {}),
    }
  }
  const known = WORDS[message]
  if (known)
    return apiError(known.code, {
      message: known.message,
      ...(known.nextAction ? { nextAction: known.nextAction } : {}),
    })
  const mapped = fromDbError(error)
  if (mapped.code === "unavailable")
    console.error(`[review] ${what} failed`, redactError(error))
  return mapped
}

const BAD = (field: string, message: string) =>
  apiError("invalid_input", { field, message })

/** A coverage-style failure (lib/server/album) as the shared envelope. */
export function fromCoverageFailure(failure: {
  status: number
  message: string
}): ReviewFailure {
  const code =
    failure.status === 404
      ? "not_found"
      : failure.status === 403
        ? "forbidden"
        : failure.status === 400
          ? "invalid_input"
          : failure.status === 409
            ? "conflict"
            : "unavailable"
  return apiError(code, { message: failure.message })
}

/** One photo, everything a reviewer checks before deciding (§7 M2). */
export async function getPhotoDetail(
  ctx: ManagerPhotoCtx,
  assetId: unknown
): Promise<ReviewResult<{ detail: PhotoDetail }>> {
  if (!isUuid(assetId)) return apiError("not_found")
  const { data, error } = await ctx.actor.db.rpc("review_photo_detail", {
    p_asset_id: assetId,
  })
  if (error) return reviewFailure(error, "photo detail")
  const detail = parsePhotoDetail(data)
  if (!detail) {
    console.error("[review] photo detail shape")
    return apiError("unavailable")
  }
  // An admin's scope names one venue: a photo elsewhere is not found here.
  if (detail.venueId !== ctx.venueId) return apiError("not_found")
  return { ok: true, detail }
}

export type SetAsideInput = {
  assetId: unknown
  action: unknown
  reason?: unknown
  reasonCode?: unknown
  duplicateOf?: unknown
  /** The disposition the screen saw (null before any). */
  expectedDispositionId?: unknown
}

/** Not used (with a reason), Mark duplicate (linked) or Restore, on a whole photo. */
export async function setAsidePhoto(
  ctx: ManagerPhotoCtx,
  input: SetAsideInput
): Promise<ReviewResult<{ dispositionId: number }>> {
  if (!isUuid(input.assetId)) return apiError("not_found")
  const action = input.action
  if (action !== "not_used" && action !== "duplicate" && action !== "restored")
    return BAD("action", "Choose a decision.")
  const reason =
    typeof input.reason === "string" ? input.reason.trim() || null : null
  if (action === "not_used" && !reason)
    return BAD("reason", "Say why this photo is not used.")
  if (reason && reason.length > 500)
    return BAD("reason", "Shorten the reason to 500 characters.")
  const reasonCode =
    typeof input.reasonCode === "string" &&
    /^[a-z][a-z_]{0,39}$/.test(input.reasonCode)
      ? input.reasonCode
      : null
  if (action === "duplicate" && !isUuid(input.duplicateOf))
    return BAD("duplicateOf", "Choose the photo this one repeats.")
  const expected = input.expectedDispositionId
  if (
    expected != null &&
    (typeof expected !== "number" || !Number.isInteger(expected))
  )
    return BAD("expectedDispositionId", "Reload the page.")
  const { data, error } = await ctx.actor.db.rpc("review_set_aside", {
    p_asset_id: input.assetId,
    p_action: action,
    ...(reason ? { p_reason: reason } : {}),
    ...(reasonCode ? { p_reason_code: reasonCode } : {}),
    ...(action === "duplicate"
      ? { p_duplicate_of: input.duplicateOf as string }
      : {}),
    ...(typeof expected === "number"
      ? { p_expected_disposition_id: expected }
      : {}),
  })
  if (error) return reviewFailure(error, "set aside")
  const id = (data as { dispositionId?: unknown } | null)?.dispositionId
  return { ok: true, dispositionId: typeof id === "number" ? id : 0 }
}

export type SlotDecision =
  "accepted" | "needs_another_photo" | "not_used" | "withdrawn"
const isSlotDecision = (v: unknown): v is SlotDecision =>
  v === "accepted" ||
  v === "needs_another_photo" ||
  v === "not_used" ||
  v === "withdrawn"

type SlotDecisionInput = {
  action: unknown
  level?: unknown
  reason?: unknown
  expectedDecisionId?: unknown
}

function slotArgs(input: SlotDecisionInput) {
  if (!isSlotDecision(input.action)) return BAD("action", "Choose a decision.")
  const level = input.level ?? "public"
  if (level !== "public" && level !== "reference")
    return BAD("level", "Choose a level.")
  const reason =
    typeof input.reason === "string" ? input.reason.trim() || null : null
  if (input.action !== "accepted" && !reason) return BAD("reason", "Say why.")
  if (reason && reason.length > 500)
    return BAD("reason", "Shorten the reason to 500 characters.")
  const expected = input.expectedDecisionId
  if (
    expected != null &&
    (typeof expected !== "number" || !Number.isInteger(expected))
  )
    return BAD("expectedDecisionId", "Reload the page.")
  return {
    p_action: input.action,
    p_level: level as ReviewLevel,
    ...(reason ? { p_reason: reason } : {}),
    ...(typeof expected === "number"
      ? { p_expected_decision_id: expected }
      : {}),
  }
}

/** One decision on a place photo, against the decision the screen saw. */
export async function decidePlacePhoto(
  ctx: ManagerPhotoCtx,
  input: SlotDecisionInput & { labelId: unknown }
): Promise<ReviewResult<{ decisionId: number | null; state: string }>> {
  if (!isUuid(input.labelId)) return apiError("not_found")
  const args = slotArgs(input)
  if ("ok" in args) return args
  const { data, error } = await ctx.actor.db.rpc("review_decide_area_photo", {
    p_label_id: input.labelId,
    ...args,
  })
  if (error) return reviewFailure(error, "place photo decision")
  const row = data?.[0]
  return {
    ok: true,
    decisionId: row?.decision_id ?? null,
    state: row?.state ?? String(input.action),
  }
}

/** One decision on an amenity check's photo, against the decision the screen saw. */
export async function decideAmenityPhotoChecked(
  ctx: ManagerPhotoCtx,
  input: SlotDecisionInput & { checkId: unknown; assetId: unknown }
): Promise<ReviewResult<{ decisionId: number | null; state: string }>> {
  if (!isUuid(input.checkId) || !isUuid(input.assetId))
    return apiError("not_found")
  const args = slotArgs(input)
  if ("ok" in args) return args
  const { data, error } = await ctx.actor.db.rpc(
    "review_decide_amenity_photo",
    {
      p_check_id: input.checkId,
      p_asset_id: input.assetId,
      ...args,
    }
  )
  if (error) return reviewFailure(error, "amenity photo decision")
  const row = data?.[0]
  return {
    ok: true,
    decisionId: row?.decision_id ?? null,
    state: row?.state ?? String(input.action),
  }
}

/** Approve for public use or Keep as reference, on one dish label. */
export async function setDishLevel(
  ctx: ManagerPhotoCtx,
  input: {
    assetId: unknown
    itemId: unknown
    variantId?: unknown
    level: unknown
    expectedRevision: unknown
    requestKey?: string | null
  }
): Promise<ReviewResult<{ itemRevision: number }>> {
  const result = await setMenuItemPhotoLevel(ctx.actor, input)
  if (result.ok) return { ok: true, itemRevision: result.itemRevision }
  if (result.code === "revision_conflict")
    return reviewFailure({ message: "coverage_conflict" }, "dish level")
  return fromCoverageFailure(result)
}

/** An amenity photo waiting for review, for the Review page (FA-32). */
export type AmenityQueueRow = {
  checkId: string
  question: string
  assetId: string
  uploaderName: string
  uploadedAt: string
  canDecide: boolean
  hasThumbnail: boolean
  photoRequired: boolean
}

/** The venue's amenity photos waiting for review, oldest first. */
export async function listAmenityPhotoQueue(
  ctx: ManagerPhotoCtx,
  limit = 50
): Promise<ReviewResult<{ rows: AmenityQueueRow[]; more: boolean }>> {
  const { data, error } = await ctx.actor.db.rpc("amenity_photo_queue", {
    p_venue_id: ctx.venueId,
    p_status: "pending",
    p_limit: limit + 1,
  })
  if (error) return reviewFailure(error, "amenity photo queue")
  const rows = (data ?? []).map((r) => ({
    checkId: r.check_id,
    question: r.question,
    assetId: r.asset_id,
    uploaderName: r.uploader_name,
    uploadedAt: r.uploaded_at,
    canDecide: r.can_decide,
    hasThumbnail: r.has_thumbnail,
    photoRequired: r.photo_required,
  }))
  return { ok: true, rows: rows.slice(0, limit), more: rows.length > limit }
}

/** Most photos one batch decides (each still checked on its own). */
export const BATCH_MAX = 24

/**
 * One decision on each selected photo, in order, each checked on its own by
 * the database (spec §7 M2 Batch decisions, AC37). Approve for public use and
 * Keep as reference set a dish label's level; Not used sets the whole photo
 * aside with the shared reason. Photos of the same dish are decided against
 * the revision the previous one left (RevisionChain). A failure stops nothing:
 * every photo gets its own outcome.
 */
export async function decideBatch(
  ctx: ManagerPhotoCtx,
  input: { action: unknown; items: unknown; reason?: unknown }
): Promise<ReviewResult<{ outcomes: BatchOutcome[] }>> {
  const action = input.action as BatchAction
  if (action !== "public" && action !== "reference" && action !== "not_used")
    return BAD("action", "Choose a decision.")
  if (!Array.isArray(input.items) || input.items.length === 0)
    return BAD("items", "Choose at least one photo.")
  if (input.items.length > BATCH_MAX)
    return BAD("items", `Choose at most ${BATCH_MAX} photos at a time.`)
  const items: BatchItem[] = []
  for (const raw of input.items) {
    const i = raw as Partial<BatchItem>
    if (
      typeof i?.key !== "string" ||
      !isUuid(i.assetId) ||
      (i.itemId != null && !isUuid(i.itemId)) ||
      (i.variantId != null && !isUuid(i.variantId)) ||
      typeof i.itemRevision !== "number" ||
      (i.dispositionId != null &&
        (typeof i.dispositionId !== "number" ||
          !Number.isInteger(i.dispositionId)))
    )
      return BAD("items", "Reload the page and choose the photos again.")
    if (action !== "not_used" && !i.itemId)
      return BAD(
        "items",
        "Only photos labelled with a menu item can be accepted together."
      )
    items.push({
      key: i.key,
      assetId: i.assetId,
      itemId: i.itemId ?? null,
      variantId: i.variantId ?? null,
      itemRevision: i.itemRevision,
      dispositionId: i.dispositionId ?? null,
    })
  }
  const reason =
    typeof input.reason === "string" ? input.reason.trim() || null : null
  if (action === "not_used" && !reason)
    return BAD("reason", "Say why these photos are not used.")

  const chain = new RevisionChain()
  const outcomes: BatchOutcome[] = []
  const setAsideDone = new Set<string>()
  for (const item of items) {
    if (action === "not_used") {
      // One photo may have a card per dish: it is set aside once.
      if (setAsideDone.has(item.assetId)) {
        outcomes.push({ key: item.key, assetId: item.assetId, ok: true })
        continue
      }
      const r = await setAsidePhoto(ctx, {
        assetId: item.assetId,
        action: "not_used",
        reason,
        reasonCode: "not_used_batch",
        // V16: against the disposition the screen saw, so a restored photo
        // is set aside again and a newer decision still conflicts.
        expectedDispositionId: item.dispositionId ?? null,
      })
      if (r.ok) setAsideDone.add(item.assetId)
      outcomes.push(outcomeOf(item, r))
      continue
    }
    const r = await setDishLevel(ctx, {
      assetId: item.assetId,
      itemId: item.itemId,
      variantId: item.variantId,
      level: action,
      expectedRevision: chain.expected(item),
    })
    if (r.ok) chain.record(item, r.itemRevision)
    outcomes.push(outcomeOf(item, r))
  }
  return { ok: true, outcomes }
}

function outcomeOf(item: BatchItem, r: ReviewResult): BatchOutcome {
  if (r.ok) return { key: item.key, assetId: item.assetId, ok: true }
  return {
    key: item.key,
    assetId: item.assetId,
    ok: false,
    error: r.message,
    ...(r.code === "stale_version" ? { conflict: true } : {}),
  }
}
