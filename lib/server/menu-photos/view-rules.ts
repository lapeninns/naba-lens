// Which views a decided photo is still in, from the decision alone. Pure, so
// the server (to skip needless page reads) and the Review card model share it.
// The database repeats every rule.

import type {
  DecisionAction,
  PhotoState,
  QueueStatus,
} from "@/lib/server/menu-photos/types"

/** The decided photo's state after `action`. */
export function stateAfter(action: DecisionAction): PhotoState | null {
  if (action === "ask_another") return "better_photo_requested"
  if (action === "withdraw") return null
  return "accepted"
}

/** The decisions that move a photo to another item (or give it one). */
export const MOVES: readonly DecisionAction[] = [
  "relink",
  "assign_stale",
  "assign_unlabelled",
]

/**
 * Whether the decided card, as shown, is still in a `status` view after
 * `action`, from the action alone: used only when the re-read could not say.
 * Undefined when the action does not settle it (the card then stays, so a
 * reviewer can still act on it; the database repeats every rule).
 */
export function staysInView(
  status: QueueStatus | undefined,
  action: DecisionAction
): boolean | undefined {
  // The card shown is for its old item (or none): its new item's card is
  // another card, so this one has left.
  if (MOVES.includes(action)) return false
  // A withdrawn photo leaves every view: it is in no decided set, and its
  // label no longer waits (the database drops a label withdrawn after it was
  // added).
  if (action === "withdraw") return false
  const state = stateAfter(action)
  switch (status) {
    case "accepted":
      return state === "accepted"
    case "needs_another_photo":
      return state === "better_photo_requested"
    case "pending":
    case "recheck":
    case "mine":
    case "stale_label":
    case "unlabelled":
      // Every decision settles a waiting photo.
      return false
    case "all":
      return true
    case undefined:
      return undefined
  }
}
