import "server-only"

import {
  coverageRpcFailure,
  failure,
  invalid,
  type DbError,
} from "@/lib/server/coverage/errors"

import type { MenuPhotoFailure } from "./types"

// Item-photo decision failures for the manager workspace. The messages the
// manager rules add are mapped here first; everything else (revision
// conflicts, venue scope, not found, field errors, unexpected failures logged
// redacted as 503) goes through the shared coverage mapping.

export const OWN_PHOTO_MESSAGE =
  "This is your photo. Another reviewer decides on it."

const RELOAD_REQUEST = "This request is invalid. Reload the page."

const STATE_MESSAGES: Record<string, string> = {
  menu_item_relinked:
    "A reviewer already moved this photo to another item. Reload to see the latest.",
  menu_item_labelled:
    "Staff labelled this photo with that item. Use Accept for this item instead.",
  asset_has_labels:
    "This photo has a staff label now. Reload to review it from its label.",
  relink_requires_label:
    "The staff label on this photo changed. Reload the page.",
  invalid_transition:
    "This photo was already decided. Reload to see the decision.",
  menu_item_unavailable:
    "This item is not on the venue's current menu. Reload to see the current menu.",
  menu_item_not_labelled:
    "This photo is not labelled with this item. Reload the page.",
}

const WITHDRAW_FIRST =
  "This photo already has a decision for its labelled item. Withdraw that decision first."

const NOT_FOOD_OR_DRINK =
  "Only photos of food or drink can be used for a menu item."

/** `context` names the operation in the redacted log of unexpected failures. */
export function menuPhotoFailure(
  error: DbError,
  context: string,
  assetIds: string[] = []
): MenuPhotoFailure {
  const message = error?.message ?? ""
  if (message === "self_review_not_allowed")
    return failure("not_permitted", OWN_PHOTO_MESSAGE)
  if (message === "invalid_transition" && error?.details === "withdraw first")
    return { ...failure("state_conflict", WITHDRAW_FIRST), needsRefresh: true }
  if (message in STATE_MESSAGES)
    return {
      ...failure("state_conflict", STATE_MESSAGES[message]),
      needsRefresh: true,
    }
  if (message === "corrects_mismatch")
    return invalid({}, "This photo changed. Reload the page.")
  if (message === "idempotency_key_reused") return invalid({}, RELOAD_REQUEST)
  if (
    message === "evidence_not_eligible" &&
    error?.details === "not_food_or_drink"
  )
    return failure("asset_ineligible", NOT_FOOD_OR_DRINK, { assetErrors: [] })
  return coverageRpcFailure(error, context, assetIds)
}

export const BAD_REQUEST = invalid({}, RELOAD_REQUEST)
