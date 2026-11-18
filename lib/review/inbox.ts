// The manager review inbox (Full App v1 S2-REVIEW; spec §7 M2). Pure and
// client-safe: the photo detail's shape and parser, and the rules for batch
// decisions. The database (20261118110000_review_inbox.sql) repeats every
// rule; these only decide what the screen offers.

import type { QueueCard } from "@/lib/server/menu-photos/types"

export type ReviewLevel = "public" | "reference"

export type CapturedSource = "metadata" | "supplied" | "estimated" | "unknown"

/** A photo shown for comparison: a slot's public photo, a group or duplicate. */
export type ThumbRef = {
  assetId: string
  isPrimary?: boolean
  hasThumbnail?: boolean
  /** Possible duplicates: whether it has been accepted (a duplicate target). */
  accepted?: boolean
  uploadedAt?: string
}

/** A dish slot the photo is labelled for, or matched to by a reviewer. */
export type DetailDish = {
  itemId: string
  variantId: string | null
  itemName: string
  variantName: string | null
  sectionName: string | null
  sectionKind: "food" | "drinks" | null
  onMenu: boolean
  /** The staff label names this dish (not only a reviewer's match). */
  staffLabel: boolean
  /** The label waits for a decision the caller can make. */
  waiting: boolean
  photoId: string | null
  state: "accepted" | "better_photo_requested" | "needs_recheck" | null
  level: ReviewLevel | null
  basis: "staff_label" | "reviewer" | null
  isPrimary: boolean
  /** The item head the next decision is made against. */
  itemRevision: number
  /** S1-MENUS presentation revision (1 until a change is marked). */
  presentationRevision: number
  presentationNote: string | null
  neededBy: string | null
  publicPhotos: ThumbRef[]
}

export type SlotDecisionState =
  "pending" | "accepted" | "needs_another_photo" | "not_used" | "withdrawn"

export type DetailPlace = {
  labelId: string
  subjectId: string
  name: string
  state: SlotDecisionState
  level: ReviewLevel
  /** The decision the next one is made against; null before any. */
  decisionId: number | null
  /** This photo is the place's main photo now. */
  isPrimary: boolean
  publicPhotos: ThumbRef[]
}

export type DetailAmenity = {
  checkId: string
  question: string
  state: SlotDecisionState
  level: ReviewLevel
  photoRequired: boolean
  decisionId: number | null
  isPrimary: boolean
  publicPhotos: ThumbRef[]
}

export type Disposition = {
  id: number
  action: "not_used" | "duplicate" | "restored"
  reasonCode: string | null
  reason: string | null
  duplicateOfAssetId: string | null
  by: string | null
  at: string
}

export type HistoryEntry = {
  source: "dish" | "place" | "amenity" | "photo"
  action: string
  reason: string | null
  subject: string | null
  level: string | null
  by: string | null
  at: string
}

export type PhotoDetail = {
  assetId: string
  venueId: string
  mediaType: "image" | "video"
  width: number | null
  height: number | null
  sizeBytes: number | null
  uploadedAt: string
  capturedAt: string | null
  capturedAtSource: CapturedSource
  contributor: { id: string; name: string; active: boolean }
  isSelf: boolean
  /** A manager's own photo: another reviewer decides on it. */
  selfBlocked: boolean
  note: string | null
  contentTypes: string[]
  /** Needs label (FA-4): staff said food or drink but chose no dish. */
  needsLabel: boolean
  duplicateOfAssetId: string | null
  possibleDuplicates: ThumbRef[]
  /** The same person's photos from the same send. */
  group: ThumbRef[]
  disposition: Disposition | null
  dishes: DetailDish[]
  places: DetailPlace[]
  amenities: DetailAmenity[]
  history: HistoryEntry[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const level = (v: unknown): ReviewLevel =>
  v === "reference" ? "reference" : "public"

const SLOT_STATES: readonly SlotDecisionState[] = [
  "pending",
  "accepted",
  "needs_another_photo",
  "not_used",
  "withdrawn",
]
const slotState = (v: unknown): SlotDecisionState =>
  SLOT_STATES.includes(v as SlotDecisionState)
    ? (v as SlotDecisionState)
    : "pending"

function thumbs(v: unknown): ThumbRef[] {
  return arr(v).flatMap((t): ThumbRef[] => {
    if (!isObj(t) || !str(t.assetId)) return []
    return [
      {
        assetId: t.assetId as string,
        ...(typeof t.isPrimary === "boolean" ? { isPrimary: t.isPrimary } : {}),
        ...(typeof t.hasThumbnail === "boolean"
          ? { hasThumbnail: t.hasThumbnail }
          : {}),
        ...(typeof t.accepted === "boolean" ? { accepted: t.accepted } : {}),
        ...(str(t.uploadedAt) ? { uploadedAt: t.uploadedAt as string } : {}),
      },
    ]
  })
}

function dish(d: unknown): DetailDish[] {
  if (!isObj(d) || !str(d.itemId)) return []
  const state = d.state
  return [
    {
      itemId: d.itemId as string,
      variantId: str(d.variantId),
      itemName: str(d.itemName) ?? "",
      variantName: str(d.variantName),
      sectionName: str(d.sectionName),
      sectionKind:
        d.sectionKind === "food" || d.sectionKind === "drinks"
          ? d.sectionKind
          : null,
      onMenu: d.onMenu === true,
      staffLabel: d.staffLabel === true,
      waiting: d.waiting === true,
      photoId: str(d.photoId),
      state:
        state === "accepted" ||
        state === "better_photo_requested" ||
        state === "needs_recheck"
          ? state
          : null,
      level: d.level == null ? null : level(d.level),
      basis:
        d.basis === "staff_label" || d.basis === "reviewer" ? d.basis : null,
      isPrimary: d.isPrimary === true,
      itemRevision: num(d.itemRevision) ?? 1,
      presentationRevision: num(d.presentationRevision) ?? 1,
      presentationNote: str(d.presentationNote),
      neededBy: str(d.neededBy),
      publicPhotos: thumbs(d.publicPhotos),
    },
  ]
}

function disposition(v: unknown): Disposition | null {
  if (!isObj(v) || num(v.id) === null || !str(v.at)) return null
  const action = v.action
  if (action !== "not_used" && action !== "duplicate" && action !== "restored")
    return null
  return {
    id: v.id as number,
    action,
    reasonCode: str(v.reasonCode),
    reason: str(v.reason),
    duplicateOfAssetId: str(v.duplicateOfAssetId),
    by: str(v.by),
    at: v.at as string,
  }
}

/** The review_photo_detail reply; null when it is not the expected shape. */
export function parsePhotoDetail(data: unknown): PhotoDetail | null {
  if (!isObj(data) || !str(data.assetId) || !str(data.venueId)) return null
  const contributor = isObj(data.contributor) ? data.contributor : null
  if (!contributor || !str(contributor.id)) return null
  const source = data.capturedAtSource
  return {
    assetId: data.assetId as string,
    venueId: data.venueId as string,
    mediaType: data.mediaType === "video" ? "video" : "image",
    width: num(data.width),
    height: num(data.height),
    sizeBytes: num(data.sizeBytes),
    uploadedAt: str(data.uploadedAt) ?? "",
    capturedAt: str(data.capturedAt),
    capturedAtSource:
      source === "metadata" || source === "supplied" || source === "estimated"
        ? source
        : "unknown",
    contributor: {
      id: contributor.id as string,
      name: str(contributor.name) ?? "",
      active: contributor.active !== false,
    },
    isSelf: data.isSelf === true,
    selfBlocked: data.selfBlocked === true,
    note: str(typeof data.note === "string" ? data.note.trim() : null),
    contentTypes: arr(data.contentTypes).filter(
      (t): t is string => typeof t === "string"
    ),
    needsLabel: data.needsLabel === true,
    duplicateOfAssetId: str(data.duplicateOfAssetId),
    possibleDuplicates: thumbs(data.possibleDuplicates),
    group: thumbs(data.group),
    disposition: disposition(data.disposition),
    dishes: arr(data.dishes).flatMap(dish),
    places: arr(data.places).flatMap((p): DetailPlace[] =>
      isObj(p) && str(p.labelId) && str(p.subjectId)
        ? [
            {
              labelId: p.labelId as string,
              subjectId: p.subjectId as string,
              name: str(p.name) ?? "",
              state: slotState(p.state),
              level: level(p.level),
              decisionId: num(p.decisionId),
              isPrimary: p.isPrimary === true,
              publicPhotos: thumbs(p.publicPhotos),
            },
          ]
        : []
    ),
    amenities: arr(data.amenities).flatMap((a): DetailAmenity[] =>
      isObj(a) && str(a.checkId)
        ? [
            {
              checkId: a.checkId as string,
              question: str(a.question) ?? "",
              state: slotState(a.state),
              level: level(a.level),
              photoRequired: a.photoRequired !== false,
              decisionId: num(a.decisionId),
              isPrimary: a.isPrimary === true,
              publicPhotos: thumbs(a.publicPhotos),
            },
          ]
        : []
    ),
    history: arr(data.history).flatMap((h): HistoryEntry[] => {
      if (!isObj(h) || !str(h.action) || !str(h.at)) return []
      const s = h.source
      return [
        {
          source:
            s === "dish" || s === "place" || s === "amenity" ? s : "photo",
          action: h.action as string,
          reason: str(h.reason),
          subject: str(h.subject),
          level: str(h.level),
          by: str(h.by),
          at: h.at as string,
        },
      ]
    }),
  }
}

/** The photo is set aside now (Not used or Mark duplicate). */
export function isSetAside(detail: Pick<PhotoDetail, "disposition">): boolean {
  const a = detail.disposition?.action
  return a === "not_used" || a === "duplicate"
}

/** Whether a decided slot row still has a live decision to withdraw. */
export function hasLiveDecision(detail: PhotoDetail): boolean {
  return (
    detail.dishes.some((d) => d.state !== null) ||
    detail.places.some(
      (p) => p.state === "accepted" || p.state === "needs_another_photo"
    ) ||
    detail.amenities.some(
      (a) => a.state === "accepted" || a.state === "needs_another_photo"
    )
  )
}

/** The accepted photos a duplicate can be linked to. */
export function duplicateTargets(detail: PhotoDetail): ThumbRef[] {
  const seen = new Set<string>()
  const out: ThumbRef[] = []
  const add = (t: ThumbRef) => {
    if (t.assetId === detail.assetId || seen.has(t.assetId)) return
    seen.add(t.assetId)
    out.push(t)
  }
  for (const t of detail.possibleDuplicates) if (t.accepted) add(t)
  for (const d of detail.dishes) d.publicPhotos.forEach(add)
  for (const p of detail.places) p.publicPhotos.forEach(add)
  for (const a of detail.amenities) a.publicPhotos.forEach(add)
  return out
}

// ---- Batch decisions ------------------------------------------------------------

export type BatchAction = "public" | "reference" | "not_used"

/** One photo a batch decides, as the screen saw it. */
export type BatchItem = {
  key: string
  assetId: string
  itemId: string | null
  variantId: string | null
  itemRevision: number
  /**
   * The photo's latest disposition the screen saw (null before any): a batch
   * Not used is made against it (S3-R1 V16), so a restored photo can be set
   * aside again and a newer decision still conflicts.
   */
  dispositionId?: number | null
}

/**
 * Whether a list card can join a batch for `action`: a waiting staff label
 * for its dish (Approve for public use, Keep as reference) or any waiting
 * photo, including Needs label (Not used). Never the caller's own photo,
 * except at their single-reviewer venue (FA-9, S3-R1 K6).
 */
export function batchable(card: QueueCard, action: BatchAction): boolean {
  if (card.isSelf && !card.selfReviewAllowed) return false
  if (action === "not_used")
    return (
      (card.kind === "labelled" && card.state === null) ||
      card.kind === "unlabelled" ||
      card.kind === "stale"
    )
  return card.kind === "labelled" && card.state === null && card.item !== null
}

/** The batch row of a card. */
export function batchItemOf(card: QueueCard): BatchItem {
  return {
    key: card.key,
    assetId: card.asset.assetId,
    itemId: card.item?.itemId ?? null,
    variantId: card.item?.variantId ?? null,
    itemRevision: card.itemRevision,
    dispositionId: card.dispositionId ?? null,
  }
}

/**
 * The revision each batch decision is made against. Photos of the same dish
 * are decided in turn: the second is made against the revision the first
 * left, but only while that first decision started from the revision the
 * screen saw. A change by someone else in between still conflicts.
 */
export class RevisionChain {
  private moved = new Map<string, { from: number; to: number }>()

  expected(item: BatchItem): number {
    if (!item.itemId) return item.itemRevision
    const m = this.moved.get(item.itemId)
    return m && m.from === item.itemRevision ? m.to : item.itemRevision
  }

  record(item: BatchItem, newRevision: number) {
    if (!item.itemId) return
    const prior = this.moved.get(item.itemId)
    this.moved.set(item.itemId, {
      from: prior?.from ?? item.itemRevision,
      to: newRevision,
    })
  }
}

export type BatchOutcome = {
  key: string
  assetId: string
  ok: boolean
  /** Plain words when it failed. */
  error?: string
  /** Someone else decided first: the person reviews it again. */
  conflict?: boolean
}

/** "3 decided · 1 needs another look". */
export function batchSummary(outcomes: readonly BatchOutcome[]) {
  const done = outcomes.filter((o) => o.ok).length
  return { done, failed: outcomes.length - done }
}
