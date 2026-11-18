// My uploads on Me (spec §6 S4; FA-1, FA-7, FA-21; S2-STAFF). Pure and
// client-safe: parsing public.my_uploads (20261118111000_my_uploads.sql),
// the four sections, the outcome words staff see and which actions each
// upload offers. The database decides every action again.
//
// Sections (§6 S4), in Album's words:
//   attention  Needs attention: a retake asked for and not yet replaced,
//              processing that failed, or a photo with no slot (Match later)
//   sending    Uploading or processing (the server's view; the phone's own
//              queue is on the Add sheet)
//   waiting    Waiting for review
//   reviewed   Reviewed: every slot decided, or a shared photo with no slot

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
  removalRequested: boolean
  removalRequestId: string | null
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
 * The words staff see for each outcome (FA-7): the spec's Approved for public
 * use, Kept as reference, Another photo requested, Label corrected and Not
 * used, in Album's words. The chip keys are in status-chip.tsx.
 */
export const OUTCOME_WORDS: Record<UploadOutcome, string> = {
  awaiting_review: "Waiting",
  public: "In the album",
  reference: "Kept for reference",
  retake_requested: "Retake",
  not_used: "Not used",
  withdrawn: "Withdrawn",
  label_corrected: "Label corrected",
}

/** The StatusChip key that draws an outcome (status-chip.tsx). */
export const OUTCOME_CHIP: Record<UploadOutcome, string> = {
  awaiting_review: "outcome_waiting",
  public: "outcome_public",
  reference: "outcome_reference",
  retake_requested: "outcome_retake",
  not_used: "outcome_not_used",
  withdrawn: "outcome_withdrawn",
  label_corrected: "outcome_label_corrected",
}

const OUTCOMES = new Set<string>(Object.keys(OUTCOME_WORDS))
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

/** The ids of photos a newer photo of the same slot has replaced. */
export function replacedIds(items: ReadonlyArray<MyUpload>): Set<string> {
  return new Set(
    items.flatMap((item) =>
      item.slots.flatMap((s) => (s.replacesAssetId ? [s.replacesAssetId] : []))
    )
  )
}

/** A retake asked for on this photo that no newer photo has answered. */
export function openRetake(
  item: MyUpload,
  replaced: ReadonlySet<string>
): UploadSlot | null {
  if (replaced.has(item.assetId)) return null
  return item.slots.find((s) => s.outcome === "retake_requested") ?? null
}

/** Which section an upload sits in (spec §6 S4). */
export function uploadSection(
  item: MyUpload,
  replaced: ReadonlySet<string> = new Set()
): UploadSection {
  if (item.uploadState === "failed") return "attention"
  if (item.uploadState !== "ready") return "sending"
  if (openRetake(item, replaced)) return "attention"
  if (item.slots.some((s) => s.outcome === "awaiting_review")) return "waiting"
  // A photo with no slot and no shared kind waits under Match later.
  if (
    item.slots.length === 0 &&
    item.sharedKinds.length === 0 &&
    item.mediaType === "image"
  )
    return "attention"
  return "reviewed"
}

/** Uploads grouped by section, each newest first, with the counts. */
export function groupUploads(items: ReadonlyArray<MyUpload>) {
  const replaced = replacedIds(items)
  const groups: Record<UploadSection, MyUpload[]> = {
    attention: [],
    sending: [],
    waiting: [],
    reviewed: [],
  }
  for (const item of items) groups[uploadSection(item, replaced)].push(item)
  return { groups, replaced }
}

export type UploadActions = {
  /** Withdraw: nothing on it has been decided (FA-21). */
  withdraw: boolean
  /** Change slot: one dish or place slot, still waiting, and a photo. */
  changeSlot: boolean
  /** Retake: open the slot with the reviewer's reason. */
  retake: UploadSlot | null
  /** Ask for a correction: something on it has been decided (§23.6). */
  correction: boolean
  /** Ask to remove: it is accepted (public or reference) (FA-21). */
  removal: boolean
  /** Fix the date it was taken (S1-UPLOAD's set_media_captured_at). */
  fixDate: boolean
}

const DECIDED = new Set<UploadOutcome>([
  "public",
  "reference",
  "retake_requested",
  "not_used",
  "label_corrected",
])

/** What one upload offers, by its state (spec §6 S4). */
export function uploadActions(
  item: MyUpload,
  replaced: ReadonlySet<string> = new Set()
): UploadActions {
  const decided = item.slots.some((s) => DECIDED.has(s.outcome))
  const accepted = item.slots.some(
    (s) => s.outcome === "public" || s.outcome === "reference"
  )
  const ready = item.uploadState === "ready"
  return {
    withdraw: !decided && item.uploadState !== "uploading",
    changeSlot:
      ready &&
      item.mediaType === "image" &&
      !decided &&
      item.slots.length === 1 &&
      item.slots[0]!.outcome === "awaiting_review" &&
      item.slots[0]!.kind !== "amenity",
    retake: openRetake(item, replaced),
    correction: ready && decided,
    removal: ready && accepted && !item.removalRequested,
    fixDate: ready,
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
 * A datetime-local value ("2026-11-12T19:30") as an ISO instant in London
 * time, for set_media_captured_at; null when it is not a valid value.
 */
export function londonLocalToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number) as number[]
  const guess = Date.UTC(y!, mo! - 1, d!, h!, mi!)
  // London is UTC or UTC+1: try both offsets and keep the one that reads back.
  for (const offset of [0, 60]) {
    const at = new Date(guess - offset * 60_000)
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at)
    const get = (t: string) => parts.find((p) => p.type === t)?.value
    if (
      Number(get("year")) === y &&
      Number(get("month")) === mo &&
      Number(get("day")) === d &&
      Number(get("hour")) === h &&
      Number(get("minute")) === mi
    )
      return at.toISOString()
  }
  return null
}

/** An ISO instant as a datetime-local value in London time. */
export function isoToLondonLocal(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`
}
