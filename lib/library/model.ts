/*
 * The admin Library (spec §8 A4, §11; S2-LIBRARY). Shapes of the database's
 * JSON (20261118116000_library.sql), their parsers, the extra filter params
 * and the words screens show. No server code, so client screens import it.
 */

import { chipState, type ChipStateKey } from "@/components/nabalens/status-chip"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID.test(v)

// ---------------------------------------------------------------------------
// Extra filters (beyond the existing venue/staff/type/label filters)
// ---------------------------------------------------------------------------

export const WITHDRAWN_FILTERS = ["active", "withdrawn", "all"] as const
export type WithdrawnFilter = (typeof WITHDRAWN_FILTERS)[number]

export const REVIEW_STATES = [
  "public",
  "reference",
  "unreviewed",
  "not_used",
] as const
export type ReviewState = (typeof REVIEW_STATES)[number]

export const ORIENTATIONS = ["landscape", "portrait", "square"] as const
export type Orientation = (typeof ORIENTATIONS)[number]

/** The A4 filters as the server reads them. Null = that filter is off. */
export type LibraryExtraFilters = {
  /** Withdrawn records are left out unless asked for. */
  withdrawn: WithdrawnFilter
  review: ReviewState | null
  capturedFrom: string | null
  capturedTo: string | null
  orientation: Orientation | null
  requestId: string | null
  collectionId: string | null
  destinationId: string | null
  tagId: string | null
}

export const NO_EXTRA_FILTERS: LibraryExtraFilters = {
  withdrawn: "active",
  review: null,
  capturedFrom: null,
  capturedTo: null,
  orientation: null,
  requestId: null,
  collectionId: null,
  destinationId: null,
  tagId: null,
}

/** URL params of the A4 filters, in canonical order. */
export const EXTRA_PARAMS = [
  "use",
  "review",
  "shot_from",
  "shot_to",
  "orientation",
  "request",
  "collection",
  "destination",
  "tag",
] as const
export type ExtraParam = (typeof EXTRA_PARAMS)[number]
export type ExtraSearchParams = Partial<Record<ExtraParam, string>>

const DAY = /^\d{4}-\d{2}-\d{2}$/
function realDay(value: unknown): string | null {
  if (typeof value !== "string" || !DAY.test(value)) return null
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  return y! >= 1970 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m! - 1 &&
    date.getUTCDate() === d
    ? value
    : null
}

const pick = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v)
    ? (v as T)
    : null

/**
 * Untrusted URL params -> the A4 filters. Never throws: an invalid value turns
 * its filter off; a repeated param uses its first value; a `shot_from` after
 * `shot_to` is swapped.
 */
export function parseExtraFilters(
  input: Partial<Record<ExtraParam, unknown>>
): LibraryExtraFilters {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v)
  const uuid = (v: unknown) => (isUuid(one(v)) ? (one(v) as string) : null)
  let from = realDay(one(input.shot_from))
  let to = realDay(one(input.shot_to))
  if (from && to && from > to) [from, to] = [to, from]
  return {
    withdrawn: pick(WITHDRAWN_FILTERS, one(input.use)) ?? "active",
    review: pick(REVIEW_STATES, one(input.review)),
    capturedFrom: from,
    capturedTo: to,
    orientation: pick(ORIENTATIONS, one(input.orientation)),
    requestId: uuid(input.request),
    collectionId: uuid(input.collection),
    destinationId: uuid(input.destination),
    tagId: uuid(input.tag),
  }
}

/** Filters -> URL params (only those in use), in canonical order. */
export function extraFiltersToParams(
  f: LibraryExtraFilters
): ExtraSearchParams {
  const out: ExtraSearchParams = {}
  if (f.withdrawn !== "active") out.use = f.withdrawn
  if (f.review) out.review = f.review
  if (f.capturedFrom) out.shot_from = f.capturedFrom
  if (f.capturedTo) out.shot_to = f.capturedTo
  if (f.orientation) out.orientation = f.orientation
  if (f.requestId) out.request = f.requestId
  if (f.collectionId) out.collection = f.collectionId
  if (f.destinationId) out.destination = f.destinationId
  if (f.tagId) out.tag = f.tagId
  return out
}

export const hasExtraFilters = (f: LibraryExtraFilters) =>
  Object.keys(extraFiltersToParams(f)).length > 0

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * The chip for an asset's review state (manager/admin wording, FA-7). Its
 * word lives in status-chip.tsx; REVIEW_WORDS reads it for filter options.
 */
export const REVIEW_CHIP: Record<ReviewState, ChipStateKey> = {
  public: "review_public",
  reference: "review_reference",
  unreviewed: "review_unreviewed",
  not_used: "review_not_used",
}

export const REVIEW_WORDS = Object.fromEntries(
  REVIEW_STATES.map((s) => [s, chipState(REVIEW_CHIP[s]).word])
) as Record<ReviewState, string>

export const WITHDRAWN_WORDS: Record<WithdrawnFilter, string> = {
  active: "In use",
  withdrawn: "Withdrawn",
  all: "In use and withdrawn",
}

export const ORIENTATION_WORDS: Record<Orientation, string> = {
  landscape: "Landscape",
  portrait: "Portrait",
  square: "Square",
}

/**
 * The chip for an asset_usages state (S1-COV) in admin words; the words live
 * in status-chip.tsx (one source, S3-R14).
 */
export const USAGE_CHIP: Record<string, ChipStateKey> = {
  public: "review_public",
  reference: "review_reference",
  awaiting_review: "waiting_for_review",
  retake_requested: "coverage_replacement_needed",
  not_used: "review_not_used",
  withdrawn: "outcome_withdrawn",
}

/** The word for a usage state (an unknown state is humanised, never blank). */
export const usageWord = (state: string) =>
  chipState(USAGE_CHIP[state] ?? state).word

export const SLOT_KIND_WORDS: Record<string, string> = {
  dish: "Dish",
  area: "Place",
  amenity: "Facility",
  request: "Request",
}

export const CAPTURE_SOURCE_WORDS: Record<string, string> = {
  metadata: "from the file",
  supplied: "entered by a person",
  estimated: "estimated",
  unknown: "unknown",
}

export const HISTORY_WORDS: Record<string, string> = {
  withdrawn: "Withdrawn from use",
  restored: "Restored",
  removal_requested: "Removal requested",
  removal_cancelled: "Removal request cancelled",
  removal_declined: "Removal declined",
  removal_removed: "Permanently removed",
  removal_withdrawn: "Withdrawn by uploader",
  tag_added: "Tag added",
  tag_removed: "Tag removed",
}

export const EVIDENCE_WORDS: Record<string, string> = {
  amenity_fact: "Facility fact",
  amenity_answer: "Facility answer",
  fact: "Venue fact",
}

/** Orientation of a width × height, or null when either is unknown. */
export function orientationOf(
  width: number | null,
  height: number | null
): Orientation | null {
  if (!width || !height) return null
  return width > height ? "landscape" : height > width ? "portrait" : "square"
}

// ---------------------------------------------------------------------------
// Shapes and parsers
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null
const bool = (v: unknown) => v === true
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export type LibraryTag = {
  id: string
  name: string
  active: boolean
  revision: number
  assetCount: number
}

export function parseTags(data: unknown): LibraryTag[] | null {
  if (!Array.isArray(data)) return null
  return data.flatMap((t) =>
    isObj(t) && isUuid(t.id) && str(t.name)
      ? [
          {
            id: t.id,
            name: t.name as string,
            active: bool(t.active),
            revision: num(t.revision) ?? 1,
            assetCount: num(t.assetCount) ?? 0,
          },
        ]
      : []
  )
}

export type LibraryCollection = {
  id: string
  name: string
  purpose: string | null
  archivedAt: string | null
  revision: number
  updatedAt: string | null
  assetCount: number
  venues: { venueId: string; venueName: string; count: number }[]
}

export function parseCollections(data: unknown): LibraryCollection[] | null {
  if (!Array.isArray(data)) return null
  return data.flatMap((c) =>
    isObj(c) && isUuid(c.id) && str(c.name)
      ? [
          {
            id: c.id,
            name: c.name as string,
            purpose: str(c.purpose),
            archivedAt: str(c.archivedAt),
            revision: num(c.revision) ?? 1,
            updatedAt: str(c.updatedAt),
            assetCount: num(c.assetCount) ?? 0,
            venues: arr(c.venues).flatMap((v) =>
              isObj(v) && isUuid(v.venueId)
                ? [
                    {
                      venueId: v.venueId,
                      venueName: str(v.venueName) ?? "Unknown venue",
                      count: num(v.count) ?? 0,
                    },
                  ]
                : []
            ),
          },
        ]
      : []
  )
}

export type FilterListOption = {
  id: string
  name: string
  venueName: string | null
}

export type LibraryFilterLists = {
  requests: FilterListOption[]
  destinations: FilterListOption[]
}

export function parseFilterLists(data: unknown): LibraryFilterLists | null {
  if (!isObj(data)) return null
  const list = (v: unknown) =>
    arr(v).flatMap((o) =>
      isObj(o) && isUuid(o.id) && str(o.name)
        ? [
            {
              id: o.id,
              name: o.name as string,
              venueName: str(o.venueName),
            },
          ]
        : []
    )
  return {
    requests: list(data.requests),
    destinations: list(data.destinations),
  }
}

export type AssetSlot = {
  kind: "dish" | "area" | "amenity"
  slotId: string
  name: string
  variantName: string | null
  state: string
  decidedAt: string | null
  isPrimary: boolean
  /** Dish only: the photo row and item revision Select primary needs. */
  photoId: string | null
  itemRevision: number | null
}

export type AssetDecision = {
  kind: string
  slotName: string
  action: string
  to: string | null
  reason: string | null
  at: string
  byName: string | null
  selfReview: boolean
}

export type AssetRendition = {
  kind: string
  objectKey: string
  mimeType: string
  width: number | null
  height: number | null
  pipelineVersion: string
  createdAt: string
  approval: ReviewState | null
}

export type AssetDuplicate = {
  assetId: string
  venueName: string
  uploaderName: string
  createdAt: string
  relation: "same_file" | "original" | "marked_duplicate"
}

export type AssetExports = {
  publication: unknown
  packages: {
    packageId: string
    mode: string
    profile: string | null
    createdAt: string
    invalidatedAt: string | null
    exportedAt: string | null
  }[]
}

export type AssetDetail = {
  asset: {
    id: string
    venueId: string
    venueName: string
    uploaderId: string
    uploaderName: string
    uploaderActive: boolean
    uploaderRole: string | null
    mediaType: "image" | "video"
    mimeType: string | null
    originalFilename: string
    sizeBytes: number | null
    width: number | null
    height: number | null
    durationSeconds: number | null
    uploadState: string
    createdAt: string
    capturedAt: string | null
    capturedAtSource: string
    contentSha256: string | null
    duplicateOfAssetId: string | null
    deletedAt: string | null
    timezone: string
  }
  review: ReviewState | null
  useState: string | null
  exportEligible: boolean
  withdrawal: {
    withdrawnAt: string
    reason: string
    byName: string | null
  } | null
  renditions: AssetRendition[]
  labels: {
    note: string | null
    contentTypes: string[]
    items: {
      itemId: string
      itemName: string
      variantName: string | null
      sectionName: string | null
    }[]
    places: { subjectId: string; label: string; removedAt: string | null }[]
  }
  labelHistory: { action: string; at: string; byName: string | null }[]
  decisions: AssetDecision[]
  slots: AssetSlot[]
  evidence: { kind: string; name: string }[]
  exports: AssetExports | null
  tags: { id: string; name: string; active: boolean }[]
  collections: { id: string; name: string; archivedAt: string | null }[]
  duplicates: AssetDuplicate[]
  history: {
    action: string
    reason: string | null
    at: string
    byName: string | null
  }[]
  removalRequests: {
    requestId: string
    reason: string
    state: string
    createdAt: string
    requesterName: string | null
  }[]
  corrections: {
    id: number
    declaredVenueName: string | null
    correctedVenueId: string
    correctedVenueName: string | null
    reason: string
    at: string
    byName: string | null
  }[]
}

const SLOT_KINDS = ["dish", "area", "amenity"] as const

/** library_asset_detail JSON -> AssetDetail, or null when malformed. */
export function parseAssetDetail(data: unknown): AssetDetail | null {
  if (!isObj(data) || !isObj(data.asset)) return null
  const a = data.asset
  if (!isUuid(a.id) || !isUuid(a.venueId) || !isUuid(a.uploaderId)) return null
  const labels = isObj(data.labels) ? data.labels : {}
  const exportsData = isObj(data.exports) ? data.exports : null
  const withdrawal = isObj(data.withdrawal) ? data.withdrawal : null
  return {
    asset: {
      id: a.id,
      venueId: a.venueId,
      venueName: str(a.venueName) ?? "Unknown venue",
      uploaderId: a.uploaderId,
      uploaderName: str(a.uploaderName) ?? "Unknown",
      uploaderActive: bool(a.uploaderActive),
      uploaderRole: str(a.uploaderRole),
      mediaType: a.mediaType === "video" ? "video" : "image",
      mimeType: str(a.mimeType),
      originalFilename: str(a.originalFilename) ?? "",
      sizeBytes: num(a.sizeBytes),
      width: num(a.width),
      height: num(a.height),
      durationSeconds: num(a.durationSeconds),
      uploadState: str(a.uploadState) ?? "unknown",
      createdAt: str(a.createdAt) ?? "",
      capturedAt: str(a.capturedAt),
      capturedAtSource: str(a.capturedAtSource) ?? "unknown",
      contentSha256: str(a.contentSha256),
      duplicateOfAssetId: isUuid(a.duplicateOfAssetId)
        ? a.duplicateOfAssetId
        : null,
      deletedAt: str(a.deletedAt),
      timezone: str(a.timezone) ?? "Europe/London",
    },
    review: pick(REVIEW_STATES, data.review),
    useState: str(data.useState),
    exportEligible: bool(data.exportEligible),
    withdrawal:
      withdrawal && str(withdrawal.withdrawnAt)
        ? {
            withdrawnAt: withdrawal.withdrawnAt as string,
            reason: str(withdrawal.reason) ?? "",
            byName: str(withdrawal.byName),
          }
        : null,
    renditions: arr(data.renditions).flatMap((r) =>
      isObj(r) && str(r.kind) && str(r.objectKey)
        ? [
            {
              kind: r.kind as string,
              objectKey: r.objectKey as string,
              mimeType: str(r.mimeType) ?? "",
              width: num(r.width),
              height: num(r.height),
              pipelineVersion: str(r.pipelineVersion) ?? "",
              createdAt: str(r.createdAt) ?? "",
              approval: pick(REVIEW_STATES, r.approval),
            },
          ]
        : []
    ),
    labels: {
      note: str(labels.note),
      contentTypes: arr(labels.contentTypes).flatMap((c) =>
        typeof c === "string" ? [c] : []
      ),
      items: arr(labels.items).flatMap((i) =>
        isObj(i) && isUuid(i.itemId)
          ? [
              {
                itemId: i.itemId,
                itemName: str(i.itemName) ?? "",
                variantName: str(i.variantName),
                sectionName: str(i.sectionName),
              },
            ]
          : []
      ),
      places: arr(labels.places).flatMap((p) =>
        isObj(p) && isUuid(p.subjectId)
          ? [
              {
                subjectId: p.subjectId,
                label: str(p.label) ?? "",
                removedAt: str(p.removedAt),
              },
            ]
          : []
      ),
    },
    labelHistory: arr(data.labelHistory).flatMap((e) =>
      isObj(e) && str(e.action)
        ? [
            {
              action: e.action as string,
              at: str(e.at) ?? "",
              byName: str(e.byName),
            },
          ]
        : []
    ),
    decisions: arr(data.decisions).flatMap((d) =>
      isObj(d) && str(d.action)
        ? [
            {
              kind: str(d.kind) ?? "",
              slotName: str(d.slotName) ?? "",
              action: d.action as string,
              to: str(d.to),
              reason: str(d.reason),
              at: str(d.at) ?? "",
              byName: str(d.byName),
              selfReview: bool(d.selfReview),
            },
          ]
        : []
    ),
    slots: arr(data.slots).flatMap((s) => {
      const kind = isObj(s) ? pick(SLOT_KINDS, s.kind) : null
      if (!isObj(s) || !kind || !isUuid(s.slotId)) return []
      return [
        {
          kind,
          slotId: s.slotId,
          name: str(s.name) ?? "",
          variantName: str(s.variantName),
          state: str(s.state) ?? "",
          decidedAt: str(s.decidedAt),
          isPrimary: bool(s.isPrimary),
          photoId: isUuid(s.photoId) ? s.photoId : null,
          itemRevision: num(s.itemRevision),
        },
      ]
    }),
    evidence: arr(data.evidence).flatMap((e) =>
      isObj(e) && str(e.kind)
        ? [{ kind: e.kind as string, name: str(e.name) ?? "" }]
        : []
    ),
    exports: exportsData
      ? {
          publication: exportsData.publication ?? null,
          packages: arr(exportsData.packages).flatMap((p) =>
            isObj(p) && isUuid(p.packageId)
              ? [
                  {
                    packageId: p.packageId,
                    mode: str(p.mode) ?? "public",
                    profile: str(p.profile),
                    createdAt: str(p.createdAt) ?? "",
                    invalidatedAt: str(p.invalidatedAt),
                    exportedAt: str(p.exportedAt),
                  },
                ]
              : []
          ),
        }
      : null,
    tags: arr(data.tags).flatMap((t) =>
      isObj(t) && isUuid(t.id)
        ? [{ id: t.id, name: str(t.name) ?? "", active: bool(t.active) }]
        : []
    ),
    collections: arr(data.collections).flatMap((c) =>
      isObj(c) && isUuid(c.id)
        ? [
            {
              id: c.id,
              name: str(c.name) ?? "",
              archivedAt: str(c.archivedAt),
            },
          ]
        : []
    ),
    duplicates: arr(data.duplicates).flatMap((d) =>
      isObj(d) && isUuid(d.assetId)
        ? [
            {
              assetId: d.assetId,
              venueName: str(d.venueName) ?? "Unknown venue",
              uploaderName: str(d.uploaderName) ?? "Unknown",
              createdAt: str(d.createdAt) ?? "",
              relation:
                pick(["original", "marked_duplicate"] as const, d.relation) ??
                "same_file",
            },
          ]
        : []
    ),
    history: arr(data.history).flatMap((h) =>
      isObj(h) && str(h.action)
        ? [
            {
              action: h.action as string,
              reason: str(h.reason),
              at: str(h.at) ?? "",
              byName: str(h.byName),
            },
          ]
        : []
    ),
    removalRequests: arr(data.removalRequests).flatMap((r) =>
      isObj(r) && isUuid(r.requestId)
        ? [
            {
              requestId: r.requestId,
              reason: str(r.reason) ?? "",
              state: str(r.state) ?? "open",
              createdAt: str(r.createdAt) ?? "",
              requesterName: str(r.requesterName),
            },
          ]
        : []
    ),
    corrections: arr(data.corrections).flatMap((c) =>
      isObj(c) && isUuid(c.correctedVenueId)
        ? [
            {
              id: num(c.id) ?? 0,
              declaredVenueName: str(c.declaredVenueName),
              correctedVenueId: c.correctedVenueId,
              correctedVenueName: str(c.correctedVenueName),
              reason: str(c.reason) ?? "",
              at: str(c.at) ?? "",
              byName: str(c.byName),
            },
          ]
        : []
    ),
  }
}

/** The slot's primary can be chosen here: a public-approved image, not withdrawn. */
export function canSelectPrimary(detail: AssetDetail, slot: AssetSlot) {
  return (
    !slot.isPrimary &&
    slot.state === "public" &&
    detail.asset.mediaType === "image" &&
    detail.asset.deletedAt === null &&
    detail.withdrawal === null &&
    (slot.kind !== "dish" ||
      (slot.photoId !== null && slot.itemRevision !== null))
  )
}
