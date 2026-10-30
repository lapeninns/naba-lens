// Shared, pure types and constants for the v0.3 menu catalogue and media labels
// (docs/spec/NabaLens-Menus-Labels-v0.3.md, docs/fanout/CONTRACT-v0.3-menus.md).
// Imported by server code, Server Functions and presentational components, so
// it must stay free of runtime dependencies: no Supabase, no Node APIs.

// ---------------------------------------------------------------------------
// Content types and limits
// ---------------------------------------------------------------------------

/** Controlled content types, in display order. Codes are stored in the DB. */
export const CONTENT_TYPES = [
  "dish",
  "preparation",
  "plating",
  "drinks",
  "kitchen",
  "team",
  "venue",
  "event",
] as const

export type ContentType = (typeof CONTENT_TYPES)[number]

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  dish: "Finished dish",
  preparation: "Preparation",
  plating: "Plating",
  drinks: "Drinks",
  kitchen: "Kitchen",
  team: "Team",
  venue: "Venue",
  event: "Event",
}

export function isContentType(value: unknown): value is ContentType {
  return (
    typeof value === "string" &&
    (CONTENT_TYPES as readonly string[]).includes(value)
  )
}

/** Mirrors the database checks in save_media_labels. */
export const LABEL_LIMITS = {
  maxItemsPerAsset: 20,
  maxContentTypes: 4,
  maxNoteLength: 280,
  maxMissingItemLength: 120,
  /** Assets one label-editor batch may hold (same as an upload batch). */
  maxBatchAssets: 10,
} as const

/** Mirrors the database checks in save_menu_draft. */
export const MENU_IMPORT_LIMITS = {
  /** Uploaded JSON/CSV file size. Server Actions cap bodies at 1 MB, so the
   *  import preview uses a Route Handler. */
  maxBytes: 1024 * 1024,
  maxSections: 100,
  maxItems: 2000,
  maxVariantsPerItem: 12,
  maxAliases: 10,
  titleMax: 120,
  sectionNameMax: 120,
  nameMax: 120,
  descriptionMax: 600,
  aliasMax: 80,
  variantNameMax: 80,
  sourceKeyMax: 160,
  /** Serialised `sourceMeta` per item. */
  sourceMetaMaxBytes: 4096,
} as const

/** Source key: lowercase slug segments; `--` joins section and item. */
export const SOURCE_KEY_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,159}$/

export const SUPPORTED_IMPORT_FORMATS = ["json", "csv"] as const
export type ImportFormat = (typeof SUPPORTED_IMPORT_FORMATS)[number]

// ---------------------------------------------------------------------------
// Menu document (import, draft editor and save_menu_draft payload)
// ---------------------------------------------------------------------------

export type MenuSectionKind = "food" | "drinks" | "other"
export type MenuVersionStatus = "draft" | "active" | "retired" | "discarded"

/** Source metadata only: never inferred, never asserted as current. */
export type SourceMetaValue = string | number | boolean | null | string[]
export type SourceMeta = Record<string, SourceMetaValue>

export type MenuDocVariant = {
  /** Stable menu_variants.id, or null for "new / match by name in this item". */
  variantId: string | null
  name: string
}

export type MenuDocReview = {
  /** Same-venue menu_items ids this entry might be. */
  candidates: string[]
  reason: string
}

export type MenuDocItem = {
  /** Stable menu_items.id, or null for a new item (see save_menu_draft). */
  itemId: string | null
  sourceKey: string
  name: string
  description: string | null
  aliases: string[]
  sourceMeta: SourceMeta
  variants: MenuDocVariant[]
  /** Non-null: an uncertain match the admin must resolve before activation. */
  review: MenuDocReview | null
}

export type MenuDocSection = {
  slug: string
  name: string
  kind: MenuSectionKind
  items: MenuDocItem[]
}

export type MenuDocument = {
  title: string
  sections: MenuDocSection[]
}

/** Provenance stored on menu_versions. */
export type MenuSource = {
  kind: "manual" | "json" | "csv"
  /** e.g. the uploaded file name, or "LapenInnsLP data/menus/x.json". */
  label: string | null
  sha256: string | null
  /** e.g. a git commit of the source repository. */
  revision: string | null
  /** ISO timestamp the source was captured/exported. */
  capturedAt: string | null
  notes: string | null
}

export type ImportIssue = {
  severity: "error" | "warning"
  /** Human-readable location, e.g. "row 14" or "sections[2].items[5].name". */
  path: string
  message: string
}

// ---------------------------------------------------------------------------
// Diff (re-import review and draft vs active)
// ---------------------------------------------------------------------------

export type DiffItemRef = {
  sourceKey: string
  itemId: string | null
  name: string
  sectionName: string
}

export type DiffChange = DiffItemRef & {
  /** Which fields changed, e.g. ["name", "section", "variants"]. */
  fields: string[]
  before: Partial<Pick<MenuDocItem, "name" | "description" | "aliases">> & {
    sectionName?: string
    variants?: string[]
  }
}

export type UncertainMatch = DiffItemRef & {
  candidates: (DiffItemRef & { itemId: string })[]
  reason: string
}

export type MenuDiff = {
  added: DiffItemRef[]
  changed: DiffChange[]
  removed: (DiffItemRef & { itemId: string })[]
  uncertain: UncertainMatch[]
  unchangedCount: number
}

/** Admin decision for one uncertain match. */
export type ReviewDecision = { kind: "same"; itemId: string } | { kind: "new" }

// ---------------------------------------------------------------------------
// Admin catalogue views (lib/server/menus -> app/admin/menus -> components)
// ---------------------------------------------------------------------------

export type MenuVersionSummary = {
  id: string
  venueId: string
  status: MenuVersionStatus
  title: string
  revision: number
  source: MenuSource
  itemCount: number
  sectionCount: number
  needsReviewCount: number
  createdAt: string
  createdByName: string | null
  updatedAt: string
  reviewedAt: string | null
  activatedAt: string | null
  activatedByName: string | null
  retiredAt: string | null
}

export type MenuVersionDetail = MenuVersionSummary & {
  venueName: string
  document: MenuDocument
  /** Items of this venue that are archived (cannot receive new labels). */
  archivedItemIds: string[]
  /** Labels per item id across the venue's media (for safe archive/remove). */
  labelCounts: Record<string, number>
}

export type MenuVenueSummary = {
  venueId: string
  venueName: string
  venueActive: boolean
  active: MenuVersionSummary | null
  draftCount: number
  openSuggestionCount: number
}

export type SuggestionView = {
  id: string
  venueId: string
  assetId: string | null
  /** Authorised thumbnail route for the asset, if it is still ready. */
  assetThumbnailUrl: string | null
  suggestedName: string
  status: "open" | "resolved" | "dismissed" | "withdrawn"
  createdAt: string
  createdByName: string | null
  resolvedItemId: string | null
  resolvedItemName: string | null
  resolutionNote: string | null
}

// ---------------------------------------------------------------------------
// Labelling (lib/server/labels -> app/_labels -> components/nabalens/labels)
// ---------------------------------------------------------------------------

export type CatalogueVariant = { variantId: string; name: string }

export type CatalogueItem = {
  itemId: string
  name: string
  description: string | null
  aliases: string[]
  variants: CatalogueVariant[]
}

export type CatalogueSection = {
  id: string
  slug: string
  name: string
  kind: MenuSectionKind
  items: CatalogueItem[]
}

/** The active catalogue of one venue, for labelling that venue's assets. */
export type LabelCatalogue =
  | {
      status: "active"
      venueId: string
      venueName: string
      versionId: string
      versionTitle: string
      activatedAt: string | null
      /** Archived items are omitted. */
      sections: CatalogueSection[]
    }
  | { status: "none"; venueId: string; venueName: string }

export type MediaLabelItemView = {
  itemId: string
  variantId: string | null
  /** Current name: the venue's active entry, else the latest known entry. */
  name: string
  variantName: string | null
  sectionName: string | null
  /** The snapshot name when it differs from `name` (renamed since). */
  labelledAs: string | null
  state: "current" | "not_on_active_menu" | "archived"
}

export type MediaLabelSummary = {
  /** 0 = no label row yet (pass as expectedRevision on the first save). */
  revision: number
  contentTypes: ContentType[]
  note: string | null
  items: MediaLabelItemView[]
  /** The caller-visible open missing-item suggestion text, if any. */
  missingItem: string | null
  hasLabels: boolean
  updatedAt: string | null
}

export const EMPTY_LABEL_SUMMARY: MediaLabelSummary = {
  revision: 0,
  contentTypes: [],
  note: null,
  items: [],
  missingItem: null,
  hasLabels: false,
  updatedAt: null,
}

/** One asset as the label editor needs it. */
export type LabelEditorAsset = {
  id: string
  venueId: string
  venueName: string
  originalFilename: string
  mediaType: "image" | "video"
  thumbnailUrl: string | null
  labels: MediaLabelSummary
}

export type LabelItemRef = { itemId: string; variantId: string | null }

export type SaveLabelsInput = {
  assetId: string
  expectedRevision: number
  /** The catalogue version the editor showed (stale-catalogue detection). */
  catalogueVersionId: string | null
  contentTypes: ContentType[]
  note: string | null
  /** The complete desired set (replaces the asset's items). */
  items: LabelItemRef[]
  /** null = unchanged, "" = withdraw my suggestion, text = suggest. */
  missingItem: string | null
}

export type SaveLabelsErrorCode =
  | "conflict"
  | "unavailable_items"
  | "not_found"
  | "forbidden"
  | "invalid"
  | "unavailable"

export type SaveLabelsResult =
  | { ok: true; assetId: string; labels: MediaLabelSummary }
  | {
      ok: false
      assetId: string
      code: SaveLabelsErrorCode
      message: string
      /** Present on "conflict": what is saved now. */
      current?: MediaLabelSummary
      /** Present on "unavailable_items". */
      unavailableItemIds?: string[]
    }

// ---------------------------------------------------------------------------
// Admin library label filters (H)
// ---------------------------------------------------------------------------

export type LabelState = "labelled" | "unlabelled"

export type LibraryLabelFilters = {
  itemId: string | null
  variantId: string | null
  /** Section slug. */
  category: string | null
  contentType: ContentType | null
  labelState: LabelState | null
  /** Trimmed, 1..80 chars, or null. */
  query: string | null
  /** Inclusive YYYY-MM-DD (Europe/London), or null. */
  from: string | null
  to: string | null
}

export type LibraryLabelFilterOptions = {
  categories: { slug: string; name: string }[]
  items: {
    id: string
    name: string
    sectionName: string | null
    variants: { id: string; name: string }[]
  }[]
}
