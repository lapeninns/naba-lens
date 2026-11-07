import "server-only"

import { invalid, NOT_FOUND } from "@/lib/server/coverage/errors"
import {
  intInRange,
  isObject,
  isRequestKey,
  isUuid,
  LIMITS,
  optionalText,
  optionalUuid,
} from "@/lib/server/coverage/validate"

import { BAD_REQUEST } from "./errors"
import type {
  DecideInput,
  DecisionAction,
  MenuPhotoResult,
  MenuStatusFilter,
  QueueStatus,
} from "./types"

// Input checks for the manager menu photo services. Server Actions are public
// POST endpoints, so every input arrives as `unknown`; the database repeats
// every rule.

export const MAX_REVISION = 2 ** 31 - 1

export const QUEUE_STATUSES: readonly QueueStatus[] = [
  "pending",
  "recheck",
  "needs_another_photo",
  "accepted",
  "stale_label",
  "unlabelled",
  "mine",
  "all",
]

export const MENU_STATUSES: readonly MenuStatusFilter[] = [
  "covered",
  "awaiting_review",
  "needs_photo",
  "recheck",
  "replacement",
]

export const isQueueStatus = (v: unknown): v is QueueStatus =>
  typeof v === "string" && (QUEUE_STATUSES as readonly string[]).includes(v)

export const isMenuStatus = (v: unknown): v is MenuStatusFilter =>
  typeof v === "string" && (MENU_STATUSES as readonly string[]).includes(v)

const ACTIONS: readonly DecisionAction[] = [
  "accept",
  "accept_preferred",
  "set_preferred",
  "ask_another",
  "withdraw",
  "reaccept",
  "relink",
  "assign_stale",
  "assign_unlabelled",
]

const REASON_REQUIRED: Partial<Record<DecisionAction, string>> = {
  ask_another: "Say what the next photo should show.",
  withdraw: "Say why this photo is no longer right.",
  relink: "Say why the staff label is wrong.",
}

const NEEDS_PHOTO_ID: readonly DecisionAction[] = ["set_preferred", "withdraw"]
const NEEDS_CORRECTS: readonly DecisionAction[] = ["relink", "assign_stale"]

/** A decision input, checked: ids, action, revision, reason and the label being corrected. */
export function parseDecideInput(
  input: unknown
): MenuPhotoResult<{ input: DecideInput }> {
  if (!isObject(input)) return BAD_REQUEST
  if (!isRequestKey(input.requestId))
    return invalid({ requestId: "This request is invalid. Reload the page." })
  const action = input.action
  if (
    typeof action !== "string" ||
    !(ACTIONS as readonly string[]).includes(action)
  )
    return invalid({ action: "Choose a decision." })
  const act = action as DecisionAction
  if (!isUuid(input.assetId) || !isUuid(input.itemId)) return NOT_FOUND
  const variantId = optionalUuid(input.variantId)
  if (variantId === undefined) return NOT_FOUND
  const photoId = optionalUuid(input.photoId)
  if (photoId === undefined) return NOT_FOUND
  if (NEEDS_PHOTO_ID.includes(act) && !photoId) return NOT_FOUND
  if (!intInRange(input.expectedRevision, 1, MAX_REVISION)) return BAD_REQUEST

  const reason = optionalText(input.reason, LIMITS.reasonMax)
  if (reason === undefined)
    return invalid({ reason: "Use up to 500 characters." })
  const required = REASON_REQUIRED[act]
  if (required && !reason) return invalid({ reason: required })

  const correctsItemId = optionalUuid(input.correctsItemId)
  const correctsVariantId = optionalUuid(input.correctsVariantId)
  if (correctsItemId === undefined || correctsVariantId === undefined)
    return NOT_FOUND
  if (correctsVariantId && !correctsItemId) return BAD_REQUEST
  if (NEEDS_CORRECTS.includes(act) && !correctsItemId) return BAD_REQUEST
  if (act === "assign_unlabelled" && correctsItemId) return BAD_REQUEST
  if (
    act === "relink" &&
    correctsItemId === input.itemId &&
    (correctsVariantId ?? null) === (variantId ?? null)
  )
    return invalid({ itemId: "Choose a different item or option." })

  const basis = input.basis
  if (basis != null && basis !== "staff_label" && basis !== "reviewer")
    return BAD_REQUEST
  if (input.venueId != null && !isUuid(input.venueId))
    return invalid({ venueId: "Choose a venue." })

  return {
    ok: true,
    input: {
      requestId: input.requestId,
      action: act,
      assetId: input.assetId,
      itemId: input.itemId,
      variantId: variantId ?? null,
      ...(photoId ? { photoId } : {}),
      expectedRevision: input.expectedRevision,
      ...(reason ? { reason } : {}),
      ...(correctsItemId ? { correctsItemId } : {}),
      correctsVariantId: correctsVariantId ?? null,
      basis: (basis as DecideInput["basis"]) ?? null,
      ...(input.venueId ? { venueId: input.venueId as string } : {}),
    },
  }
}
