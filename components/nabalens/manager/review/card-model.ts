// Pure rules of a Review card: which decisions it offers, how a decision's
// fresh cards merge into the loaded list, and what is announced. Kept apart
// from the components so the matrix is tested directly. The database repeats
// every rule.

import type {
  DecisionAction,
  DecisionOutcome,
  QueueCard,
  StaffLabel,
} from "@/lib/server/menu-photos/types"

import type { ReviewScope } from "./links"
import { REVIEW_COPY } from "./review-copy"

/** A card in the list, plus the client-only "decided, left this view" flag. */
export type ListCard = QueueCard & {
  settled?: boolean
  /** The item a settled card was decided for (the picked one after a match). */
  settledItemName?: string
}

/** The buttons a card shows. `picker` actions open the item picker. */
export type CardAction =
  | "accept"
  | "accept_preferred"
  | "set_preferred"
  | "reaccept"
  | "relink"
  | "assign_stale"
  | "assign_unlabelled"
  | "also_assign"
  | "ask_another"
  | "withdraw"

export const PICKER_ACTIONS: readonly CardAction[] = [
  "relink",
  "assign_stale",
  "assign_unlabelled",
  "also_assign",
]

/** Offered under "More actions" rather than as a button of their own. */
export const MORE_ACTIONS: readonly CardAction[] = ["withdraw", "also_assign"]

/** The card carries a staff label for its item (not a reviewer match). */
function staffLabelled(card: QueueCard): boolean {
  if (!card.item) return false
  if (card.kind === "labelled") return true
  return card.kind === "decided" && card.basis === "staff_label"
}

/** Who is reviewing: a venue manager or an admin (the Review page's scope). */
export type ReviewScopeKind = ReviewScope["kind"]

/**
 * The caller's own photo, which a manager may not review. Admins may review
 * their own photos (the card still says "You").
 */
export function ownPhotoBlocked(
  card: QueueCard,
  scopeKind: ReviewScopeKind = "manager"
): boolean {
  return card.isSelf && scopeKind !== "admin"
}

/**
 * The decisions a card offers, in display order (§4.5 table). A manager's own
 * photos and decided cards that left the view offer none.
 */
export function availableActions(
  card: ListCard,
  scopeKind: ReviewScopeKind = "manager"
): CardAction[] {
  if (card.settled || ownPhotoBlocked(card, scopeKind)) return []
  if (card.kind === "stale") return ["assign_stale"]
  if (card.kind === "unlabelled") return ["assign_unlabelled"]
  if (!card.item) return []
  const labelled = staffLabelled(card)
  const variantGone = card.recheckKind === "variant_removed"
  const out: CardAction[] = []
  if (
    labelled &&
    (card.state === null || card.state === "better_photo_requested")
  ) {
    out.push("accept")
    if (card.item.covered) out.push("accept_preferred")
  }
  if (card.state === "accepted" && !card.isEffectivePrimary && card.photoId)
    out.push("set_preferred")
  if (card.state === "needs_recheck" && !variantGone) out.push("reaccept")
  if (labelled && card.state === null) out.push("relink")
  if (
    labelled &&
    card.basis !== "reviewer" &&
    (card.state === null || (card.state === "needs_recheck" && !variantGone))
  )
    out.push("ask_another")
  if (card.state !== null && card.photoId) out.push("withdraw")
  if (
    card.state === "accepted" &&
    card.basis === "reviewer" &&
    !card.correctsItemId &&
    card.staffLabels.length === 0
  )
    out.push("also_assign")
  return out
}

/** The staff label a stale card is matched from: its first one off the menu. */
export function staleLabelOf(card: QueueCard): StaffLabel | null {
  return card.staffLabels.find((l) => !l.onMenu) ?? card.staffLabels[0] ?? null
}

/** The decision action a card action sends. */
export function decisionFor(action: CardAction): DecisionAction {
  return action === "also_assign" ? "assign_unlabelled" : action
}

/** Counted in the Review badge: a staff-labelled photo waiting for the caller. */
export function inPendingSet(card: QueueCard): boolean {
  return (
    card.kind === "labelled" &&
    !card.isSelf &&
    (card.state === null || card.state === "needs_recheck")
  )
}

/** Badge change after a decision on `card` (every decision but "set" settles it). */
export function pendingDelta(card: QueueCard, action: DecisionAction): number {
  return inPendingSet(card) && action !== "set_preferred" ? -1 : 0
}

const sameCard = (a: QueueCard, b: QueueCard) => a.key === b.key

/** The decided card as it is now when it has left the current view. */
function settledCard(
  card: ListCard,
  action: DecisionAction,
  outcome: DecisionOutcome,
  targetName?: string
): ListCard {
  const state =
    action === "ask_another"
      ? "better_photo_requested"
      : action === "withdraw"
        ? null
        : "accepted"
  const primary =
    action === "set_preferred" ||
    action === "accept_preferred" ||
    (state === "accepted" &&
      outcome.preferredAssetId === card.asset.assetId &&
      card.item?.itemId === outcome.itemId)
  return {
    ...card,
    state,
    isPrimary: primary,
    isEffectivePrimary: primary,
    settled: true,
    settledItemName: targetName ?? card.item?.name,
  }
}

/**
 * The list after a decision on `decided`: the decision's item gets the fresh
 * cards in place (matched by key, or by photo for the decided card, whose key
 * changes once it has a decision). A decided card that left the view stays,
 * collapsed with its new state, until the next filter change, so the list
 * never jumps. Fresh cards new to the list go right after the decided card.
 * `keep` filters the fresh cards to the view (the fixed contributor);
 * `targetName` names the item the decision was for.
 */
export function mergeOutcome(
  list: ListCard[],
  decided: ListCard,
  action: DecisionAction,
  outcome: DecisionOutcome,
  keep: (card: QueueCard) => boolean = () => true,
  targetName?: string
): ListCard[] {
  const fresh = outcome.cards.filter(keep)
  const used = new Set<string>()
  const take = (card: ListCard): ListCard | null => {
    const byKey = fresh.find((f) => !used.has(f.key) && sameCard(f, card))
    if (byKey) {
      used.add(byKey.key)
      return byKey
    }
    if (card.key === decided.key) {
      const byAsset = fresh.find(
        (f) =>
          !used.has(f.key) &&
          f.asset.assetId === card.asset.assetId &&
          (f.item?.itemId ?? null) === outcome.itemId
      )
      if (byAsset) {
        used.add(byAsset.key)
        return byAsset
      }
    }
    return null
  }

  const next: ListCard[] = []
  let insertAt = -1
  for (const card of list) {
    const replaced = take(card)
    if (card.key === decided.key) {
      next.push(replaced ?? settledCard(card, action, outcome, targetName))
      insertAt = next.length
      continue
    }
    if (replaced) {
      next.push(replaced)
      continue
    }
    if (card.item && card.item.itemId === outcome.itemId && !card.settled) {
      // Beyond the fresh page: keep it, with the item's new revision.
      next.push({
        ...card,
        itemRevision: outcome.itemRevision,
        item: { ...card.item, covered: outcome.itemCovered },
      })
      continue
    }
    const source = outcome.correctsItem
    if (
      source &&
      card.item &&
      card.item.itemId === source.itemId &&
      !card.settled
    ) {
      // The corrected item's head moved too: its next decision needs it.
      next.push({ ...card, itemRevision: source.itemRevision })
      continue
    }
    next.push(card)
  }
  const added = fresh.filter((f) => !used.has(f.key))
  if (added.length > 0) {
    const at = insertAt < 0 ? next.length : insertAt
    next.splice(at, 0, ...added)
  }
  return next
}

/**
 * After a revision conflict: the item's latest cards replace the loaded ones.
 * A loaded card of the item missing from `current` is shown settled only when
 * `complete` (the server read every current card of the item); otherwise it
 * may sit beyond the re-read's first page, so it stays, at the item's new
 * revision when one came back.
 */
export function applyCurrent(
  list: ListCard[],
  itemId: string,
  current: QueueCard[],
  keep: (card: QueueCard) => boolean = () => true,
  complete = false
): ListCard[] {
  const head = current.find((c) => c.item?.itemId === itemId)?.itemRevision
  const fresh = current.filter(keep)
  const byKey = new Map(fresh.map((c) => [c.key, c]))
  const used = new Set<string>()
  const next: ListCard[] = []
  let firstOfItem = -1
  for (const card of list) {
    const hit = byKey.get(card.key)
    if (hit) {
      used.add(hit.key)
      if (firstOfItem < 0) firstOfItem = next.length
      next.push(hit)
      continue
    }
    if (card.item?.itemId === itemId && !card.settled) {
      if (firstOfItem < 0) firstOfItem = next.length
      if (complete) {
        // Gone from the item's current set: shown collapsed until the filter changes.
        next.push({ ...card, settled: true })
      } else {
        // Not in the partial re-read: unknown, so kept for its next decision.
        next.push(head === undefined ? card : { ...card, itemRevision: head })
      }
      continue
    }
    next.push(card)
  }
  const added = fresh.filter((c) => !used.has(c.key))
  if (added.length > 0)
    next.splice(firstOfItem < 0 ? next.length : firstOfItem, 0, ...added)
  return next
}

/** What the live region says after a decision. */
export function announcement(
  action: DecisionAction,
  card: QueueCard,
  targetName: string,
  outcome: DecisionOutcome
): string {
  const a = REVIEW_COPY.announce
  switch (action) {
    case "accept":
    case "reaccept":
      return a.accepted(targetName)
    case "accept_preferred":
      return a.acceptedPreferred(targetName)
    case "set_preferred":
      return a.preferred(targetName)
    case "ask_another":
      return a.asked(card.contributor.name, targetName)
    case "withdraw":
      if (!outcome.itemCovered) return a.withdrawnGap(targetName)
      return card.isEffectivePrimary
        ? a.withdrawnOther
        : a.withdrawnKept(targetName)
    case "relink":
    case "assign_stale":
    case "assign_unlabelled":
      return a.moved(targetName)
  }
}
