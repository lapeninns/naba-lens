// S1-EXPORT: the export and publication DTOs, parsers and pure helpers
// (spec §14.1, §14.2, §10, §8 A5). No server imports, so client components
// may `import type` from here and use the constants and pure functions.
// Database reads are jsonb (20261118105200_export_publication_api.sql); every
// parser drops a malformed row rather than trusting it.

export const EXPORT_MODES = ["public", "internal"] as const
export type ExportMode = (typeof EXPORT_MODES)[number]

export const EXPORT_PROFILE_KEYS = [
  "original",
  "website",
  "social",
  "custom",
] as const
export type ExportProfileKey = (typeof EXPORT_PROFILE_KEYS)[number]

export type ExportFormat = "original" | "webp" | "jpeg"

export type ExportProfile = {
  key: ExportProfileKey
  label: string
  format: ExportFormat
  maxWidth: number | null
  maxHeight: number | null
  quality: number | null
  revision: number
}

/** The spec's categories (FA-6). */
export type ExportCategory =
  "food" | "drinks" | "spaces" | "facilities" | "other"
export type SubjectKind = "menu_item" | "place" | "amenity"
export type ApprovalLevel = "public" | "internal"

/**
 * Publication states (spec §10). Release 1 records the manual ones; Queued
 * and Update pending belong to integrated destinations (FA-40, Release 2).
 */
export const PUBLICATION_STATES = [
  "not_selected",
  "exported",
  "queued",
  "published_confirmed",
  "update_pending",
  "withdrawal_pending",
  "withdrawn_confirmed",
  "failed_unknown",
] as const
export type PublicationState = (typeof PUBLICATION_STATES)[number]

/**
 * Admin and manager words (FA-7, A5-words-conflict: staff screens never show
 * these). "Exported" never claims the file is on a website (§10 inv. 9).
 */
export const PUBLICATION_WORDS: Record<PublicationState, string> = {
  not_selected: "Not exported",
  exported: "Exported",
  queued: "Queued",
  published_confirmed: "Published",
  update_pending: "Update pending",
  withdrawal_pending: "Withdrawal pending",
  withdrawn_confirmed: "Withdrawn",
  failed_unknown: "Failed or unknown",
}

export type PublicationDestinationState = {
  destinationId: string
  label: string
  state: PublicationState
  externalUrl: string | null
  externalRef: string | null
  occurredOn: string | null
}

export type AssetPublication = {
  state: PublicationState
  exportedAt: string | null
  destinations: PublicationDestinationState[]
}

export type ExportCandidate = {
  assetId: string
  subjectKind: SubjectKind
  subjectId: string
  subjectLabel: string
  category: ExportCategory
  approvalLevel: ApprovalLevel
  approvalId: string
  approvalVersion: string
  uploadedAt: string
  width: number | null
  height: number | null
  publication: AssetPublication
}

export type ExportCandidates = {
  venueId: string
  venueName: string
  mode: ExportMode
  items: ExportCandidate[]
}

export type PackageState =
  "ready" | "exported" | "needs_rebuild" | "invalidated"

export type ExportPackageSummary = {
  id: string
  venueId: string | null
  venueName: string | null
  mode: ExportMode
  profile: ExportProfile
  note: string | null
  itemCount: number
  createdAt: string
  createdBy: string | null
  rebuiltFrom: string | null
  state: PackageState
  staleAssets: string[]
  invalidatedAt: string | null
  invalidatedReason: "item_withdrawn" | "rebuilt" | null
  lastExportedAt: string | null
}

export type ExportPackageItem = {
  position: number
  assetId: string
  venueId: string
  subjectKind: SubjectKind
  subjectId: string
  subjectLabel: string
  category: ExportCategory
  approvalLevel: ApprovalLevel
  approvalId: string
  approvalVersion: string
  filenameStem: string
  altText: string | null
  caption: string | null
  useRestrictions: string[]
  uploadedAt: string
  eligible: boolean
  publication: AssetPublication
}

export type ExportDownloadRow = {
  id: string
  downloadedBy: string | null
  startedAt: string
  completedAt: string | null
  failedAt: string | null
  fileCount: number | null
}

export type ExportPackageDetail = ExportPackageSummary & {
  items: ExportPackageItem[]
  downloads: ExportDownloadRow[]
}

export type PublicationDestination = {
  id: string
  venueId: string | null
  venueName: string | null
  label: string
  url: string | null
  active: boolean
  revision: number
  published: number
  pending: number
  failed: number
  lastPublishedOn: string | null
}

export type PublicationOutstanding = {
  destinationId: string
  destinationLabel: string
  assetId: string
  venueId: string
  venueName: string | null
  subjectLabel: string
  state: "withdrawal_pending" | "failed_unknown"
  requested: boolean
  externalUrl: string | null
  externalRef: string | null
  since: string
}

export type PublicationPublished = {
  destinationId: string
  destinationLabel: string
  assetId: string
  venueId: string
  venueName: string | null
  subjectLabel: string
  externalUrl: string | null
  externalRef: string | null
  occurredOn: string
}

export type PublicationAction =
  "published" | "withdrawal_requested" | "withdrawn" | "failed"

export type PublicationRecent = {
  id: number
  destinationLabel: string
  assetId: string
  subjectLabel: string
  action: PublicationAction
  occurredOn: string
  recordedAt: string
  recordedBy: string | null
  externalUrl: string | null
  externalRef: string | null
  note: string | null
}

export type PublicationOverview = {
  canRecord: boolean
  destinations: PublicationDestination[]
  outstanding: PublicationOutstanding[]
  published: PublicationPublished[]
  recent: PublicationRecent[]
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) ? v : null
const list = (v: unknown, key: string): unknown[] => {
  const value = obj(v)?.[key]
  return Array.isArray(value) ? value : []
}
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null =>
  typeof v === "string" && (values as readonly string[]).includes(v)
    ? (v as T)
    : null
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []

const CATEGORIES = [
  "food",
  "drinks",
  "spaces",
  "facilities",
  "other",
] as const satisfies readonly ExportCategory[]
const SUBJECT_KINDS = [
  "menu_item",
  "place",
  "amenity",
] as const satisfies readonly SubjectKind[]
const LEVELS = [
  "public",
  "internal",
] as const satisfies readonly ApprovalLevel[]

export function parseProfile(v: unknown): ExportProfile | null {
  const o = obj(v)
  const key = oneOf(o?.key, EXPORT_PROFILE_KEYS)
  const label = str(o?.label)
  const format = oneOf(o?.format, ["original", "webp", "jpeg"] as const)
  if (!o || !key || !label || !format) return null
  return {
    key,
    label,
    format,
    maxWidth: int(o.maxWidth),
    maxHeight: int(o.maxHeight),
    quality: int(o.quality),
    revision: int(o.revision) ?? 1,
  }
}

export function parseProfiles(data: unknown): ExportProfile[] {
  return list(data, "items").flatMap((row) => {
    const p = parseProfile(row)
    return p ? [p] : []
  })
}

export function parsePublication(v: unknown): AssetPublication {
  const o = obj(v)
  return {
    state: oneOf(o?.state, PUBLICATION_STATES) ?? "not_selected",
    exportedAt: str(o?.exportedAt),
    destinations: list(o, "destinations").flatMap((row) => {
      const d = obj(row)
      const destinationId = str(d?.destinationId)
      const label = str(d?.label)
      const state = oneOf(d?.state, PUBLICATION_STATES)
      if (!d || !destinationId || !label || !state) return []
      return [
        {
          destinationId,
          label,
          state,
          externalUrl: str(d.externalUrl),
          externalRef: str(d.externalRef),
          occurredOn: str(d.occurredOn),
        },
      ]
    }),
  }
}

function parseItemBase(o: Obj) {
  const assetId = str(o.assetId)
  const subjectKind = oneOf(o.subjectKind, SUBJECT_KINDS)
  const subjectId = str(o.subjectId)
  const subjectLabel = str(o.subjectLabel)
  const category = oneOf(o.category, CATEGORIES)
  const approvalLevel = oneOf(o.approvalLevel, LEVELS)
  const approvalId = str(o.approvalId)
  const approvalVersion = str(o.approvalVersion)
  const uploadedAt = str(o.uploadedAt)
  if (
    !assetId ||
    !subjectKind ||
    !subjectId ||
    !subjectLabel ||
    !category ||
    !approvalLevel ||
    !approvalId ||
    !approvalVersion ||
    !uploadedAt
  )
    return null
  return {
    assetId,
    subjectKind,
    subjectId,
    subjectLabel,
    category,
    approvalLevel,
    approvalId,
    approvalVersion,
    uploadedAt,
    publication: parsePublication(o.publication),
  }
}

export function parseCandidates(data: unknown): ExportCandidates | null {
  const o = obj(data)
  const venueId = str(o?.venueId)
  const venueName = str(o?.venueName)
  const mode = oneOf(o?.mode, EXPORT_MODES)
  if (!o || !venueId || !venueName || !mode) return null
  return {
    venueId,
    venueName,
    mode,
    items: list(o, "items").flatMap((row) => {
      const r = obj(row)
      const base = r && parseItemBase(r)
      if (!r || !base) return []
      return [{ ...base, width: int(r.width), height: int(r.height) }]
    }),
  }
}

export function parsePackageSummary(v: unknown): ExportPackageSummary | null {
  const o = obj(v)
  const id = str(o?.id)
  const mode = oneOf(o?.mode, EXPORT_MODES)
  const profile = parseProfile(o?.profile)
  const state = oneOf(o?.state, [
    "ready",
    "exported",
    "needs_rebuild",
    "invalidated",
  ] as const)
  const createdAt = str(o?.createdAt)
  const itemCount = int(o?.itemCount)
  if (!o || !id || !mode || !profile || !state || !createdAt || !itemCount)
    return null
  return {
    id,
    venueId: str(o.venueId),
    venueName: str(o.venueName),
    mode,
    profile,
    note: str(o.note),
    itemCount,
    createdAt,
    createdBy: str(o.createdBy),
    rebuiltFrom: str(o.rebuiltFrom),
    state,
    staleAssets: strings(o.staleAssets),
    invalidatedAt: str(o.invalidatedAt),
    invalidatedReason: oneOf(o.invalidatedReason, [
      "item_withdrawn",
      "rebuilt",
    ] as const),
    lastExportedAt: str(o.lastExportedAt),
  }
}

export function parsePackages(data: unknown): ExportPackageSummary[] {
  return list(data, "items").flatMap((row) => {
    const p = parsePackageSummary(row)
    return p ? [p] : []
  })
}

export function parsePackageDetail(data: unknown): ExportPackageDetail | null {
  const summary = parsePackageSummary(data)
  if (!summary) return null
  return {
    ...summary,
    items: list(data, "items").flatMap((row) => {
      const r = obj(row)
      const base = r && parseItemBase(r)
      const position = int(r?.position)
      const venueId = str(r?.venueId)
      const filenameStem = str(r?.filenameStem)
      if (!r || !base || !position || !venueId || !filenameStem) return []
      return [
        {
          ...base,
          position,
          venueId,
          filenameStem,
          altText: str(r.altText),
          caption: str(r.caption),
          useRestrictions: strings(r.useRestrictions),
          eligible: r.eligible !== false,
        },
      ]
    }),
    downloads: list(data, "downloads").flatMap((row) => {
      const r = obj(row)
      const id = str(r?.id)
      const startedAt = str(r?.startedAt)
      if (!r || !id || !startedAt) return []
      return [
        {
          id,
          downloadedBy: str(r.downloadedBy),
          startedAt,
          completedAt: str(r.completedAt),
          failedAt: str(r.failedAt),
          fileCount: int(r.fileCount),
        },
      ]
    }),
  }
}

export function parseOverview(data: unknown): PublicationOverview | null {
  const o = obj(data)
  if (!o) return null
  const count = (v: unknown) => int(v) ?? 0
  return {
    canRecord: o.canRecord === true,
    destinations: list(o, "destinations").flatMap((row) => {
      const r = obj(row)
      const id = str(r?.id)
      const label = str(r?.label)
      if (!r || !id || !label) return []
      return [
        {
          id,
          venueId: str(r.venueId),
          venueName: str(r.venueName),
          label,
          url: str(r.url),
          active: r.active === true,
          revision: int(r.revision) ?? 1,
          published: count(r.published),
          pending: count(r.pending),
          failed: count(r.failed),
          lastPublishedOn: str(r.lastPublishedOn),
        },
      ]
    }),
    outstanding: list(o, "outstanding").flatMap((row) => {
      const r = obj(row)
      const state = oneOf(r?.state, [
        "withdrawal_pending",
        "failed_unknown",
      ] as const)
      const destinationId = str(r?.destinationId)
      const assetId = str(r?.assetId)
      const since = str(r?.since)
      if (!r || !state || !destinationId || !assetId || !since) return []
      return [
        {
          destinationId,
          destinationLabel: str(r.destinationLabel) ?? "",
          assetId,
          venueId: str(r.venueId) ?? "",
          venueName: str(r.venueName),
          subjectLabel: str(r.subjectLabel) ?? "",
          state,
          requested: r.requested === true,
          externalUrl: str(r.externalUrl),
          externalRef: str(r.externalRef),
          since,
        },
      ]
    }),
    published: list(o, "published").flatMap((row) => {
      const r = obj(row)
      const destinationId = str(r?.destinationId)
      const assetId = str(r?.assetId)
      const occurredOn = str(r?.occurredOn)
      if (!r || !destinationId || !assetId || !occurredOn) return []
      return [
        {
          destinationId,
          destinationLabel: str(r.destinationLabel) ?? "",
          assetId,
          venueId: str(r.venueId) ?? "",
          venueName: str(r.venueName),
          subjectLabel: str(r.subjectLabel) ?? "",
          externalUrl: str(r.externalUrl),
          externalRef: str(r.externalRef),
          occurredOn,
        },
      ]
    }),
    recent: list(o, "recent").flatMap((row) => {
      const r = obj(row)
      const id = int(r?.id)
      const action = oneOf(r?.action, [
        "published",
        "withdrawal_requested",
        "withdrawn",
        "failed",
      ] as const)
      const occurredOn = str(r?.occurredOn)
      const recordedAt = str(r?.recordedAt)
      if (!r || id === null || !action || !occurredOn || !recordedAt) return []
      return [
        {
          id,
          destinationLabel: str(r.destinationLabel) ?? "",
          assetId: str(r.assetId) ?? "",
          subjectLabel: str(r.subjectLabel) ?? "",
          action,
          occurredOn,
          recordedAt,
          recordedBy: str(r.recordedBy),
          externalUrl: str(r.externalUrl),
          externalRef: str(r.externalRef),
          note: str(r.note),
        },
      ]
    }),
  }
}

// ---------------------------------------------------------------------------
// Filenames and manifest (§14.1)
// ---------------------------------------------------------------------------

const STEM = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** File extension for an output format, or for an original by its MIME type. */
export function extensionFor(format: ExportFormat, mime: string): string {
  if (format === "webp") return "webp"
  if (format === "jpeg") return "jpg"
  switch (mime) {
    case "image/jpeg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    case "image/heic":
      return "heic"
    default:
      return "bin"
  }
}

/**
 * The public filename: the stored stem (venue slug, subject slug, the first
 * eight characters of the asset id) plus the extension. The stem was built in
 * the database from the venue, the subject and the id only, never from the
 * uploader's filename, a person's name, a note or a location; anything else
 * is refused here too.
 */
export function exportFilename(stem: string, ext: string): string {
  if (!STEM.test(stem) || stem.length > 160) throw new Error("bad_stem")
  if (!/^[a-z0-9]{2,5}$/.test(ext)) throw new Error("bad_ext")
  return `${stem}.${ext}`
}

/** Manifest fields per file, in CSV column order. */
export const MANIFEST_COLUMNS = [
  "file",
  "assetId",
  "renditionId",
  "venueId",
  "venueName",
  "sourceVenueId",
  "subjectKind",
  "subjectId",
  "subject",
  "category",
  "approvalKind",
  "approvalId",
  "approvalVersion",
  "approvalLevel",
  "capturedAt",
  "captureTimeSource",
  "uploadedAt",
  "useRestrictions",
  "altText",
  "caption",
  "profile",
  "format",
  "width",
  "height",
  "bytes",
  "sha256",
] as const

export type ManifestRow = Record<
  (typeof MANIFEST_COLUMNS)[number],
  string | number | null
>

/** RFC 4180 field; a leading formula character is neutralised for spreadsheets. */
export function csvField(value: string | number | null): string {
  if (value === null) return ""
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function manifestCsv(rows: ManifestRow[]): string {
  const lines = [MANIFEST_COLUMNS.join(",")]
  for (const row of rows) {
    lines.push(MANIFEST_COLUMNS.map((c) => csvField(row[c])).join(","))
  }
  return `${lines.join("\r\n")}\r\n`
}

/** Words for use restrictions in the manifest and on screen. */
export const RESTRICTION_WORDS: Record<string, string> = {
  internal_only: "Internal only: not approved for public use",
  contribution_terms_unrecorded:
    "Uploaded before use terms were recorded: check before public use",
}
