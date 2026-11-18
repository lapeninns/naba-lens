/*
 * Review in a thumb (DESIGN.md §6.5, principle 7): the pure half. It turns
 * the two review queues the app already reads (menu photos and G-9 area
 * photos) into one line of photos for the stage, and builds each decision
 * with the existing actions' inputs. No new rules: the menu card model says
 * which decisions a card offers, and the database repeats every rule,
 * including that nobody reviews their own photo.
 */

import { availableActions } from "@/components/nabalens/manager/review/card-model"
import type { DecisionPayload } from "@/components/nabalens/manager/review/use-decision"
import { dishName } from "@/lib/menus/dish-name"
import type { AreaPhotoCard } from "@/lib/server/area-photos"
import type { QueueCard } from "@/lib/server/menu-photos/types"

/** The decision Accept sends for a dish photo: a new photo, or one to recheck. */
export type MenuAccept = "accept" | "reaccept"

export type MenuSubject = {
  kind: "dish"
  assetId: string
  itemId: string
  variantId: string | null
  itemRevision: number
  /** Null when the card offers no accept (the full list handles it). */
  accept: MenuAccept | null
  askAgain: boolean
  basis: QueueCard["basis"]
  correctsItemId: string | null
  correctsVariantId: string | null
}

export type AreaSubject = { kind: "area"; labelId: string }

/** One photo on the stage. */
export type ReviewPhoto = {
  /** Unique across both queues: "dish:<card key>" or "area:<label id>". */
  key: string
  /** The slot it fills: "Soup (Large)", "Beer garden". */
  name: string
  /** One line on what the photo must show (DESIGN.md §5 Brief); null when there is none yet. */
  brief: string | null
  author: string
  /** When it was added, ISO. */
  addedAt: string
  /** The album place it belongs to; null when its section is not placed yet. */
  place: string | null
  /** The largest image the scoped routes give, else the thumbnail. */
  imageUrl: string | null
  /** The reviewer's own photo: shown to nobody as a decision (§6.5). */
  own: boolean
  subject: MenuSubject | AreaSubject
}

/**
 * Where each menu section sits in the album, and each item's brief. Built by
 * the server from the album placements and the menu; both maps may be empty.
 */
export type ReviewContext = {
  /** Menu section id to album place label. */
  sectionPlace: ReadonlyMap<string, string>
  /** Menu section id to the section's brief (AL-4). */
  sectionBrief: ReadonlyMap<string, string>
  /**
   * Menu item id to the dish's own brief (AL-4). A dish without one takes its
   * section's; never the guest-facing menu description (§2 principle 4).
   */
  itemBrief: ReadonlyMap<string, string>
}

const EMPTY_CONTEXT: ReviewContext = {
  sectionPlace: new Map(),
  sectionBrief: new Map(),
  itemBrief: new Map(),
}

const clean = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim()
  return text ? text : null
}

/** A waiting menu photo as a stage photo; null when it has no dish. */
export function fromMenuCard(
  card: QueueCard,
  context: ReviewContext = EMPTY_CONTEXT
): ReviewPhoto | null {
  const item = card.item
  if (!item) return null
  const label = card.staffLabels.find(
    (l) => l.itemId === item.itemId && l.variantId === item.variantId
  )
  const actions = availableActions(card, "manager")
  const accept: MenuAccept | null = actions.includes("accept")
    ? "accept"
    : actions.includes("reaccept")
      ? "reaccept"
      : null
  return {
    key: `dish:${card.key}`,
    name: dishName(item, label?.unspecified === true),
    brief:
      clean(context.itemBrief.get(item.itemId)) ??
      clean(context.sectionBrief.get(item.sectionId)),
    author: card.contributor.name,
    addedAt: card.labelledAt ?? card.uploadedAt,
    place: context.sectionPlace.get(item.sectionId) ?? null,
    imageUrl: card.asset.previewUrl ?? card.asset.thumbnailUrl,
    own: card.isSelf,
    subject: {
      kind: "dish",
      assetId: card.asset.assetId,
      itemId: item.itemId,
      variantId: item.variantId,
      itemRevision: card.itemRevision,
      accept,
      askAgain: actions.includes("ask_another"),
      basis: card.basis,
      correctsItemId: card.correctsItemId,
      correctsVariantId: card.correctsVariantId,
    },
  }
}

/**
 * A waiting area photo as a stage photo. The area is its own place, and
 * areas have no brief (AL-4). A photo the caller may not decide on while it
 * waits is their own: the queue says so with `canDecide`.
 */
export function fromAreaCard(card: AreaPhotoCard): ReviewPhoto {
  return {
    key: `area:${card.labelId}`,
    name: card.area,
    brief: null,
    author: card.authorName,
    addedAt: card.labelledAt || card.uploadedAt,
    place: card.area,
    imageUrl: card.previewUrl ?? card.thumbnailUrl,
    own: !card.canDecide,
    subject: { kind: "area", labelId: card.labelId },
  }
}

/** Whether the stage can decide on the photo (Accept or Ask again). */
export function decidable(photo: ReviewPhoto): boolean {
  if (photo.own) return false
  return photo.subject.kind === "area" || photo.subject.accept !== null
}

/**
 * The photos the stage shows, longest waiting first: both queues merged, own
 * photos and cards only the full list can decide (a stale label, a match)
 * left out, each photo once.
 */
export function reviewLine(photos: readonly ReviewPhoto[]): ReviewPhoto[] {
  const seen = new Set<string>()
  return photos
    .filter((p) => {
      if (!decidable(p) || seen.has(p.key)) return false
      seen.add(p.key)
      return true
    })
    .map((p, index) => ({ p, index }))
    .sort((a, b) => {
      const at = Date.parse(a.p.addedAt) || 0
      const bt = Date.parse(b.p.addedAt) || 0
      return at - bt || a.index - b.index
    })
    .map(({ p }) => p)
}

// ---- Ask again ---------------------------------------------------------------

/**
 * The reusable retake reasons (spec §7 M2, §9.1), in Album's plain words
 * (DESIGN.md §5 Reason chips), each with the spec's code. A wrong label is
 * not a photo-quality reason: it is fixed with Fix label, never a retake.
 */
export const RETAKE_REASONS = [
  { code: "whole_item_not_visible", words: "Show all of it" },
  { code: "insufficient_light", words: "Too dark" },
  { code: "out_of_focus", words: "Out of focus" },
  { code: "wrong_presentation", words: "Not how it's served now" },
  { code: "route_not_shown", words: "Show the way in" },
  { code: "background_issue", words: "Messy background" },
  { code: "people_visible", words: "People or personal details in shot" },
] as const

export type RetakeReasonCode = (typeof RETAKE_REASONS)[number]["code"]

/** The reason chips, in order (DESIGN.md §5 Reason chips). */
export const REASONS = RETAKE_REASONS.map((r) => r.words)

export type Reason = (typeof RETAKE_REASONS)[number]["words"]

/** The spec code of a chip's words; null for a written reason. */
export function retakeReasonCode(words: string): RetakeReasonCode | null {
  return RETAKE_REASONS.find((r) => r.words === words)?.code ?? null
}

/** The most a written reason may hold (the decision actions' limit). */
export const REASON_MAX = 500

/** The reason sent for "Other": the person's words, trimmed; null when empty. */
export function otherReason(text: string): string | null {
  const value = text.replace(/\s+/g, " ").trim()
  return value ? value.slice(0, REASON_MAX) : null
}

// ---- decisions ---------------------------------------------------------------

/**
 * The menu decision a stage choice sends, in the exact shape the Review list
 * sends it (components/nabalens/manager/review/review-list.tsx `run`).
 */
export function menuDecision(
  subject: MenuSubject,
  choice: { kind: "accept" } | { kind: "ask"; reason: string }
): DecisionPayload | null {
  const action =
    choice.kind === "accept"
      ? subject.accept
      : subject.askAgain
        ? "ask_another"
        : null
  if (!action) return null
  const payload: DecisionPayload = {
    action,
    assetId: subject.assetId,
    itemId: subject.itemId,
    variantId: subject.variantId,
    expectedRevision: subject.itemRevision,
    ...(choice.kind === "ask" ? { reason: choice.reason } : {}),
  }
  if (action === "reaccept") {
    payload.basis = subject.basis
    if (subject.basis === "reviewer" && subject.correctsItemId) {
      payload.correctsItemId = subject.correctsItemId
      payload.correctsVariantId = subject.correctsVariantId
    }
  }
  return payload
}

/**
 * After a decision on one dish, the item's revision moved: every other
 * photo of that dish still on the stage needs it for its own decision.
 */
export function withRevision(
  photos: readonly ReviewPhoto[],
  itemId: string,
  itemRevision: number
): ReviewPhoto[] {
  return photos.map((p) =>
    p.subject.kind === "dish" && p.subject.itemId === itemId
      ? { ...p, subject: { ...p.subject, itemRevision } }
      : p
  )
}

/** The fresh revision for a photo from a conflict's current cards, if it is still waiting. */
export function conflictRevision(
  subject: MenuSubject,
  current: readonly QueueCard[] | undefined
): number | null {
  const card = current?.find(
    (c) =>
      c.asset.assetId === subject.assetId && c.item?.itemId === subject.itemId
  )
  return card ? card.itemRevision : null
}
