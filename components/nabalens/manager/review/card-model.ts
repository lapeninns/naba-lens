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
import {
  MOVES,
  stateAfter,
  staysInView,
} from "@/lib/server/menu-photos/view-rules"

export { staysInView }

/** A card in the list, plus the client-only "decided, left this view" flag. */
export type ListCard = QueueCard & {
  settled?: boolean
  /** The item a settled card was decided for (the picked one after a match). */
  settledItemName?: string
  /**
   * Whether this accepted card is the item's menu photo is not known (a
   * decision or conflict re-read could not say): "Set as menu photo" is held
   * back until fresh data arrives, as the card may already be it.
   */
  primaryUnknown?: boolean
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
  if (
    card.state === "accepted" &&
    !card.isEffectivePrimary &&
    !card.primaryUnknown &&
    card.photoId
  )
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

/** An item's menu photo as the server last said: its effective primary photo. */
type ItemPrimary = {
  /** The effective primary photo (flagged, else the earliest accepted); null when none. */
  photoId: string | null
  /** The effective primary is flagged (not the earliest-accepted fallback). */
  flagged: boolean
  covered: boolean
}

/**
 * A loaded card of the item that the fresh cards did not replace: its menu
 * photo flags and coverage brought in line with `primary`. With `primary`
 * unknown the flags stay as loaded, but an accepted card is marked
 * `primaryUnknown` so it offers no "Set as menu photo" it may not need.
 */
function reconcileItem(
  card: ListCard,
  primary: ItemPrimary | null,
  over: Partial<QueueCard>
): ListCard {
  if (!card.item) return { ...card, ...over }
  if (!primary) {
    return {
      ...card,
      ...over,
      primaryUnknown: card.state === "accepted" ? true : card.primaryUnknown,
    }
  }
  const effective =
    card.state === "accepted" &&
    card.photoId !== null &&
    card.photoId === primary.photoId
  // Only one photo of an item is flagged. A flagged effective primary means no
  // other card is; with the fallback showing, a non-accepted card may still
  // carry a flag (it does not count while it is not accepted).
  const isPrimary = effective
    ? primary.flagged
    : !primary.flagged && card.state !== "accepted" && card.isPrimary
  return {
    ...card,
    ...over,
    item: { ...card.item, covered: primary.covered },
    isPrimary,
    isEffectivePrimary: effective,
    primaryUnknown: false,
  }
}

/**
 * "Also assign": an accepted card matched to one more item. Its own row (for
 * its item) is unchanged; the new item's card is another card.
 */
function alsoAssigned(
  card: QueueCard,
  action: DecisionAction,
  outcome: DecisionOutcome
): boolean {
  return (
    action === "assign_unlabelled" &&
    card.item !== null &&
    card.item.itemId !== outcome.itemId
  )
}

/** The decided card with the decision's state, flags guessed from the action. */
function projected(
  card: ListCard,
  action: DecisionAction,
  outcome: DecisionOutcome
): ListCard {
  const state = stateAfter(action)
  const primary =
    action === "set_preferred" ||
    action === "accept_preferred" ||
    (state === "accepted" &&
      outcome.preferredAssetId === card.asset.assetId &&
      card.item?.itemId === outcome.itemId)
  return { ...card, state, isPrimary: primary, isEffectivePrimary: primary }
}

/** The decided card as it is now when it has left the current view. */
function settledCard(
  card: ListCard,
  action: DecisionAction,
  outcome: DecisionOutcome,
  targetName?: string
): ListCard {
  return {
    ...projected(card, action, outcome),
    settled: true,
    settledItemName: targetName ?? card.item?.name,
  }
}

/**
 * The decided card when the fresh cards hold no row for it. Its absence means
 * it left the view only when the server read every page (`decidedKnown`);
 * otherwise the action decides, and a card it does not settle stays
 * actionable with its new state and the item's new head.
 */
function decidedWithoutRow(
  card: ListCard,
  action: DecisionAction,
  outcome: DecisionOutcome,
  primary: ItemPrimary | null,
  groupCount: number | undefined,
  targetName?: string
): ListCard {
  if (alsoAssigned(card, action, outcome)) return card
  if (
    outcome.decidedKnown === true ||
    staysInView(outcome.status, action) === false
  )
    return settledCard(card, action, outcome, targetName)
  return reconcileItem(projected(card, action, outcome), primary, {
    itemRevision: outcome.itemRevision,
    ...(groupCount === undefined ? {} : { groupCount }),
  })
}

/**
 * The list after a decision on `decided`: the decision's item gets the fresh
 * cards in place (matched by key, or by photo for the decided card, whose key
 * changes once it has a decision). A decided card that left the view stays,
 * collapsed with its new state, until the next filter change, so the list
 * never jumps. Fresh cards new to the list go right after the decided card.
 *
 * Absence from the fresh cards never settles a card on its own: the server
 * returns the decided photo's row wherever it sits, and says when it looked
 * everywhere (`decidedKnown`). The item's other loaded cards are never
 * settled here (a decision on one photo moves no other photo out of a view);
 * missing from the fresh cards, they keep their place with the item's new
 * head.
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
  const primary: ItemPrimary | null =
    outcome.preferredPhotoId === undefined
      ? null
      : {
          photoId: outcome.preferredPhotoId,
          flagged:
            outcome.preferredPhotoId !== null && !outcome.preferredIsFallback,
          covered: outcome.itemCovered,
        }
  // Every card of the item in the status set carries the same count.
  const groupCount = outcome.cards.find(
    (c) => c.item?.itemId === outcome.itemId
  )?.groupCount
  const used = new Set<string>()
  // A fresh row keyed as another loaded card is that card's row, never the
  // decided card's (one photo may have a card per variant of the item).
  const others = new Set(
    list.filter((c) => c.key !== decided.key).map((c) => c.key)
  )
  const sameVariant = (f: QueueCard, card: QueueCard) =>
    MOVES.includes(action) ||
    (f.item?.variantId ?? null) === (card.item?.variantId ?? null)
  const take = (card: ListCard): ListCard | null => {
    const byKey = fresh.find((f) => !used.has(f.key) && sameCard(f, card))
    if (byKey) {
      used.add(byKey.key)
      return byKey
    }
    if (card.key === decided.key && !alsoAssigned(card, action, outcome)) {
      const byAsset = fresh.find(
        (f) =>
          !used.has(f.key) &&
          !others.has(f.key) &&
          f.asset.assetId === card.asset.assetId &&
          (f.item?.itemId ?? null) === outcome.itemId &&
          sameVariant(f, card)
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
      next.push(
        replaced ??
          decidedWithoutRow(
            card,
            action,
            outcome,
            primary,
            groupCount,
            targetName
          )
      )
      insertAt = next.length
      continue
    }
    if (replaced) {
      next.push(replaced)
      continue
    }
    if (card.item && card.item.itemId === outcome.itemId && !card.settled) {
      // Beyond the fresh page: keep it, with the item's new revision, menu
      // photo, coverage and group count (another card may now be preferred).
      next.push(
        reconcileItem(card, primary, {
          itemRevision: outcome.itemRevision,
          ...(groupCount === undefined ? {} : { groupCount }),
        })
      )
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
 *
 * `decided` is the card whose decision conflicted. The server looks for its
 * row past the first page, so it is matched by key or by photo (its key
 * changes once someone else decided it), and settled when missing only if
 * the server read every page (`known`) for the card's own item: a relink's
 * re-read is of the target item and says nothing of the card.
 */
export function applyCurrent(
  list: ListCard[],
  itemId: string,
  current: QueueCard[],
  keep: (card: QueueCard) => boolean = () => true,
  complete = false,
  decided?: { key: string; known: boolean }
): ListCard[] {
  const headCard = current.find((c) => c.item?.itemId === itemId)
  // The menu photo, when the re-read shows it: its card is in `current`, or
  // the item is not covered (so there is none). Otherwise it may sit beyond
  // the page, and loaded accepted cards are held as unknown.
  const effectiveCard = current.find(
    (c) => c.item?.itemId === itemId && c.isEffectivePrimary
  )
  const covered = headCard?.item?.covered ?? false
  const primary: ItemPrimary | null = effectiveCard
    ? {
        photoId: effectiveCard.photoId,
        flagged: effectiveCard.isPrimary,
        covered: true,
      }
    : headCard && !covered
      ? { photoId: null, flagged: false, covered: false }
      : null
  const fresh = current.filter(keep)
  const byKey = new Map(fresh.map((c) => [c.key, c]))
  const used = new Set<string>()
  const others = new Set(
    list.filter((c) => c.key !== decided?.key).map((c) => c.key)
  )
  const next: ListCard[] = []
  let firstOfItem = -1
  for (const card of list) {
    // The conflicting card's own row, when the re-read is of its item (or of
    // its photo, on the stale and unlabelled views).
    const ownRead =
      decided?.key === card.key &&
      !card.settled &&
      (card.item === null || card.item.itemId === itemId)
    const hit =
      byKey.get(card.key) ??
      (ownRead
        ? fresh.find(
            (c) =>
              !used.has(c.key) &&
              !others.has(c.key) &&
              c.asset.assetId === card.asset.assetId &&
              (c.item?.itemId ?? null) === (card.item?.itemId ?? null) &&
              (c.item?.variantId ?? null) === (card.item?.variantId ?? null)
          )
        : undefined)
    if (hit && !used.has(hit.key)) {
      used.add(hit.key)
      if (firstOfItem < 0) firstOfItem = next.length
      next.push(hit)
      continue
    }
    if (ownRead && decided?.known) {
      // Read everywhere and not there: someone else decided it.
      if (firstOfItem < 0) firstOfItem = next.length
      next.push({ ...card, settled: true })
      continue
    }
    if (card.item?.itemId === itemId && !card.settled) {
      if (firstOfItem < 0) firstOfItem = next.length
      if (complete) {
        // Gone from the item's current set: shown collapsed until the filter changes.
        next.push({ ...card, settled: true })
      } else {
        // Not in the partial re-read: unknown, so kept for its next decision,
        // with what the re-read says of the item.
        next.push(
          headCard === undefined
            ? card
            : reconcileItem(card, primary, {
                itemRevision: headCard.itemRevision,
                groupCount: headCard.groupCount,
                ...(primary || !card.item
                  ? {}
                  : { item: { ...card.item, covered } }),
              })
        )
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

/** Consecutive cards of one contribution set (B02-05), or one card alone. */
export type SetRun<T> = { groupId: string | null; cards: T[] }

/**
 * Adjacent cards in the same set make one run; the order never changes, so
 * a set split by another photo shows as two runs. A run of one is a card.
 */
export function setRuns<T>(
  cards: readonly T[],
  groupOf: (card: T) => string | null
): SetRun<T>[] {
  const runs: SetRun<T>[] = []
  for (const card of cards) {
    const groupId = groupOf(card)
    const last = runs[runs.length - 1]
    if (groupId && last?.groupId === groupId) last.cards.push(card)
    else runs.push({ groupId, cards: [card] })
  }
  return runs.map((run) =>
    run.cards.length > 1 ? run : { groupId: null, cards: run.cards }
  )
}
