import "server-only"

// v0.3 optional media labels, server side (docs/fanout/CONTRACT-v0.3-menus.md
// §4, A1, A2). Every read and write runs as the caller (`actor.db`, RLS and
// the SECURITY DEFINER RPCs re-check role, activity, ownership and venue);
// the service role is never used here. Expected failures are values.

import type { Json } from "@/lib/db/types"
import {
  CONTENT_TYPES,
  EMPTY_LABEL_SUMMARY,
  isContentType,
  LABEL_LIMITS,
  type CatalogueSection,
  type ContentType,
  type LabelCatalogue,
  type LabelEditorAsset,
  type LabelItemRef,
  type MediaLabelItemView,
  type MediaLabelSummary,
  type MenuSectionKind,
  type SaveLabelsErrorCode,
  type SaveLabelsInput,
  type SaveLabelsResult,
} from "@/lib/menus/types"
import { redactError } from "@/lib/server/log/redact"
import type { Db, MediaActor, Outcome } from "@/lib/server/media/types"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `media_label_details` accepts at most this many asset ids per call. */
const DETAILS_CHUNK = 100

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value)

const notFound: Outcome<never> = {
  ok: false,
  status: 404,
  message: "This could not be found.",
}

const unavailable: Outcome<never> = {
  ok: false,
  status: 503,
  message: "Labels could not be loaded right now. Try again in a moment.",
}

type DbError = {
  message?: string
  code?: string
  details?: string | null
} | null

function logFailure(where: string, error: unknown) {
  console.error(`[labels] ${where} failed`, {
    error: redactError(
      error instanceof Error
        ? error
        : new Error(
            `${(error as DbError)?.code ?? "unknown"}: ${(error as DbError)?.message ?? ""}`
          )
    ),
  })
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

type EntryRow = {
  section_id: string
  item_id: string
  name: string
  description: string | null
  aliases: string[]
  position: number
  menu_entry_variants: { variant_id: string; name: string; position: number }[]
}

type SectionRow = {
  id: string
  slug: string
  name: string
  kind: string
  position: number
}

/** PostgREST answers at most `max_rows` (1000) rows per request. */
const ENTRY_PAGE = 1000

const byPosition = (a: { position: number }, b: { position: number }) =>
  a.position - b.position

/**
 * Item ids of the version's entries whose item is archived, paged in a total
 * order. Read on its own rather than embedded in every entry: staff RLS on
 * menu_items runs a lookup per row that survives the other filters, and with
 * the archived filter applied first only archived items pay it, not the whole
 * menu.
 */
async function readArchivedEntryItemIds(actor: MediaActor, versionId: string) {
  const ids = new Set<string>()
  for (let from = 0; ; from += ENTRY_PAGE) {
    const page = await actor.db
      .from("menu_entries")
      .select("item_id, item:menu_items!inner(archived_at)")
      .eq("version_id", versionId)
      .not("item.archived_at", "is", null)
      .order("item_id")
      .range(from, from + ENTRY_PAGE - 1)
    if (page.error) return { error: page.error }
    for (const row of page.data) ids.add(row.item_id)
    if (page.data.length < ENTRY_PAGE) return { ids }
  }
}

/**
 * The active catalogue of `venueId` for labelling. Staff: only venues they may
 * label (current venue or a venue of one of their own assets); admin: any.
 * Another venue looks like an unknown one (404). `status: "none"` when the
 * venue has no active version. Archived items are omitted; sections, items and
 * variants come in menu order.
 */
export async function getLabellingCatalogue(
  actor: MediaActor,
  venueId: string
): Promise<Outcome<{ catalogue: LabelCatalogue }>> {
  if (!isUuid(venueId)) return notFound

  const venueRead = await actor.db
    .from("venues")
    .select("id, name")
    .eq("id", venueId)
    .maybeSingle()
  if (venueRead.error) {
    logFailure("venue read", venueRead.error)
    return unavailable
  }
  if (!venueRead.data) return notFound
  const venueName = venueRead.data.name

  // Mirrors private.staff_can_label_venue: RLS would only hide the menu, which
  // would look like "no menu" rather than "not yours".
  if (actor.profile.role !== "admin" && actor.profile.venueId !== venueId) {
    const own = await actor.db
      .from("media_assets")
      .select("id")
      .eq("uploader_id", actor.profile.id)
      .eq("venue_id", venueId)
      .is("deleted_at", null)
      .limit(1)
    if (own.error) {
      logFailure("venue access read", own.error)
      return unavailable
    }
    if (own.data.length === 0) return notFound
  }

  const versionRead = await actor.db
    .from("menu_versions")
    .select("id, title, activated_at")
    .eq("venue_id", venueId)
    .eq("status", "active")
    .maybeSingle()
  if (versionRead.error) {
    logFailure("active version read", versionRead.error)
    return unavailable
  }
  const version = versionRead.data
  if (!version) {
    return { ok: true, catalogue: { status: "none", venueId, venueName } }
  }

  const sectionsRead = await actor.db
    .from("menu_sections")
    .select("id, slug, name, kind, position")
    .eq("version_id", version.id)
    .order("position")
  if (sectionsRead.error) {
    logFailure("catalogue read", sectionsRead.error)
    return unavailable
  }

  const archivedRead = readArchivedEntryItemIds(actor, version.id)

  // Entries are paged in a total order: a menu may hold up to 2000 items, and a
  // single embedded read would stop silently at max_rows (final review I-3).
  const entries: EntryRow[] = []
  for (let from = 0; ; from += ENTRY_PAGE) {
    const page = await actor.db
      .from("menu_entries")
      .select(
        "section_id, item_id, name, description, aliases, position, menu_entry_variants(variant_id, name, position)"
      )
      .eq("version_id", version.id)
      .order("section_id")
      .order("position")
      .order("item_id")
      .range(from, from + ENTRY_PAGE - 1)
    if (page.error) {
      logFailure("catalogue read", page.error)
      return unavailable
    }
    const rows = page.data as unknown as EntryRow[]
    entries.push(...rows)
    if (rows.length < ENTRY_PAGE) break
  }
  const archived = await archivedRead
  if (archived.error) {
    logFailure("catalogue read", archived.error)
    return unavailable
  }
  const archivedIds = archived.ids
  const bySection = new Map<string, EntryRow[]>()
  for (const entry of entries) {
    const list = bySection.get(entry.section_id) ?? []
    list.push(entry)
    bySection.set(entry.section_id, list)
  }

  const sections: CatalogueSection[] = (
    sectionsRead.data as unknown as SectionRow[]
  )
    .sort(byPosition)
    .map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      kind: s.kind as MenuSectionKind,
      items: [...(bySection.get(s.id) ?? [])]
        .filter((e) => !archivedIds.has(e.item_id))
        .sort(byPosition)
        .map((e) => ({
          itemId: e.item_id,
          name: e.name,
          description: e.description,
          aliases: e.aliases ?? [],
          variants: [...e.menu_entry_variants]
            .sort(byPosition)
            .map((v) => ({ variantId: v.variant_id, name: v.name })),
        })),
    }))

  return {
    ok: true,
    catalogue: {
      status: "active",
      venueId,
      venueName,
      versionId: version.id,
      versionTitle: version.title,
      activatedAt: version.activated_at,
      sections,
    },
  }
}

// ---------------------------------------------------------------------------
// Editor context
// ---------------------------------------------------------------------------

type AssetRow = {
  id: string
  uploader_id: string
  venue_id: string
  media_type: "image" | "video"
  upload_state: string
  deleted_at: string | null
  thumbnail_path: string | null
  original_filename: string
  venue: { name: string } | null
}

/** Same authorised route as lib/server/media/library.ts mediaRoutes.thumbnail. */
const thumbnailRoute = (id: string) => `/api/media/${id}/thumb`

/**
 * The editor's view of up to LABEL_LIMITS.maxBatchAssets assets the caller may
 * label (own ready assets for staff; ready assets for admin) with their
 * current labels. Unknown/forbidden ids are omitted and listed in `missing`.
 * The venue is always the ASSET's upload-time venue.
 */
export async function getAssetLabelContext(
  actor: MediaActor,
  assetIds: string[]
): Promise<Outcome<{ assets: LabelEditorAsset[]; missing: string[] }>> {
  if (
    !Array.isArray(assetIds) ||
    assetIds.length === 0 ||
    assetIds.length > LABEL_LIMITS.maxBatchAssets ||
    !assetIds.every(isUuid)
  ) {
    return {
      ok: false,
      status: 400,
      message: `Choose between 1 and ${LABEL_LIMITS.maxBatchAssets} files to label.`,
    }
  }
  const ids = [...new Set(assetIds.map((id) => id.toLowerCase()))]

  const read = await actor.db
    .from("media_assets")
    .select(
      "id, uploader_id, venue_id, media_type, upload_state, deleted_at, thumbnail_path, original_filename, venue:venues(name)"
    )
    .in("id", ids)
  if (read.error) {
    logFailure("asset read", read.error)
    return unavailable
  }

  const rows = new Map(
    (read.data as unknown as AssetRow[])
      .filter(
        (row) =>
          row.deleted_at === null &&
          row.upload_state === "ready" &&
          (actor.profile.role === "admin" ||
            row.uploader_id === actor.profile.id)
      )
      .map((row) => [row.id, row])
  )

  let summaries: Map<string, MediaLabelSummary>
  try {
    summaries = await loadLabelSummaries(actor.db, [...rows.keys()], {
      viewerId: actor.profile.id,
    })
  } catch {
    return unavailable
  }

  const assets: LabelEditorAsset[] = []
  const missing: string[] = []
  for (const id of ids) {
    const row = rows.get(id)
    if (!row) {
      missing.push(id)
      continue
    }
    assets.push({
      id: row.id,
      venueId: row.venue_id,
      venueName: row.venue?.name ?? "",
      originalFilename: row.original_filename,
      mediaType: row.media_type,
      thumbnailUrl: row.thumbnail_path ? thumbnailRoute(row.id) : null,
      labels: summaries.get(row.id) ?? EMPTY_LABEL_SUMMARY,
    })
  }
  return { ok: true, assets, missing }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

const MESSAGES: Record<SaveLabelsErrorCode, string> = {
  conflict:
    "These labels were changed somewhere else. Check what is saved now, then save again.",
  unavailable_items:
    "Some menu items are no longer on the menu. Remove them, then save again.",
  not_found: "This file could not be found. It may have been removed.",
  forbidden: "Your account cannot label files right now.",
  invalid: "These labels could not be saved because part of them is not valid.",
  catalogue_changed:
    "The menu changed while you were labelling. Check your menu items against the updated menu, then save again.",
  unavailable: "Labels could not be saved right now. Try again in a moment.",
}

function failure(
  assetId: string,
  code: SaveLabelsErrorCode,
  extra: { current?: MediaLabelSummary; unavailableItemIds?: string[] } = {}
): SaveLabelsResult {
  return { ok: false, assetId, code, message: MESSAGES[code], ...extra }
}

type ValidInput = {
  assetId: string
  expectedRevision: number
  catalogueVersionId: string | null
  contentTypes: ContentType[]
  note: string | null
  items: LabelItemRef[]
  missingItem: string | null
}

/** Shape checks that mirror the database's; the RPC re-validates everything. */
function validateInput(input: SaveLabelsInput): ValidInput | null {
  if (!input || typeof input !== "object") return null
  const {
    assetId,
    expectedRevision,
    catalogueVersionId,
    contentTypes,
    note,
    items,
    missingItem,
  } = input
  if (!isUuid(assetId)) return null
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    return null
  if (catalogueVersionId !== null && !isUuid(catalogueVersionId)) return null

  if (!Array.isArray(contentTypes) || !contentTypes.every(isContentType))
    return null
  const types = CONTENT_TYPES.filter((t) => contentTypes.includes(t))
  if (types.length > LABEL_LIMITS.maxContentTypes) return null

  if (note !== null && typeof note !== "string") return null
  const trimmedNote = note?.trim() || null
  if (trimmedNote && trimmedNote.length > LABEL_LIMITS.maxNoteLength)
    return null

  if (!Array.isArray(items)) return null
  const seen = new Set<string>()
  const refs: LabelItemRef[] = []
  for (const ref of items) {
    if (!ref || typeof ref !== "object" || !isUuid(ref.itemId)) return null
    const variantId = ref.variantId ?? null
    if (variantId !== null && !isUuid(variantId)) return null
    const key = `${ref.itemId.toLowerCase()}:${variantId?.toLowerCase() ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ itemId: ref.itemId, variantId })
  }
  if (refs.length > LABEL_LIMITS.maxItemsPerAsset) return null

  if (missingItem !== null && typeof missingItem !== "string") return null
  // "" (or only spaces) = withdraw; null = unchanged.
  const missing = missingItem === null ? null : missingItem.trim()
  if (missing && missing.length > LABEL_LIMITS.maxMissingItemLength) return null

  return {
    assetId,
    expectedRevision,
    catalogueVersionId,
    contentTypes: types,
    note: trimmedNote,
    items: refs,
    missingItem: missing,
  }
}

function parseIdList(details: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(details ?? "")
    return Array.isArray(parsed) ? parsed.filter(isUuid) : []
  } catch {
    return []
  }
}

/** A2.2: by message (the code) or SQLSTATE, never by HTTP status. */
function classify(error: NonNullable<DbError>): SaveLabelsErrorCode {
  const message = (error.message ?? "").trim()
  if (message === "label_conflict") return "conflict"
  if (message === "menu_catalogue_conflict") return "catalogue_changed"
  if (message === "menu_item_unavailable") return "unavailable_items"
  if (message === "media_asset_not_found" || error.code === "P0002")
    return "not_found"
  if (message === "not_active_user" || error.code === "42501")
    return "forbidden"
  if (
    message === "menu_item_wrong_venue" ||
    message.startsWith("invalid_") ||
    message.endsWith("_too_long") ||
    error.code === "22023"
  )
    return "invalid"
  return "unavailable"
}

/** The asset's labels as the caller sees them now (EMPTY when none). */
async function currentSummary(
  actor: MediaActor,
  assetId: string
): Promise<MediaLabelSummary | null> {
  try {
    const map = await loadLabelSummaries(actor.db, [assetId], {
      viewerId: actor.profile.id,
    })
    return map.get(assetId) ?? EMPTY_LABEL_SUMMARY
  } catch {
    return null
  }
}

/**
 * Saves one asset's complete desired labels through `save_media_labels` as the
 * caller. On success returns the fresh summary; failures are per-asset codes
 * (`conflict` carries what is saved now).
 */
export async function saveAssetLabels(
  actor: MediaActor,
  input: SaveLabelsInput
): Promise<SaveLabelsResult> {
  const rawId =
    input && typeof input === "object" && typeof input.assetId === "string"
      ? input.assetId
      : ""
  const valid = validateInput(input)
  if (!valid) return failure(rawId, "invalid")

  const { error } = await actor.db.rpc("save_media_labels", {
    p_asset_id: valid.assetId,
    p_expected_revision: valid.expectedRevision,
    p_content_types: valid.contentTypes,
    // The generated types mark these non-null; the RPC accepts null.
    p_note: valid.note as string,
    p_items: valid.items as unknown as Json,
    p_missing_item: valid.missingItem as string,
    p_catalogue_version_id: valid.catalogueVersionId as string,
  })

  if (error) {
    const code = classify(error)
    if (code === "unavailable") logFailure("save_media_labels", error)
    if (code === "conflict") {
      const current = await currentSummary(actor, valid.assetId)
      return failure(valid.assetId, code, current ? { current } : {})
    }
    if (code === "unavailable_items") {
      return failure(valid.assetId, code, {
        unavailableItemIds: parseIdList(error.details),
      })
    }
    return failure(valid.assetId, code)
  }

  const labels = await currentSummary(actor, valid.assetId)
  if (!labels) {
    // Saved, but the fresh read failed: never claim a failure that hides a
    // save, never claim success without the stored state. A retry from the
    // editor gets `conflict` with the saved labels.
    return {
      ok: false,
      assetId: valid.assetId,
      code: "unavailable",
      message:
        "Your labels were saved, but they could not be shown. Close and reopen to see them.",
    }
  }
  return { ok: true, assetId: valid.assetId, labels }
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

type DetailRow = {
  asset_id: string
  item_id: string
  variant_id: string | null
  name: string
  variant_name: string | null
  section_name: string | null
  snapshot_name: string
  snapshot_variant_name: string | null
  state: string
}

const ITEM_STATES = ["current", "not_on_active_menu", "archived"] as const

function itemView(row: DetailRow): MediaLabelItemView {
  const renamed = row.snapshot_name !== row.name
  const variantRenamed =
    row.variant_id !== null &&
    (row.snapshot_variant_name ?? null) !== (row.variant_name ?? null)
  // The snapshot, in the editor's "Name, Variant" form, when it differs.
  const labelledAs =
    renamed || variantRenamed
      ? row.variant_id !== null && row.snapshot_variant_name
        ? `${row.snapshot_name}, ${row.snapshot_variant_name}`
        : row.snapshot_name
      : null
  return {
    itemId: row.item_id,
    variantId: row.variant_id,
    name: row.name,
    variantName: row.variant_id !== null ? row.variant_name : null,
    sectionName: row.section_name,
    labelledAs,
    state: (ITEM_STATES as readonly string[]).includes(row.state)
      ? (row.state as MediaLabelItemView["state"])
      : "not_on_active_menu",
  }
}

export type LoadLabelSummariesOptions = {
  /**
   * The caller's profile id. An admin sees the open missing-item suggestion
   * of any creator; with this set, their own is preferred. Staff only ever
   * read their own suggestions (RLS).
   */
  viewerId?: string
}

/**
 * Label summaries for a page of gallery assets, read as the caller (RLS), in
 * at most a few queries (no N+1): per 100 ids, one `media_labels` read, one
 * `media_label_details` call and one open-suggestion read. Assets without a
 * visible label row are absent (callers use EMPTY_LABEL_SUMMARY for ready
 * assets, A2.1). Throws (redacted log) when a read fails, so a failure is never
 * mistaken for "no labels"; see `tryLoadLabelSummaries`.
 */
export async function loadLabelSummaries(
  db: Db,
  assetIds: string[],
  options: LoadLabelSummariesOptions = {}
): Promise<Map<string, MediaLabelSummary>> {
  const ids = [...new Set(assetIds.filter(isUuid))]
  const result = new Map<string, MediaLabelSummary>()
  for (let i = 0; i < ids.length; i += DETAILS_CHUNK) {
    const chunk = ids.slice(i, i + DETAILS_CHUNK)
    const [labels, details, suggestions] = await Promise.all([
      db
        .from("media_labels")
        .select(
          "asset_id, content_types, note, revision, has_labels, updated_at"
        )
        .in("asset_id", chunk),
      db.rpc("media_label_details", { p_asset_ids: chunk }),
      db
        .from("menu_item_suggestions")
        .select("asset_id, suggested_name, created_by, created_at")
        .in("asset_id", chunk)
        .eq("status", "open"),
    ])
    const error = labels.error ?? details.error ?? suggestions.error
    if (error) {
      logFailure("label summary read", error)
      throw new Error("Labels could not be loaded.")
    }

    const items = new Map<string, MediaLabelItemView[]>()
    for (const row of details.data as unknown as DetailRow[]) {
      const list = items.get(row.asset_id) ?? []
      list.push(itemView(row))
      items.set(row.asset_id, list)
    }

    // Own suggestion first (admins), then the newest.
    const missing = new Map<string, { text: string; rank: string }>()
    for (const s of suggestions.data ?? []) {
      if (!s.asset_id) continue
      const rank = `${s.created_by === options.viewerId ? 1 : 0}|${s.created_at}`
      const prev = missing.get(s.asset_id)
      if (!prev || rank > prev.rank)
        missing.set(s.asset_id, { text: s.suggested_name, rank })
    }

    for (const row of labels.data ?? []) {
      result.set(row.asset_id, {
        revision: row.revision,
        contentTypes: CONTENT_TYPES.filter((t) =>
          row.content_types.includes(t)
        ),
        note: row.note,
        items: items.get(row.asset_id) ?? [],
        missingItem: missing.get(row.asset_id)?.text ?? null,
        hasLabels: row.has_labels,
        updatedAt: row.updated_at,
      })
    }
  }
  return result
}

/**
 * `loadLabelSummaries` for views that must not depend on labels (gallery,
 * library, v0.3 rule 7): null when the read failed, so callers show
 * `labels: null` ("not loaded") instead of failing the page.
 */
export async function tryLoadLabelSummaries(
  db: Db,
  assetIds: string[],
  options: LoadLabelSummariesOptions = {}
): Promise<Map<string, MediaLabelSummary> | null> {
  try {
    return await loadLabelSummaries(db, assetIds, options)
  } catch {
    return null
  }
}
