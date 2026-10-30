import { MEDIA_LIMITS } from "@/lib/config/media"

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

/** Normalises untrusted filter input (URL search params or a client call). */
export function parseLibraryFilters(input: {
  venue?: unknown
  staff?: unknown
  type?: unknown
}): LibraryFilters {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v)
  const venue = one(input.venue)
  const staff = one(input.staff)
  const type = one(input.type)
  return {
    venueId: typeof venue === "string" && UUID.test(venue) ? venue : null,
    staffId: typeof staff === "string" && UUID.test(staff) ? staff : null,
    type: type === "image" || type === "video" ? (type as MediaKind) : null,
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

async function page(
  db: Db,
  apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>,
  cursor: string | null | undefined
): Promise<Outcome<MediaPage>> {
  const after = decodeCursor(cursor)
  if (cursor && !after) {
    return { ok: false, status: 400, message: "Invalid page cursor." }
  }
  let query = apply(base(db))
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
  const rows = (data ?? []) as unknown as Row[]
  const items = rows.slice(0, limit).map(toView)
  const last = rows.length > limit ? rows[limit - 1] : null
  return {
    ok: true,
    items,
    nextCursor: last ? encodeCursor(last.created_at, last.id) : null,
  }
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
  return page(actor.db, (q) => q.eq("uploader_id", actor.profile.id), cursor)
}

/**
 * The admin library: ready assets across all venues, filtered server-side.
 * RLS repeats the admin/ready/non-deleted rules; the explicit predicates also
 * match the partial feed indexes.
 */
export function listLibrary(
  actor: MediaActor,
  filters: LibraryFilters,
  cursor?: string | null
): Promise<Outcome<MediaPage>> {
  if (actor.profile.role !== "admin") {
    return Promise.resolve({ ok: false, status: 403, message: "Admin only." })
  }
  return page(
    actor.db,
    (q) => {
      let next = q.eq("upload_state", "ready")
      if (filters.venueId) next = next.eq("venue_id", filters.venueId)
      if (filters.staffId) next = next.eq("uploader_id", filters.staffId)
      if (filters.type) next = next.eq("media_type", filters.type)
      return next
    },
    cursor
  )
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
