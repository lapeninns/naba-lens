// My uploads on Me (spec §6 S4; FA-1, FA-7, FA-21; S2-STAFF). Pure and
// client-safe: parsing public.my_uploads (20261118111000_my_uploads.sql),
// the four sections, the outcome words staff see and which actions each
// upload offers. The database decides every action again.
//
// Sections (§6 S4), in Album's words:
//   attention  Needs attention: a retake asked for and not yet answered by a
//              photo sent after it was asked (E8), processing that failed, or
//              a photo with no slot (Match later, or "I'm not sure": with the
//              manager, who chooses its slot; E4)
//   sending    Uploading or processing (the server's view; the phone's own
//              queue is on the Add sheet)
//   waiting    Waiting for review
//   reviewed   Reviewed: every slot decided, or a shared photo with no slot

import type { ChipStateKey } from "@/components/nabalens/status-chip"
import { RECEIPT_WORDS } from "@/lib/upload/states"

export type UploadOutcome =
  | "awaiting_review"
  | "public"
  | "reference"
  | "retake_requested"
  | "not_used"
  | "withdrawn"
  | "label_corrected"

export type UploadSlot = {
  kind: "dish" | "area" | "amenity"
  slotId: string
  name: string
  outcome: UploadOutcome
  /** The reviewer's exact reason, for a retake (or a withdrawn dish photo). */
  reason: string | null
  decidedAt: string | null
  /** The caller's own earlier photo of this slot that was asked to be retaken. */
  replacesAssetId: string | null
  /**
   * A retake asked on this photo that the person answered with another photo
   * of the slot sent after it was asked (my_uploads, E8). Read across all
   * their photos, so it does not depend on which page is loaded.
   */
  retakeAnswered: boolean
}

export type MyUpload = {
  assetId: string
  venueId: string
  venueName: string
  mediaType: "image" | "video"
  uploadState: "uploading" | "processing" | "ready" | "failed"
  uploadedAt: string
  capturedAt: string | null
  capturedAtSource: "metadata" | "supplied" | "estimated" | "unknown"
  duplicate: boolean
  labelRevision: number
  /** Shared-photo kinds chosen with Not for a slot ("team", "venue"…). */
  sharedKinds: string[]
  slots: UploadSlot[]
  /** "I'm not sure" was asked and it still has no label: the manager labels it. */
  labelHelp: boolean
  removalRequested: boolean
  removalRequestId: string | null
  /** Private staff Album status, independent of the manager's marketing decision. */
  albumPost?: {
    removed: boolean
    needs_attention: boolean
    labelled: boolean
    labels?: ReadonlyArray<{ kind: "dish" | "area"; id: string; name: string }>
    managerLabelled?: boolean
  }
}

export type MyUploadsPage = {
  items: MyUpload[]
  next: { before: string; beforeId: string } | null
}

export type VenueManager = {
  id: string
  displayName: string
  jobTitle: string | null
  isYou: boolean
}

export type MonthReplacements = { covered: number; replaced: number }

export type UploadSection = "attention" | "sending" | "waiting" | "reviewed"

export const UPLOAD_SECTIONS: ReadonlyArray<{
  key: UploadSection
  label: string
  empty: string
}> = [
  {
    key: "attention",
    label: "Needs attention",
    empty: "Nothing needs you right now.",
  },
  {
    key: "sending",
    label: "Sending",
    empty: "Nothing is sending. Photos still on this phone are on Add photos.",
  },
  {
    key: "waiting",
    label: "Waiting",
    empty: "Nothing is waiting for a manager.",
  },
  {
    key: "reviewed",
    label: "Reviewed",
    empty: "Nothing has been checked yet.",
  },
]

/**
 * The StatusChip key that draws each outcome (FA-7). The words staff see
 * (In the album, Kept for reference, Retake, Label corrected, Not used…) live
 * only in status-chip.tsx (V25): render `<StatusChip state={OUTCOME_CHIP[o]} />`
 * with no children.
 */
export const OUTCOME_CHIP: Record<UploadOutcome, ChipStateKey> = {
  awaiting_review: "outcome_waiting",
  public: "outcome_public",
  reference: "outcome_reference",
  retake_requested: "outcome_retake",
  not_used: "outcome_not_used",
  withdrawn: "outcome_withdrawn",
  label_corrected: "outcome_label_corrected",
}

/**
 * A dish decision Me shows as "Accepted for menu use" (X9): accepted for
 * public use only. A photo kept as reference is the outcome Kept for
 * reference, and coverage never counts it.
 */
export function isMenuUse(decision: {
  state: string
  reviewLevel: "public" | "reference"
}): boolean {
  return decision.state === "accepted" && decision.reviewLevel === "public"
}

const OUTCOMES = new Set<string>(Object.keys(OUTCOME_CHIP))
const STATES = new Set(["uploading", "processing", "ready", "failed"])
const SOURCES = new Set(["metadata", "supplied", "estimated", "unknown"])
const KINDS = new Set(["dish", "area", "amenity"])

const str = (v: unknown) => (typeof v === "string" ? v : null)

function parseSlot(raw: unknown): UploadSlot | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const slotId = str(r.slotId)
  const name = str(r.name)
  if (!slotId || !name || !KINDS.has(r.kind as string)) return null
  if (!OUTCOMES.has(r.outcome as string)) return null
  return {
    kind: r.kind as UploadSlot["kind"],
    slotId,
    name,
    outcome: r.outcome as UploadOutcome,
    reason: str(r.reason),
    decidedAt: str(r.decidedAt),
    replacesAssetId: str(r.replacesAssetId),
    retakeAnswered: r.retakeAnswered === true,
  }
}

function parseUpload(raw: unknown): MyUpload | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const assetId = str(r.assetId)
  const venueId = str(r.venueId)
  const uploadedAt = str(r.uploadedAt)
  if (!assetId || !venueId || !uploadedAt) return null
  if (!STATES.has(r.uploadState as string)) return null
  return {
    assetId,
    venueId,
    venueName: str(r.venueName) ?? "",
    mediaType: r.mediaType === "video" ? "video" : "image",
    uploadState: r.uploadState as MyUpload["uploadState"],
    uploadedAt,
    capturedAt: str(r.capturedAt),
    capturedAtSource: SOURCES.has(r.capturedAtSource as string)
      ? (r.capturedAtSource as MyUpload["capturedAtSource"])
      : "unknown",
    duplicate: r.duplicate === true,
    labelRevision:
      typeof r.labelRevision === "number" && Number.isInteger(r.labelRevision)
        ? r.labelRevision
        : 0,
    sharedKinds: Array.isArray(r.sharedKinds)
      ? r.sharedKinds.filter((k): k is string => typeof k === "string")
      : [],
    slots: Array.isArray(r.slots)
      ? r.slots.flatMap((s) => {
          const slot = parseSlot(s)
          return slot ? [slot] : []
        })
      : [],
    labelHelp: r.labelHelp === true,
    removalRequested: r.removalRequested === true,
    removalRequestId: str(r.removalRequestId),
  }
}

/** public.my_uploads as a page; null when it is not that read at all. */
export function parseMyUploads(data: unknown): MyUploadsPage | null {
  const root = data as Record<string, unknown> | null
  if (!root || !Array.isArray(root.items)) return null
  const next = root.next as Record<string, unknown> | null | undefined
  return {
    items: root.items.flatMap((row) => {
      const upload = parseUpload(row)
      return upload ? [upload] : []
    }),
    next:
      next && str(next.before) && str(next.beforeId)
        ? { before: next.before as string, beforeId: next.beforeId as string }
        : null,
  }
}

export function parseVenueManagers(data: unknown): VenueManager[] | null {
  const items = (data as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) return null
  return items.flatMap((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>
    const id = str(r.id)
    const displayName = str(r.displayName)
    return id && displayName
      ? [
          {
            id,
            displayName,
            jobTitle: str(r.jobTitle),
            isYou: r.isYou === true,
          },
        ]
      : []
  })
}

/**
 * A retake asked for on this photo that the person has not answered with a
 * photo sent after it was asked (E8: a newer photo from the same batch, sent
 * before the retake was asked, does not answer it).
 */
export function openRetake(item: MyUpload): UploadSlot | null {
  return (
    item.slots.find(
      (s) => s.outcome === "retake_requested" && !s.retakeAnswered
    ) ?? null
  )
}

/** A photo with no slot and no shared kind: Match later or I'm not sure. */
export function unmatched(item: MyUpload): boolean {
  return (
    item.uploadState === "ready" &&
    item.mediaType === "image" &&
    item.slots.length === 0 &&
    item.sharedKinds.length === 0
  )
}

/** An unlabelled photo the owner can still match at their current venue. */
export function canLabelUpload(item: MyUpload, currentVenueId: string | null) {
  if (item.venueId !== currentVenueId) return false
  return item.albumPost
    ? !item.albumPost.removed && !item.albumPost.labelled
    : unmatched(item) && !item.labelHelp
}

export const LABEL_PHOTO = "Label photo"
export const MATCH_LATER_HREF = "/staff/album/match-later"

export const photoHref = (assetId: string) => `/staff/photos/${assetId}`

export const labelPhotoHref = (assetId: string) =>
  `${MATCH_LATER_HREF}?${new URLSearchParams({ photo: assetId })}`

/** Which section an upload sits in (spec §6 S4). */
export function uploadSection(item: MyUpload): UploadSection {
  if (item.uploadState === "failed") return "attention"
  if (item.uploadState !== "ready") return "sending"
  if (openRetake(item)) return "attention"
  if (item.slots.some((s) => s.outcome === "awaiting_review")) return "waiting"
  // No slot yet: under Match later, or with the manager after "I'm not
  // sure" (E4). Either way it needs attention until it has a slot.
  if (unmatched(item)) return "attention"
  return "reviewed"
}

/** Uploads grouped by section, each newest first, with the counts. */
export function groupUploads(items: ReadonlyArray<MyUpload>) {
  const groups: Record<UploadSection, MyUpload[]> = {
    attention: [],
    sending: [],
    waiting: [],
    reviewed: [],
  }
  for (const item of items) groups[uploadSection(item)].push(item)
  return { groups }
}

export type UploadActions = {
  /** Withdraw: nothing on it has been decided (FA-21). */
  withdraw: boolean
  /**
   * Change slot: one dish or place slot, still waiting, a photo, and sent to
   * the current venue (V13: the slots offered are that venue's).
   */
  changeSlot: boolean
  /** Retake: open the slot with the reviewer's reason. */
  retake: UploadSlot | null
  /** Ask for a correction: something on it has been decided (§23.6). */
  correction: boolean
  /** Ask to remove: it is accepted (public, reference or relabelled) (FA-21). */
  removal: boolean
}

const DECIDED = new Set<UploadOutcome>([
  "public",
  "reference",
  "retake_requested",
  "not_used",
  "label_corrected",
])

/** Accepted outcomes: the photo is kept, so only an admin removes it. */
const ACCEPTED = new Set<UploadOutcome>([
  "public",
  "reference",
  "label_corrected",
])

/**
 * What one upload offers, by its state (spec §6 S4). `currentVenueId` is the
 * person's active venue: Change slot lists that venue's slots, so it is
 * offered only for a photo sent there (V13).
 */
export function uploadActions(
  item: MyUpload,
  currentVenueId: string | null = null
): UploadActions {
  const decided = item.slots.some((s) => DECIDED.has(s.outcome))
  const accepted = item.slots.some((s) => ACCEPTED.has(s.outcome))
  const ready = item.uploadState === "ready"
  return {
    withdraw: !decided && item.uploadState !== "uploading",
    changeSlot:
      ready &&
      item.mediaType === "image" &&
      !decided &&
      (currentVenueId === null || item.venueId === currentVenueId) &&
      item.slots.length === 1 &&
      item.slots[0]!.outcome === "awaiting_review" &&
      item.slots[0]!.kind !== "amenity",
    retake: openRetake(item),
    correction: ready && decided,
    removal: ready && accepted && !item.removalRequested,
  }
}

/** Where a retake (or any slot) opens: its slot page with the reason. */
export function slotPageHref(slot: Pick<UploadSlot, "kind" | "slotId">) {
  if (slot.kind === "amenity") return `/staff/tasks/amenities/${slot.slotId}`
  return `/staff/album/slot/${slot.kind}/${slot.slotId}`
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/London",
})
const DAY_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
})

/** "12 Nov", or "12 Nov 2025" outside the current year. */
export function shortDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.getUTCFullYear() === now.getUTCFullYear()
    ? DAY.format(date)
    : DAY_YEAR.format(date)
}

/** The dates line: when it was sent, and when it was taken or Unknown. */
export function datesLine(item: MyUpload, now: Date = new Date()): string {
  const sent = `Sent ${shortDay(item.uploadedAt, now)}`
  const taken = item.capturedAt
    ? `taken ${shortDay(item.capturedAt, now)}`
    : "date taken unknown"
  return `${sent} · ${taken}`
}

/**
 * The server's side of an unfinished upload in the receipt words (S1-UPLOAD,
 * lib/upload/states.ts; DESIGN.md §4): Sending, Checking or Couldn't finish.
 * Null once it is ready (its slots then say what happened).
 */
export function receiptWord(
  item: Pick<MyUpload, "uploadState">
): string | null {
  switch (item.uploadState) {
    case "uploading":
      return RECEIPT_WORDS.uploading
    case "processing":
      return RECEIPT_WORDS.uploaded_processing
    case "failed":
      return RECEIPT_WORDS.processing_failed
    default:
      return null
  }
}
