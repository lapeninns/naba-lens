import "server-only"

// Admin catalogue operations (contract §4, owner D). Every function re-checks
// that the actor is an active admin, then acts as the caller (`actor.db`), so
// RLS and the SECURITY DEFINER RPCs (which re-read the profile) apply too.
// Catalogue writes never use the service role.

import {
  diffMenuDocuments,
  matchImportToBase,
  parseMenuFile,
  sha256Hex,
} from "@/lib/menus/import"
import {
  MENU_IMPORT_LIMITS,
  type ImportFormat,
  type ImportIssue,
  type MenuDiff,
  type MenuDocument,
  type MenuSource,
  type MenuVenueSummary,
  type MenuVersionDetail,
  type MenuVersionStatus,
  type MenuVersionSummary,
  type SuggestionView,
} from "@/lib/menus/types"
import type { Json } from "@/lib/db/types"
import type { Db, MediaActor, Outcome } from "@/lib/server/media/types"

import {
  buildDocument,
  copyForDraft,
  reviewBaseFor,
  type EntryRow,
  type SectionRow,
} from "./document"
import { menuReadFailure, menuRpcFailure, type MenuFailure } from "./errors"
import {
  SOURCE_LIMITS,
  cleanFileName,
  cleanNote,
  cleanTitle,
  describeIssues,
  draftDocumentErrors,
  isRevision,
  isUuid,
  parseSource,
  withTitle,
} from "./validate"

export type VenueMenuOverview = {
  venue: { id: string; name: string; active: boolean }
  active: MenuVersionSummary | null
  drafts: MenuVersionSummary[]
  /** Retired and discarded versions, newest first. */
  history: MenuVersionSummary[]
  suggestions: SuggestionView[]
}

export type ImportPreview = {
  /** Matched against the venue's active version (ids filled, reviews set). */
  document: MenuDocument
  issues: ImportIssue[]
  diff: MenuDiff
  source: MenuSource
  /** Active version the diff was computed against, or null. */
  baseVersionId: string | null
  /**
   * The active version's items named as review candidates (with their variant
   * ids), for `applyReviewDecision(doc, key, decision, reviewBase)`.
   */
  reviewBase: MenuDocument | null
}

/** A rejected file: 400 with the parser's issues. */
export type ImportRejected = {
  ok: false
  status: 400
  message: string
  issues: ImportIssue[]
}

const FORBIDDEN: MenuFailure = {
  ok: false,
  status: 403,
  message: "Only an active admin can manage menus.",
}
const invalid = (message: string): MenuFailure => ({
  ok: false,
  status: 400,
  message,
})
const notFound = (message: string): MenuFailure => ({
  ok: false,
  status: 404,
  message,
})

function isAdmin(actor: MediaActor): boolean {
  return actor.profile.role === "admin" && actor.profile.active
}

/** PostgREST caps responses at `max_rows` (1000); read every page. */
const PAGE = 1000

type DbError = { message?: string; code?: string } | null
type Page<T> = PromiseLike<{ data: T[] | null; error: DbError }>

async function selectAll<T>(
  page: (from: number, to: number) => Page<T>
): Promise<{ ok: true; rows: T[] } | { ok: false; error: DbError }> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) return { ok: false, error }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return { ok: true, rows }
  }
}

/**
 * `selectAll` for a long, totally ordered read: after the first page, further
 * pages go out in waves of `PAGE_CONCURRENCY`. Rows come back in page order and
 * stop at the first short page, so the result is the one sequential paging
 * gives; the wave that holds the end may ask for pages past it.
 */
const PAGE_CONCURRENCY = 4

async function selectAllConcurrent<T>(
  page: (from: number, to: number) => Page<T>
): Promise<{ ok: true; rows: T[] } | { ok: false; error: DbError }> {
  const first = await page(0, PAGE - 1)
  if (first.error) return { ok: false, error: first.error }
  const rows: T[] = [...(first.data ?? [])]
  if (rows.length < PAGE) return { ok: true, rows }
  for (let next = 1; ; next += PAGE_CONCURRENCY) {
    const wave = await Promise.all(
      Array.from({ length: PAGE_CONCURRENCY }, (_, i) =>
        page((next + i) * PAGE, (next + i + 1) * PAGE - 1)
      )
    )
    for (const { data, error } of wave) {
      if (error) return { ok: false, error }
      rows.push(...(data ?? []))
      if (!data || data.length < PAGE) return { ok: true, rows }
    }
  }
}

// ---------------------------------------------------------------------------
// Version summaries
// ---------------------------------------------------------------------------

const VERSION_COLUMNS =
  "id, venue_id, status, title, revision, source_kind, source_label, source_sha256, source_revision, source_captured_at, source_notes, based_on_version_id, created_at, updated_at, reviewed_at, activated_at, retired_at, creator:profiles!menu_versions_created_by_fkey(display_name), activator:profiles!menu_versions_activated_by_fkey(display_name), sections:menu_sections(count), entries:menu_entries(count), reviews:menu_entries(count)"

type VersionRow = {
  id: string
  venue_id: string
  status: string
  title: string
  revision: number
  source_kind: string
  source_label: string | null
  source_sha256: string | null
  source_revision: string | null
  source_captured_at: string | null
  source_notes: string | null
  based_on_version_id: string | null
  created_at: string
  updated_at: string
  reviewed_at: string | null
  activated_at: string | null
  retired_at: string | null
  creator: { display_name: string } | null
  activator: { display_name: string } | null
  sections: { count: number }[] | null
  entries: { count: number }[] | null
  reviews: { count: number }[] | null
}

const STATUSES: MenuVersionStatus[] = [
  "draft",
  "active",
  "retired",
  "discarded",
]

function versionsQuery(db: Db) {
  return (
    db
      .from("menu_versions")
      .select(VERSION_COLUMNS)
      // Narrows the `reviews` embed only (the version rows are unaffected).
      .eq("reviews.needs_review", true)
  )
}

function toSummary(row: VersionRow): MenuVersionSummary {
  const kind = row.source_kind
  return {
    id: row.id,
    venueId: row.venue_id,
    status: (STATUSES as string[]).includes(row.status)
      ? (row.status as MenuVersionStatus)
      : "discarded",
    title: row.title,
    revision: row.revision,
    source: {
      kind: kind === "json" || kind === "csv" ? kind : "manual",
      label: row.source_label,
      sha256: row.source_sha256,
      revision: row.source_revision,
      capturedAt: row.source_captured_at,
      notes: row.source_notes,
    },
    itemCount: row.entries?.[0]?.count ?? 0,
    sectionCount: row.sections?.[0]?.count ?? 0,
    needsReviewCount: row.reviews?.[0]?.count ?? 0,
    createdAt: row.created_at,
    createdByName: row.creator?.display_name ?? null,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
    activatedAt: row.activated_at,
    activatedByName: row.activator?.display_name ?? null,
    retiredAt: row.retired_at,
  }
}

const newestFirst = (a: MenuVersionSummary, b: MenuVersionSummary) =>
  (b.retiredAt ?? b.updatedAt).localeCompare(a.retiredAt ?? a.updatedAt)

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const ENTRY_COLUMNS =
  "id, section_id, item_id, name, description, aliases, source_key, source_meta, position, needs_review, review_candidates, review_reason, variants:menu_entry_variants(variant_id, name, position)"

async function loadDocument(
  db: Db,
  versionId: string,
  title: string
): Promise<{ ok: true; document: MenuDocument } | MenuFailure> {
  const [sections, entries] = await Promise.all([
    db
      .from("menu_sections")
      .select("id, slug, name, kind, position")
      .eq("version_id", versionId)
      .order("position"),
    selectAll<EntryRow>(
      (from, to) =>
        db
          .from("menu_entries")
          .select(ENTRY_COLUMNS)
          .eq("version_id", versionId)
          .order("id")
          .range(from, to) as unknown as Page<EntryRow>
    ),
  ])
  if (sections.error) return menuReadFailure(sections.error, "sections")
  if (!entries.ok) return menuReadFailure(entries.error, "entries")
  return {
    ok: true,
    document: buildDocument(
      title,
      (sections.data ?? []) as SectionRow[],
      entries.rows
    ),
  }
}

async function activeVersionOf(
  db: Db,
  venueId: string
): Promise<
  | { ok: true; active: { id: string; title: string } | null }
  | { ok: false; error: DbError }
> {
  const { data, error } = await db
    .from("menu_versions")
    .select("id, title")
    .eq("venue_id", venueId)
    .eq("status", "active")
    .maybeSingle()
  if (error) return { ok: false, error }
  return { ok: true, active: data }
}

/** The venue's active document, or null when it has none. */
async function activeDocument(
  db: Db,
  venueId: string
): Promise<
  | {
      ok: true
      id: string | null
      title: string | null
      document: MenuDocument | null
    }
  | MenuFailure
> {
  const active = await activeVersionOf(db, venueId)
  if (!active.ok) return menuReadFailure(active.error, "active version")
  if (!active.active) return { ok: true, id: null, title: null, document: null }
  const loaded = await loadDocument(db, active.active.id, active.active.title)
  if (!loaded.ok) return loaded
  return {
    ok: true,
    id: active.active.id,
    title: active.active.title,
    document: loaded.document,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listMenuVenues(
  actor: MediaActor
): Promise<Outcome<{ venues: MenuVenueSummary[] }>> {
  if (!isAdmin(actor)) return FORBIDDEN
  const [venues, versions, suggestions] = await Promise.all([
    actor.db.from("venues").select("id, name, active").order("name"),
    selectAll<VersionRow>(
      (from, to) =>
        versionsQuery(actor.db)
          .in("status", ["active", "draft"])
          .order("id")
          .range(from, to) as unknown as Page<VersionRow>
    ),
    selectAll<{ venue_id: string }>(
      (from, to) =>
        actor.db
          .from("menu_item_suggestions")
          .select("venue_id")
          .eq("status", "open")
          .order("id")
          .range(from, to) as unknown as Page<{ venue_id: string }>
    ),
  ])
  if (venues.error) return menuReadFailure(venues.error, "venues")
  if (!versions.ok) return menuReadFailure(versions.error, "versions")
  if (!suggestions.ok) return menuReadFailure(suggestions.error, "suggestions")

  const active = new Map<string, MenuVersionSummary>()
  const drafts = new Map<string, number>()
  for (const row of versions.rows) {
    if (row.status === "active") active.set(row.venue_id, toSummary(row))
    else drafts.set(row.venue_id, (drafts.get(row.venue_id) ?? 0) + 1)
  }
  const open = new Map<string, number>()
  for (const s of suggestions.rows)
    open.set(s.venue_id, (open.get(s.venue_id) ?? 0) + 1)

  return {
    ok: true,
    venues: (venues.data ?? []).map((v) => ({
      venueId: v.id,
      venueName: v.name,
      venueActive: v.active,
      active: active.get(v.id) ?? null,
      draftCount: drafts.get(v.id) ?? 0,
      openSuggestionCount: open.get(v.id) ?? 0,
    })),
  }
}

/** Closed suggestions shown under the open ones. */
const CLOSED_SUGGESTIONS_SHOWN = 50

const SUGGESTION_COLUMNS =
  "id, venue_id, asset_id, suggested_name, status, created_at, resolved_item_id, resolution_note, creator:profiles!menu_item_suggestions_created_by_fkey(display_name), asset:media_assets!menu_item_suggestions_asset_fkey(upload_state, deleted_at, thumbnail_path)"

type SuggestionRow = {
  id: string
  venue_id: string
  asset_id: string | null
  suggested_name: string
  status: string
  created_at: string
  resolved_item_id: string | null
  resolution_note: string | null
  creator: { display_name: string } | null
  asset: {
    upload_state: string
    deleted_at: string | null
    thumbnail_path: string | null
  } | null
}

/**
 * Current names of items (amendment A1.9): the active version's entry, else
 * the most recently activated version's entry, else any entry.
 */
async function currentItemNames(
  db: Db,
  itemIds: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (itemIds.length === 0) return names
  const { data } = await db
    .from("menu_entries")
    .select(
      "item_id, name, version:menu_versions!menu_entries_version_fkey(status, activated_at)"
    )
    .in("item_id", itemIds)
  const rank = (v: { status: string; activated_at: string | null } | null) =>
    v?.status === "active" ? "2" : v?.activated_at ? `1${v.activated_at}` : "0"
  const best = new Map<string, string>()
  for (const row of (data ?? []) as unknown as {
    item_id: string
    name: string
    version: { status: string; activated_at: string | null } | null
  }[]) {
    const r = rank(row.version)
    if (!best.has(row.item_id) || r > best.get(row.item_id)!) {
      best.set(row.item_id, r)
      names.set(row.item_id, row.name)
    }
  }
  return names
}

function toSuggestionView(
  row: SuggestionRow,
  names: Map<string, string>
): SuggestionView {
  const asset = row.asset
  const thumb =
    row.asset_id &&
    asset &&
    asset.upload_state === "ready" &&
    !asset.deleted_at &&
    asset.thumbnail_path
      ? `/api/media/${row.asset_id}/thumb`
      : null
  const status = (["open", "resolved", "dismissed", "withdrawn"] as const).find(
    (s) => s === row.status
  )
  return {
    id: row.id,
    venueId: row.venue_id,
    assetId: row.asset_id,
    assetThumbnailUrl: thumb,
    suggestedName: row.suggested_name,
    status: status ?? "withdrawn",
    createdAt: row.created_at,
    createdByName: row.creator?.display_name ?? null,
    resolvedItemId: row.resolved_item_id,
    resolvedItemName: row.resolved_item_id
      ? (names.get(row.resolved_item_id) ?? null)
      : null,
    resolutionNote: row.resolution_note,
  }
}

export async function getVenueMenuOverview(
  actor: MediaActor,
  venueId: string
): Promise<Outcome<VenueMenuOverview>> {
  if (!isAdmin(actor)) return FORBIDDEN
  if (!isUuid(venueId)) return notFound("This venue could not be found.")
  const db = actor.db
  const [venue, versions, open, closed] = await Promise.all([
    db
      .from("venues")
      .select("id, name, active")
      .eq("id", venueId)
      .maybeSingle(),
    selectAll<VersionRow>(
      (from, to) =>
        versionsQuery(db)
          .eq("venue_id", venueId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to) as unknown as Page<VersionRow>
    ),
    db
      .from("menu_item_suggestions")
      .select(SUGGESTION_COLUMNS)
      .eq("venue_id", venueId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(PAGE),
    db
      .from("menu_item_suggestions")
      .select(SUGGESTION_COLUMNS)
      .eq("venue_id", venueId)
      .neq("status", "open")
      .order("updated_at", { ascending: false })
      .limit(CLOSED_SUGGESTIONS_SHOWN),
  ])
  if (venue.error) return menuReadFailure(venue.error, "venue")
  if (!venue.data) return notFound("This venue could not be found.")
  if (!versions.ok) return menuReadFailure(versions.error, "versions")
  if (open.error) return menuReadFailure(open.error, "suggestions")
  if (closed.error) return menuReadFailure(closed.error, "suggestions")

  const summaries = versions.rows.map(toSummary)
  const rows = [
    ...(open.data ?? []),
    ...(closed.data ?? []),
  ] as unknown as SuggestionRow[]
  const names = await currentItemNames(db, [
    ...new Set(
      rows.flatMap((r) => (r.resolved_item_id ? [r.resolved_item_id] : []))
    ),
  ])
  return {
    ok: true,
    venue: venue.data,
    active: summaries.find((s) => s.status === "active") ?? null,
    drafts: summaries.filter((s) => s.status === "draft"),
    history: summaries
      .filter((s) => s.status === "retired" || s.status === "discarded")
      .sort(newestFirst),
    suggestions: rows.map((r) => toSuggestionView(r, names)),
  }
}

export type MenuVersionView = {
  version: MenuVersionDetail
  diff: MenuDiff | null
  /** The venue's active version (null if none, or when this one is it). */
  active: { id: string; title: string } | null
  /** See ImportPreview.reviewBase. */
  reviewBase: MenuDocument | null
}

const archivedItemIdsOf = (db: Db, venueId: string) =>
  selectAllConcurrent<{ id: string }>(
    (from, to) =>
      db
        .from("menu_items")
        .select("id")
        .eq("venue_id", venueId)
        .not("archived_at", "is", null)
        .order("id")
        .range(from, to) as unknown as Page<{ id: string }>
  )

/**
 * The document of a venue's active version and its archived item ids: what the
 * venue page needs to offer items to link a suggestion to. No label counts and
 * no diff.
 */
export async function getActiveMenuItems(
  actor: MediaActor,
  venueId: string
): Promise<
  Outcome<{ document: MenuDocument | null; archivedItemIds: string[] }>
> {
  if (!isAdmin(actor)) return FORBIDDEN
  if (!isUuid(venueId)) return notFound("This venue could not be found.")
  const [active, archived] = await Promise.all([
    activeDocument(actor.db, venueId),
    archivedItemIdsOf(actor.db, venueId),
  ])
  if (!active.ok) return active
  if (!archived.ok) return menuReadFailure(archived.error, "archived items")
  return {
    ok: true,
    document: active.document,
    archivedItemIds: archived.rows.map((r) => r.id),
  }
}

/** A version with its document, and its diff against the venue's active one. */
export async function getMenuVersion(
  actor: MediaActor,
  versionId: string
): Promise<Outcome<MenuVersionView>> {
  if (!isAdmin(actor)) return FORBIDDEN
  if (!isUuid(versionId))
    return notFound("This menu version could not be found.")
  const db = actor.db
  const { data, error } = await versionsQuery(db)
    .eq("id", versionId)
    .maybeSingle()
  if (error) return menuReadFailure(error, "version")
  if (!data) return notFound("This menu version could not be found.")
  const row = data as unknown as VersionRow
  const summary = toSummary(row)

  const [venue, loaded, archived, labels, base] = await Promise.all([
    db.from("venues").select("name").eq("id", row.venue_id).maybeSingle(),
    loadDocument(db, row.id, row.title),
    archivedItemIdsOf(db, row.venue_id),
    // Label rows of non-deleted, ready assets, as admin RLS shows them.
    db.rpc("menu_label_counts", { p_venue_id: row.venue_id }),
    summary.status === "active"
      ? Promise.resolve(null)
      : activeDocument(db, row.venue_id),
  ])
  if (venue.error) return menuReadFailure(venue.error, "venue")
  if (!loaded.ok) return loaded
  if (!archived.ok) return menuReadFailure(archived.error, "archived items")
  if (labels.error) return menuReadFailure(labels.error, "label counts")
  if (base && !base.ok) return base

  const document = loaded.document
  const baseDoc = base?.document ?? null
  return {
    ok: true,
    version: {
      ...summary,
      venueName: venue.data?.name ?? "Unknown venue",
      document,
      archivedItemIds: archived.rows.map((r) => r.id),
      labelCounts: (labels.data ?? {}) as Record<string, number>,
    },
    diff: baseDoc ? diffMenuDocuments(baseDoc, document) : null,
    active:
      base && base.id && base.title ? { id: base.id, title: base.title } : null,
    reviewBase: reviewBaseFor(baseDoc, document),
  }
}

// ---------------------------------------------------------------------------
// Import preview (writes nothing)
// ---------------------------------------------------------------------------

/** Parse + validate + match + diff. Writes nothing. */
export async function previewMenuImport(
  actor: MediaActor,
  input: {
    venueId: string
    fileName: string
    text: string
    format?: ImportFormat
  }
): Promise<Outcome<ImportPreview> | ImportRejected> {
  if (!isAdmin(actor)) return FORBIDDEN
  if (!isUuid(input.venueId)) return notFound("This venue could not be found.")
  if (typeof input.text !== "string" || typeof input.fileName !== "string")
    return invalid("Choose a JSON or CSV file.")
  if (new TextEncoder().encode(input.text).length > MENU_IMPORT_LIMITS.maxBytes)
    return invalid("The file is larger than 1 MiB.")

  const venue = await actor.db
    .from("venues")
    .select("id")
    .eq("id", input.venueId)
    .maybeSingle()
  if (venue.error) return menuReadFailure(venue.error, "venue")
  if (!venue.data) return notFound("This venue could not be found.")

  const fileName = cleanFileName(input.fileName)
  const parsed = parseMenuFile({
    fileName,
    text: input.text,
    ...(input.format ? { format: input.format } : {}),
  })
  if (!parsed.ok) {
    return {
      ok: false,
      status: 400,
      message:
        "The file could not be imported. Fix the errors listed and try again.",
      issues: parsed.issues,
    }
  }

  const issues = [...parsed.issues]
  // Parsing succeeded, so the format was explicit or a .json/.csv extension.
  const format: ImportFormat =
    input.format ?? (/\.json$/i.test(fileName) ? "json" : "csv")
  const source = importSource(
    format,
    fileName,
    await sha256Hex(input.text),
    parsed.source,
    issues
  )

  const base = await activeDocument(actor.db, input.venueId)
  if (!base.ok) return base
  const document = matchImportToBase(base.document, parsed.document)
  return {
    ok: true,
    document,
    issues,
    diff: diffMenuDocuments(base.document, document),
    source,
    baseVersionId: base.id,
    reviewBase: reviewBaseFor(base.document, document),
  }
}

/**
 * Provenance for an uploaded file: the file name as label, its SHA-256, and
 * revision/capture time/notes from the file's own `source` block when given
 * (a source label that differs from the file name is kept in the notes).
 * Values beyond the column limits are dropped with a warning.
 */
function importSource(
  kind: ImportFormat,
  fileName: string,
  sha256: string,
  parsed: MenuSource | undefined,
  issues: ImportIssue[]
): MenuSource {
  const warn = (path: string, message: string) =>
    issues.push({ severity: "warning", path, message })
  let revision = parsed?.revision?.trim() || null
  if (revision && [...revision].length > SOURCE_LIMITS.revisionMax) {
    warn("source.revision", "Source revision is too long and was not kept")
    revision = null
  }
  let capturedAt: string | null = null
  if (parsed?.capturedAt) {
    const time = Date.parse(parsed.capturedAt)
    if (Number.isFinite(time)) capturedAt = new Date(time).toISOString()
  }
  const notes = [
    parsed?.label?.trim() && parsed.label.trim() !== fileName
      ? `Source: ${parsed.label.trim()}`
      : null,
    parsed?.notes?.trim() || null,
  ]
    .filter(Boolean)
    .join("\n")
  let keptNotes: string | null = notes || null
  if (keptNotes && [...keptNotes].length > SOURCE_LIMITS.notesMax) {
    warn("source.notes", "Source notes are too long and were shortened")
    keptNotes =
      [...keptNotes].slice(0, SOURCE_LIMITS.notesMax - 1).join("") + "…"
  }
  return {
    kind,
    label: fileName,
    sha256,
    revision,
    capturedAt,
    notes: keptNotes,
  }
}

// ---------------------------------------------------------------------------
// Writes (RPCs as the caller)
// ---------------------------------------------------------------------------

type Empty = Record<never, never>

function checkDocument(
  document: unknown,
  title: unknown
): { ok: true; document: MenuDocument } | MenuFailure {
  const cleanedTitle = cleanTitle(title)
  if (!cleanedTitle)
    return invalid("Give the menu a title (up to 120 characters).")
  const errors = draftDocumentErrors(document)
  if (errors.length) return invalid(describeIssues(errors))
  return {
    ok: true,
    document: withTitle(document as MenuDocument, cleanedTitle),
  }
}

export async function createMenuDraft(
  actor: MediaActor,
  input: {
    venueId: string
    title: string
    source: MenuSource
    document: MenuDocument
    basedOnVersionId: string | null
  }
): Promise<Outcome<{ versionId: string }>> {
  if (!isAdmin(actor)) return FORBIDDEN
  if (!isUuid(input?.venueId)) return notFound("This venue could not be found.")
  if (input.basedOnVersionId !== null && !isUuid(input.basedOnVersionId))
    return notFound("The version this draft is based on could not be found.")
  const source = parseSource(input.source)
  if (!source) return invalid("The menu's source details are invalid.")
  const checked = checkDocument(input.document, input.title)
  if (!checked.ok) return checked

  const { data, error } = await actor.db.rpc("create_menu_draft", {
    p_venue_id: input.venueId,
    p_title: checked.document.title,
    p_source: source as unknown as Json,
    p_document: checked.document as unknown as Json,
    ...(input.basedOnVersionId ? { p_based_on: input.basedOnVersionId } : {}),
  })
  if (error) return menuRpcFailure(error, "create draft")
  if (!isUuid(data)) return menuRpcFailure(null, "create draft (no id)")
  return { ok: true, versionId: data }
}

/** A new draft copied from the venue's active version (ids carried forward). */
export async function createDraftFromActive(
  actor: MediaActor,
  venueId: string
): Promise<Outcome<{ versionId: string }>> {
  if (!isAdmin(actor)) return FORBIDDEN
  if (!isUuid(venueId)) return notFound("This venue could not be found.")
  const base = await activeDocument(actor.db, venueId)
  if (!base.ok) return base
  if (!base.document || !base.id)
    return {
      ok: false,
      status: 409,
      message: "This venue has no active menu to copy.",
    }
  return createMenuDraft(actor, {
    venueId,
    title: base.document.title,
    source: {
      kind: "manual",
      label: [...`Copy of “${base.document.title}”`]
        .slice(0, SOURCE_LIMITS.labelMax)
        .join(""),
      sha256: null,
      revision: null,
      capturedAt: null,
      notes: null,
    },
    document: copyForDraft(base.document),
    basedOnVersionId: base.id,
  })
}

export async function saveMenuDraft(
  actor: MediaActor,
  input: { versionId: string; expectedRevision: number; document: MenuDocument }
): Promise<Outcome<{ revision: number }>> {
  if (!isAdmin(actor)) return FORBIDDEN
  if (!isUuid(input?.versionId))
    return notFound("This menu version could not be found.")
  if (!isRevision(input.expectedRevision))
    return invalid("Reload the page and try again.")
  const checked = checkDocument(
    input.document,
    (input.document as Partial<MenuDocument> | null)?.title
  )
  if (!checked.ok) return checked

  const { data, error } = await actor.db.rpc("save_menu_draft", {
    p_version_id: input.versionId,
    p_expected_revision: input.expectedRevision,
    p_document: checked.document as unknown as Json,
  })
  if (error) return menuRpcFailure(error, "save draft")
  if (!isRevision(data)) return menuRpcFailure(null, "save draft (no revision)")
  return { ok: true, revision: data }
}

export async function activateMenuVersion(
  actor: MediaActor,
  input: { versionId: string; expectedRevision: number }
): Promise<Outcome<Empty>> {
  if (!isAdmin(actor)) return FORBIDDEN
  if (!isUuid(input?.versionId))
    return notFound("This menu version could not be found.")
  if (!isRevision(input.expectedRevision))
    return invalid("Reload the page and try again.")
  const { error } = await actor.db.rpc("activate_menu_version", {
    p_version_id: input.versionId,
    p_expected_revision: input.expectedRevision,
  })
  if (error) return menuRpcFailure(error, "activate")
  return { ok: true }
}

export async function retireMenuVersion(
  actor: MediaActor,
  versionId: string
): Promise<Outcome<Empty>> {
  if (!isAdmin(actor)) return FORBIDDEN
  if (!isUuid(versionId))
    return notFound("This menu version could not be found.")
  const { error } = await actor.db.rpc("retire_menu_version", {
    p_version_id: versionId,
  })
  if (error) return menuRpcFailure(error, "retire")
  return { ok: true }
}

export async function discardMenuDraft(
  actor: MediaActor,
  versionId: string
): Promise<Outcome<Empty>> {
  if (!isAdmin(actor)) return FORBIDDEN
  if (!isUuid(versionId))
    return notFound("This menu version could not be found.")
  const { error } = await actor.db.rpc("discard_menu_draft", {
    p_version_id: versionId,
  })
  if (error) return menuRpcFailure(error, "discard")
  return { ok: true }
}

export async function setMenuItemArchived(
  actor: MediaActor,
  input: { itemId: string; archived: boolean }
): Promise<Outcome<Empty>> {
  if (!isAdmin(actor)) return FORBIDDEN
  if (!isUuid(input?.itemId))
    return notFound("This menu item could not be found.")
  if (typeof input.archived !== "boolean")
    return invalid("This request is invalid.")
  const { error } = await actor.db.rpc("set_menu_item_archived", {
    p_item_id: input.itemId,
    p_archived: input.archived,
  })
  if (error) return menuRpcFailure(error, "archive item")
  return { ok: true }
}

export async function resolveMenuSuggestion(
  actor: MediaActor,
  input: {
    suggestionId: string
    status: "resolved" | "dismissed"
    itemId: string | null
    note: string | null
  }
): Promise<Outcome<Empty>> {
  if (!isAdmin(actor)) return FORBIDDEN
  if (!isUuid(input?.suggestionId))
    return notFound("This suggestion could not be found.")
  if (input.status !== "resolved" && input.status !== "dismissed")
    return invalid("Choose whether to link or dismiss the suggestion.")
  if (input.status === "resolved" && !isUuid(input.itemId))
    return invalid("Choose a menu item to link the suggestion to.")
  if (input.status === "dismissed" && input.itemId !== null)
    return invalid("A dismissed suggestion is not linked to an item.")
  const note = cleanNote(input.note)
  if (note === undefined) return invalid("The note is too long.")
  const { error } = await actor.db.rpc("resolve_menu_item_suggestion", {
    p_suggestion_id: input.suggestionId,
    p_status: input.status,
    ...(input.itemId ? { p_item_id: input.itemId } : {}),
    ...(note ? { p_note: note } : {}),
  })
  if (error) return menuRpcFailure(error, "resolve suggestion")
  return { ok: true }
}
