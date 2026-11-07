import "server-only"

import { isObject } from "@/lib/server/coverage/validate"

import type { ManagerPhotoCtx } from "./context"
import { BAD_REQUEST, menuPhotoFailure } from "./errors"
import { listReviewQueue } from "./read"
import type {
  DecideInput,
  DecisionOutcome,
  MenuPhotoFailure,
  MenuPhotoResult,
  QueueCard,
  QueueStatus,
} from "./types"
import { isQueueStatus, parseDecideInput } from "./validate"

// Item-photo decisions from the manager workspace (and the admin Review page).
// Thin local wrappers call the four RPCs directly and map errors through
// menuPhotoFailure (the own-photo rule and the relink states have their own
// copy). The database checks scope, the no-self-review rule, revisions and
// replays in the same transaction as the write.

type Written = {
  itemId: string
  itemRevision: number
  replayed: boolean
  /** The corrected (source) item's new head, when the write bumped it. */
  correctsItem?: { itemId: string; itemRevision: number } | null
}
type RpcError = { message?: string; code?: string; details?: string | null }
type Call = Promise<
  { ok: true; written: Written } | { ok: false; error: RpcError | null }
>

// supabase-js serialises null; the generated argument types say string.
const nullable = (v: string | null | undefined) => (v ?? null) as string

async function reviewItemPhoto(ctx: ManagerPhotoCtx, i: DecideInput): Call {
  const { data, error } = await ctx.actor.db.rpc("review_menu_item_photo", {
    p_asset_id: i.assetId,
    p_item_id: i.itemId,
    p_variant_id: nullable(i.variantId),
    p_decision:
      i.action === "ask_another" ? "better_photo_requested" : "accepted",
    p_expected_revision: i.expectedRevision,
    ...(i.reason ? { p_reason: i.reason } : {}),
    p_make_primary: i.action === "accept_preferred",
    p_client_request_key: i.requestId,
  })
  const row = data?.[0]
  if (error || !row) return { ok: false, error }
  return {
    ok: true,
    written: {
      itemId: row.item_id,
      itemRevision: row.item_revision,
      replayed: row.replayed,
    },
  }
}

async function assignItemPhoto(ctx: ManagerPhotoCtx, i: DecideInput): Call {
  const { data, error } = await ctx.actor.db.rpc("assign_menu_item_photo", {
    p_asset_id: i.assetId,
    p_item_id: i.itemId,
    p_variant_id: nullable(i.variantId),
    p_corrects_item_id: nullable(
      i.action === "assign_unlabelled" ? null : i.correctsItemId
    ),
    p_corrects_variant_id: nullable(
      i.action === "assign_unlabelled" ? null : i.correctsVariantId
    ),
    p_reason: nullable(i.reason),
    p_expected_revision: i.expectedRevision,
    p_make_primary: false,
    p_client_request_key: i.requestId,
  })
  const row = data?.[0]
  if (error || !row) return { ok: false, error }
  const correctsItemId =
    i.action === "assign_unlabelled" ? null : (i.correctsItemId ?? null)
  return {
    ok: true,
    written: {
      itemId: row.item_id,
      itemRevision: row.item_revision,
      replayed: row.replayed,
      correctsItem:
        correctsItemId && row.corrects_item_revision != null
          ? {
              itemId: correctsItemId,
              itemRevision: row.corrects_item_revision,
            }
          : null,
    },
  }
}

async function setPrimaryItemPhoto(ctx: ManagerPhotoCtx, i: DecideInput): Call {
  const { data, error } = await ctx.actor.db.rpc(
    "set_menu_item_primary_photo",
    {
      p_photo_id: i.photoId!,
      p_expected_revision: i.expectedRevision,
      p_client_request_key: i.requestId,
    }
  )
  const row = data?.[0]
  if (error || !row) return { ok: false, error }
  return {
    ok: true,
    written: {
      itemId: i.itemId,
      itemRevision: row.item_revision,
      replayed: row.replayed,
    },
  }
}

async function withdrawItemPhoto(ctx: ManagerPhotoCtx, i: DecideInput): Call {
  const { data, error } = await ctx.actor.db.rpc("withdraw_menu_item_photo", {
    p_photo_id: i.photoId!,
    p_expected_revision: i.expectedRevision,
    p_reason: i.reason!,
    p_client_request_key: i.requestId,
  })
  const row = data?.[0]
  if (error || !row) return { ok: false, error }
  return {
    ok: true,
    written: {
      itemId: i.itemId,
      itemRevision: row.item_revision,
      replayed: row.replayed,
    },
  }
}

function callFor(i: DecideInput) {
  switch (i.action) {
    case "accept":
    case "accept_preferred":
    case "ask_another":
      return reviewItemPhoto
    case "reaccept":
      return i.basis === "reviewer" ? assignItemPhoto : reviewItemPhoto
    case "set_preferred":
      return setPrimaryItemPhoto
    case "withdraw":
      return withdrawItemPhoto
    case "relink":
    case "assign_stale":
    case "assign_unlabelled":
      return assignItemPhoto
  }
}

const ITEMLESS: readonly QueueStatus[] = ["stale_label", "unlabelled"]

/**
 * The cards to show after a decision: the item's cards for the current
 * status (on the stale and unlabelled views, which have no item, the asset's
 * own cards). Empty when the re-read fails: the decision itself stands.
 */
async function freshCards(
  ctx: ManagerPhotoCtx,
  status: QueueStatus,
  itemId: string,
  assetId: string
): Promise<QueueCard[]> {
  const page = await listReviewQueue(ctx, { status, itemId })
  if (!page.ok) return []
  return ITEMLESS.includes(status)
    ? page.items.filter((c) => c.asset.assetId === assetId)
    : page.items
}

async function itemState(
  ctx: ManagerPhotoCtx,
  itemId: string
): Promise<{ covered: boolean; preferredAssetId: string | null }> {
  const { data } = await ctx.actor.db.rpc("manager_menu_photo_item", {
    p_venue_id: ctx.venueId,
    p_item_id: itemId,
  })
  const row = data?.[0]
  return {
    covered: row?.covered ?? false,
    preferredAssetId: row?.preferred_asset_id ?? null,
  }
}

/**
 * One review decision: accept (optionally as the menu photo), set the menu
 * photo, ask for another photo, withdraw, accept again after a recheck, or
 * match the photo to another item (relink, stale label, unlabelled). A retry
 * with the same `requestId` replays the committed decision. On success, and on
 * a revision conflict, the item's latest cards for `view.status` come back so
 * the screen updates in place.
 */
export async function decideMenuPhoto(
  ctx: ManagerPhotoCtx,
  input: unknown,
  view: unknown
): Promise<MenuPhotoResult<{ outcome: DecisionOutcome }>> {
  const parsed = parseDecideInput(input)
  if (!parsed.ok) return parsed
  const requested = isObject(view) ? view.status : undefined
  if (requested != null && !isQueueStatus(requested)) return BAD_REQUEST
  const status: QueueStatus = isQueueStatus(requested) ? requested : "pending"
  const i = parsed.input

  const result = await callFor(i)(ctx, i)
  if (!result.ok) {
    const failed: MenuPhotoFailure = menuPhotoFailure(
      result.error,
      `manager menu photo ${i.action}`,
      [i.assetId]
    )
    if (failed.code !== "revision_conflict") return failed
    return {
      ...failed,
      current: await freshCards(ctx, status, i.itemId, i.assetId),
    }
  }

  const { written } = result
  const [cards, state] = await Promise.all([
    freshCards(ctx, status, written.itemId, i.assetId),
    itemState(ctx, written.itemId),
  ])
  return {
    ok: true,
    outcome: {
      action: i.action,
      itemId: written.itemId,
      itemRevision: written.itemRevision,
      replayed: written.replayed,
      itemCovered: state.covered,
      preferredAssetId: state.preferredAssetId,
      correctsItem: written.correctsItem ?? null,
      cards,
    },
  }
}
