import { MEDIA_LIMITS } from "@/lib/config/media"
import {
  EMPTY_LABEL_SUMMARY,
  isContentType,
  type LibraryLabelFilters,
} from "@/lib/menus/types"
import { tryLoadLabelSummaries } from "@/lib/server/labels"

import type {
  Db,
  LibraryFilters,
  MediaActor,
  MediaItemView,
  MediaKind,
  MediaPage,
  Outcome,
} from "./types"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// PostgREST timestamptz output, e.g. 2026-10-29T23:36:49.123456+00:00
const TIMESTAMP =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)$/

const SELECT =
  "id, uploader_id, media_type, upload_state, thumbnail_path, preview_path, validated_mime_type, original_filename, created_at, width, height, duration_seconds, size_bytes, venue:venues(name), uploader:profiles!media_assets_uploader_id_fkey(display_name)"

/** Opaque cursor over the stable (created_at desc, id desc) order. */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url")
}

export function decodeCursor(
  cursor: string | null | undefined
): { createdAt: string; id: string } | null {
  if (!cursor) return null
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (
      Array.isArray(value) &&
      typeof value[0] === "string" &&
      typeof value[1] === "string" &&
      TIMESTAMP.test(value[0]) &&
      UUID.test(value[1])
    ) {
      return { createdAt: value[0], id: value[1] }
    }
  } catch {}
  return null
}

/**
 * Every admin library filter: the v0.2 venue/staff/type plus the v0.3 label
 * filters. `listLibrary` also accepts the plain `LibraryFilters`, so callers
 * that only filter by staff (the admin portfolio) stay unchanged.
 */
export type AdminLibraryFilters = LibraryFilters & LibraryLabelFilters

/** The URL search params of /admin and /api/library, in canonical order. */
export const LIBRARY_PARAMS = [
  "venue",
  "staff",
  "type",
  "item",
  "variant",
  "category",
  "content",
  "labels",
  "q",
  "from",
  "to",
] as const

export type LibraryParam = (typeof LIBRARY_PARAMS)[number]

export const NO_LABEL_FILTERS: LibraryLabelFilters = {
  itemId: null,
  variantId: null,
  category: null,
  contentType: null,
  labelState: null,
  query: null,
  from: null,
  to: null,
}

/** Section slug, as menu_sections.slug. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
export const LIBRARY_QUERY_MAX = 80

/** The calendar day as [y, m, d] when `value` is a real YYYY-MM-DD date. */
function calendarDay(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null
  const match = DAY.exec(value)
  if (!match) return null
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  if (
    y < 1970 ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null
  }
  return [y, m, d]
}

/** Search text: trimmed, inner whitespace collapsed, 1..80 characters. */
function searchText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.replace(/\s+/g, " ").trim()
  const length = Array.from(text).length
  return length >= 1 && length <= LIBRARY_QUERY_MAX ? text : null
}

/**
 * Normalises untrusted filter input (URL search params or a client call).
 * Never throws: an invalid or unknown value is ignored (that filter is off),
 * a repeated param uses its first value. A `from` later than `to` is swapped,
 * so the range is always the inclusive span between the two days.
 */
export function parseLibraryFilters(
  input: Partial<Record<LibraryParam, unknown>>
): AdminLibraryFilters {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v)
  const uuid = (v: unknown) => {
    const value = one(v)
    return typeof value === "string" && UUID.test(value) ? value : null
  }
  const type = one(input.type)
  const category = one(input.category)
  const content = one(input.content)
  const labels = one(input.labels)
  let from = calendarDay(one(input.from)) ? (one(input.from) as string) : null
  let to = calendarDay(one(input.to)) ? (one(input.to) as string) : null
  // ISO dates compare correctly as strings.
  if (from && to && from > to) [from, to] = [to, from]
  return {
    venueId: uuid(input.venue),
    staffId: uuid(input.staff),
    type: type === "image" || type === "video" ? (type as MediaKind) : null,
    itemId: uuid(input.item),
    variantId: uuid(input.variant),
    category:
      typeof category === "string" &&
      category.length <= 80 &&
      SLUG.test(category)
        ? category
        : null,
    contentType: isContentType(content) ? content : null,
    labelState:
      labels === "labelled" || labels === "unlabelled" ? labels : null,
    query: searchText(one(input.q)),
    from,
    to,
  }
}

const LONDON = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
})

/** Europe/London's offset from UTC at `instant`, in ms (0 GMT, 3600000 BST). */
function londonOffset(instant: number): number {
  const part: Record<string, number> = {}
  for (const p of LONDON.formatToParts(new Date(instant))) {
    if (p.type !== "literal") part[p.type] = Number(p.value)
  }
  const local = Date.UTC(
    part.year,
    part.month - 1,
    part.day,
    part.hour,
    part.minute,
    part.second
  )
  return local - Math.floor(instant / 1000) * 1000
}

/** The UTC instant at which the London calendar day [y, m, d] starts. */
function londonMidnight(y: number, m: number, d: number): Date {
  const wall = Date.UTC(y, m - 1, d)
  // London midnight never falls in a clock change (they happen at 01:00 UTC),
  // so a second pass with the offset at the first guess is exact.
  const guess = wall - londonOffset(wall)
  return new Date(wall - londonOffset(guess))
}

/**
 * Inclusive Europe/London calendar days as a half-open UTC range:
 * `created_at >= start` and `created_at < end` (the start of the day after
 * `to`). Days are 23 or 25 hours long across the BST changes.
 */
export function londonDayRange(
  from: string | null,
  to: string | null
): { start: string | null; end: string | null } {
  const first = calendarDay(from)
  const last = calendarDay(to)
  return {
    start: first ? londonMidnight(...first).toISOString() : null,
    end: last
      ? londonMidnight(last[0], last[1], last[2] + 1).toISOString()
      : null,
  }
}

type Row = {
  id: string
  uploader_id: string
  media_type: MediaKind
  upload_state: MediaItemView["uploadState"]
  thumbnail_path: string | null
  preview_path: string | null
  validated_mime_type: string | null
  original_filename: string
  created_at: string
  width: number | null
  height: number | null
  duration_seconds: number | null
  size_bytes: number | null
  venue: { name: string } | null
  uploader: { display_name: string } | null
}

/** Paths of the authorised routes that sign or stream each file per request. */
export const mediaRoutes = {
  thumbnail: (id: string) => `/api/media/${id}/thumb`,
  preview: (id: string) => `/api/media/${id}/preview`,
  stream: (id: string) => `/api/media/${id}/stream`,
  download: (id: string) => `/api/media/${id}/download`,
}

/** Avatar route URL; the version query changes whenever the photo does. */
export function avatarUrl(userId: string, avatarPath: string | null) {
  if (!avatarPath) return null
  const version =
    avatarPath
      .split("/")
      .pop()
      ?.replace(/\.webp$/, "") ?? ""
  return `/api/avatars/${userId}?v=${version}`
}

function toView(row: Row): MediaItemView {
  const ready = row.upload_state === "ready"
  return {
    id: row.id,
    mediaType: row.media_type,
    uploadState: row.upload_state,
    thumbnailUrl:
      ready && row.thumbnail_path ? mediaRoutes.thumbnail(row.id) : null,
    previewUrl: !ready
      ? null
      : row.media_type === "video"
        ? mediaRoutes.stream(row.id)
        : row.preview_path
          ? mediaRoutes.preview(row.id)
          : null,
    mimeType: row.validated_mime_type,
    originalFilename: row.original_filename,
    createdAt: row.created_at,
    contributorId: row.uploader_id,
    contributorName: row.uploader?.display_name ?? "Unknown",
    venueName: row.venue?.name ?? "Unknown venue",
    width: row.width,
    height: row.height,
    durationSeconds:
      row.duration_seconds === null ? null : Number(row.duration_seconds),
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    labels: null,
  }
}

/**
 * The PostgREST calls the feed makes, shared by the table query and the
 * `library_assets` RPC query (both are filter builders over media_assets rows
 * and return themselves from every filter).
 */
type FeedQuery<Q> = {
  eq(column: string, value: string): Q
  gte(column: string, value: string): Q
  lt(column: string, value: string): Q
  or(filters: string): Q
  order(column: string, options: { ascending: boolean }): Q
  limit(count: number): PromiseLike<{ data: unknown; error: unknown }>
}

async function page<Q extends FeedQuery<Q>>(
  actor: MediaActor,
  query: Q,
  cursor: string | null | undefined
): Promise<Outcome<MediaPage>> {
  const after = decodeCursor(cursor)
  if (cursor && !after) {
    return { ok: false, status: 400, message: "Invalid page cursor." }
  }
  if (after) {
    query = query.or(
      `created_at.lt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.lt.${after.id})`
    )
  }
  const limit = MEDIA_LIMITS.pageSize
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1)
  if (error) {
    return { ok: false, status: 503, message: "Could not load media." }
  }
  const rows = (data ?? []) as Row[]
  const items = await withLabels(actor, rows.slice(0, limit).map(toView))
  const last = rows.length > limit ? rows[limit - 1] : null
  return {
    ok: true,
    items,
    nextCursor: last ? encodeCursor(last.created_at, last.id) : null,
  }
}

/**
 * Attaches label summaries read as the caller (contract A2.1): a ready asset
 * gets its summary, or EMPTY_LABEL_SUMMARY when it has none ("Needs labels");
 * an asset that is not ready keeps `null`. Labels are optional (v0.3 rule 7),
 * so a failed read (logged, redacted, by lib/server/labels) never fails the
 * page: every item keeps `labels: null` ("not loaded") instead.
 */
async function withLabels(
  actor: MediaActor,
  items: MediaItemView[]
): Promise<MediaItemView[]> {
  const ready = items.filter((item) => item.uploadState === "ready")
  if (ready.length === 0) return items
  const summaries = await tryLoadLabelSummaries(
    actor.db,
    ready.map((item) => item.id),
    { viewerId: actor.profile.id }
  )
  if (!summaries) return items
  return items.map((item) =>
    item.uploadState === "ready"
      ? { ...item, labels: summaries.get(item.id) ?? EMPTY_LABEL_SUMMARY }
      : item
  )
}

function base(db: Db) {
  return db.from("media_assets").select(SELECT).is("deleted_at", null)
}

/** The staff member's own portfolio: every technical state, newest first. */
export function listOwnMedia(
  actor: MediaActor,
  cursor?: string | null
): Promise<Outcome<MediaPage>> {
  if (actor.profile.role !== "staff") {
    return Promise.resolve({ ok: false, status: 403, message: "Staff only." })
  }
  return page(actor, base(actor.db).eq("uploader_id", actor.profile.id), cursor)
}

/** True when a filter needs the `library_assets` label predicates. */
export function hasLabelPredicates(filters: Partial<LibraryLabelFilters>) {
  return Boolean(
    filters.itemId ||
    filters.variantId ||
    filters.category ||
    filters.contentType ||
    filters.labelState ||
    filters.query
  )
}

/**
 * The admin library: ready assets across all venues, filtered server-side.
 * RLS repeats the admin/ready/non-deleted rules; the explicit predicates also
 * match the partial feed indexes.
 *
 * Label filters go through `library_assets` (an inlined SQL function that adds
 * EXISTS predicates to media_assets, so an asset matching several label items
 * still appears once); without them the plain table query is used, keeping
 * the unfiltered feed on its proven index plan. Either way the venue, staff,
 * type, date range, strict (created_at, id) cursor, order and page size are
 * the same PostgREST filters on the same rows.
 */
export function listLibrary(
  actor: MediaActor,
  filters: LibraryFilters & Partial<LibraryLabelFilters>,
  cursor?: string | null
): Promise<Outcome<MediaPage>> {
  if (actor.profile.role !== "admin") {
    return Promise.resolve({ ok: false, status: 403, message: "Admin only." })
  }
  const label = { ...NO_LABEL_FILTERS, ...filters }
  const query = hasLabelPredicates(label)
    ? actor.db
        .rpc("library_assets", {
          ...(label.itemId ? { p_item: label.itemId } : {}),
          ...(label.variantId ? { p_variant: label.variantId } : {}),
          ...(label.category ? { p_category: label.category } : {}),
          ...(label.contentType ? { p_content_type: label.contentType } : {}),
          ...(label.labelState ? { p_label_state: label.labelState } : {}),
          ...(label.query ? { p_query: label.query } : {}),
        })
        // created_at and id are in SELECT, as PostgREST needs for the cursor
        // and order over an RPC result (contract A2.3).
        .select(SELECT)
        .is("deleted_at", null)
    : base(actor.db)
  return page(actor, feedFilters(query, label), cursor)
}

function feedFilters<Q extends FeedQuery<Q>>(
  query: Q,
  filters: AdminLibraryFilters
): Q {
  let next = query.eq("upload_state", "ready")
  if (filters.venueId) next = next.eq("venue_id", filters.venueId)
  if (filters.staffId) next = next.eq("uploader_id", filters.staffId)
  if (filters.type) next = next.eq("media_type", filters.type)
  const range = londonDayRange(filters.from, filters.to)
  if (range.start) next = next.gte("created_at", range.start)
  if (range.end) next = next.lt("created_at", range.end)
  return next
}

/** Filter options for the admin library: every venue and every staff member. */
export async function libraryFilterOptions(actor: MediaActor) {
  if (actor.profile.role !== "admin") return { venues: [], staff: [] }
  const [venues, staff] = await Promise.all([
    actor.db.from("venues").select("id, name").order("name"),
    actor.db
      .from("profiles")
      .select("id, display_name")
      .eq("role", "staff")
      .order("display_name"),
  ])
  return {
    // Inactive venues and staff keep their retained media, so they stay listed.
    venues: (venues.data ?? []).map((v) => ({ id: v.id, name: v.name })),
    staff: (staff.data ?? []).map((p) => ({
      id: p.id,
      name: p.display_name,
    })),
  }
}
