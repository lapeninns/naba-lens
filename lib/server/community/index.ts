import "server-only"

import { MEDIA_LIMITS } from "@/lib/config/media"
import { isDepartment, type Department } from "@/lib/config/departments"
import {
  avatarUrl,
  decodeCursor,
  encodeCursor,
  mediaRoutes,
} from "@/lib/server/media/library"
import type {
  MediaActor,
  MediaKind,
  MediaPage,
  Outcome,
} from "@/lib/server/media/types"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type CommunityDepartment = Department
export type CommunityMember = {
  id: string
  displayName: string
  jobTitle: string | null
  department: CommunityDepartment | null
  venueId: string | null
  venueName: string | null
  avatarUrl: string | null
  mediaCount: number
}
export type CommunityMemberFilters = {
  search?: string | null
  venueId?: string | null
  department?: CommunityDepartment | null
  offset?: number
  limit?: number
}
export type CommunityMediaFilters = {
  venueId?: string | null
  uploaderId?: string | null
  department?: CommunityDepartment | null
  mediaType?: MediaKind | null
}

const forbidden = {
  ok: false,
  status: 403,
  message: "Your account is not active.",
} as const
const invalid = {
  ok: false,
  status: 400,
  message: "Invalid community filters.",
} as const
const unavailable = {
  ok: false,
  status: 503,
  message: "Could not load the community. Try again.",
} as const
function validId(id: string | null | undefined) {
  return !id || UUID.test(id)
}
function validDepartment(value: unknown) {
  return value == null || isDepartment(value)
}
function active(actor: MediaActor) {
  return (
    actor.profile.active &&
    (actor.profile.role === "staff" || actor.profile.role === "admin")
  )
}

type MemberRow = {
  id: string
  display_name: string
  job_title: string | null
  department: string | null
  venue_id: string | null
  venue_name: string | null
  avatar_path: string | null
  media_count: number
}
function memberView(row: MemberRow): CommunityMember {
  return {
    id: row.id,
    displayName: row.display_name,
    jobTitle: row.job_title,
    department: isDepartment(row.department) ? row.department : null,
    venueId: row.venue_id,
    venueName: row.venue_name,
    avatarUrl: avatarUrl(row.id, row.avatar_path),
    mediaCount: Number(row.media_count),
  }
}

/** Safe organization profile projection. Account-management fields never leave this RPC. */
export async function listCommunityMembers(
  actor: MediaActor,
  filters: CommunityMemberFilters = {}
): Promise<Outcome<{ members: CommunityMember[]; nextOffset: number | null }>> {
  if (!active(actor)) return forbidden
  if (!validId(filters.venueId) || !validDepartment(filters.department))
    return invalid
  const search = filters.search?.trim() ?? ""
  if (search.length > 80) return invalid
  const offset = filters.offset ?? 0
  const limit = filters.limit ?? 24
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 100000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    return invalid
  const { data, error } = await actor.db.rpc("community_members", {
    ...(filters.venueId ? { p_venue: filters.venueId } : {}),
    ...(filters.department ? { p_department: filters.department } : {}),
    ...(search ? { p_query: search } : {}),
    p_limit: limit + 1,
    p_offset: offset,
  })
  if (error) return unavailable
  const rows = data ?? []
  return {
    ok: true,
    members: rows.slice(0, limit).map(memberView),
    nextOffset:
      rows.length > limit && offset + limit <= 100000 ? offset + limit : null,
  }
}

export async function getCommunityMember(
  actor: MediaActor,
  userId: string
): Promise<Outcome<{ member: CommunityMember }>> {
  if (!active(actor)) return forbidden
  if (!UUID.test(userId))
    return { ok: false, status: 404, message: "Not found." }
  const { data, error } = await actor.db.rpc("community_members", {
    p_member: userId,
    p_limit: 1,
  })
  if (error) return unavailable
  if (!data?.[0]) return { ok: false, status: 404, message: "Not found." }
  return { ok: true, member: memberView(data[0]) }
}

export async function listCommunityVenues(
  actor: MediaActor
): Promise<Outcome<{ venues: { id: string; name: string }[] }>> {
  if (!active(actor)) return forbidden
  const { data, error } = await actor.db
    .from("venues")
    .select("id, name")
    .eq("active", true)
    .order("name")
  return error ? unavailable : { ok: true, venues: data ?? [] }
}

/** Ready assets only; use stable cursor pagination and authorize every media route again. */
export async function listCommunityMedia(
  actor: MediaActor,
  filters: CommunityMediaFilters = {},
  cursor?: string | null
): Promise<Outcome<MediaPage>> {
  if (!active(actor)) return forbidden
  if (
    !validId(filters.venueId) ||
    !validId(filters.uploaderId) ||
    !validDepartment(filters.department) ||
    (filters.mediaType != null &&
      filters.mediaType !== "image" &&
      filters.mediaType !== "video")
  )
    return invalid
  const after = decodeCursor(cursor)
  if (cursor && !after)
    return { ok: false, status: 400, message: "Invalid page cursor." }
  const limit = MEDIA_LIMITS.pageSize
  const { data, error } = await actor.db.rpc("community_media_page", {
    ...(filters.venueId ? { p_venue: filters.venueId } : {}),
    ...(filters.uploaderId ? { p_uploader: filters.uploaderId } : {}),
    ...(filters.mediaType ? { p_type: filters.mediaType } : {}),
    ...(filters.department ? { p_department: filters.department } : {}),
    ...(after
      ? { p_after_created_at: after.createdAt, p_after_id: after.id }
      : {}),
    p_limit: limit + 1,
  })
  if (error) return unavailable
  const rows = data ?? []
  const last = rows.length > limit ? rows[limit - 1] : null
  return {
    ok: true,
    items: rows.slice(0, limit).map((row) => ({
      id: row.id,
      mediaType: row.media_type,
      uploadState: "ready",
      thumbnailUrl: row.has_thumbnail ? mediaRoutes.thumbnail(row.id) : null,
      previewUrl:
        row.media_type === "video"
          ? mediaRoutes.stream(row.id)
          : row.has_preview
            ? mediaRoutes.preview(row.id)
            : null,
      mimeType: row.validated_mime_type,
      // Colleagues never see the uploader's original filename.
      originalFilename: null,
      createdAt: row.created_at,
      contributorId: row.uploader_id,
      contributorName: row.contributor_name,
      venueName: row.venue_name,
      width: row.width,
      height: row.height,
      durationSeconds:
        row.duration_seconds == null ? null : Number(row.duration_seconds),
      sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      // Catalog and label edit permissions stay separate from community viewing.
      labels: null,
    })),
    nextCursor: last ? encodeCursor(last.created_at, last.id) : null,
  }
}
