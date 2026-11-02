import type { MediaKind } from "@/lib/server/media/types"

export type CommunitySearch = Record<string, string | string[] | undefined>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function searchValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : ""
}

export function communityFilters(search: CommunitySearch): {
  venueId: string | null
  mediaType: MediaKind | null
  department: "foh" | "boh" | null
} {
  const type = searchValue(search.type)
  const venue = searchValue(search.venue)
  return {
    venueId: UUID.test(venue) ? venue : null,
    mediaType:
      type === "image" || type === "video" ? (type as MediaKind) : null,
    department:
      search.department === "foh" || search.department === "boh"
        ? search.department
        : null,
  }
}

export function communityQuery(filters: {
  venueId?: string | null
  mediaType?: MediaKind | null
  department?: "foh" | "boh" | null
}) {
  const query = new URLSearchParams()
  if (filters.venueId) query.set("venue", filters.venueId)
  if (filters.mediaType) query.set("type", filters.mediaType)
  if (filters.department) query.set("department", filters.department)
  return query.toString()
}
