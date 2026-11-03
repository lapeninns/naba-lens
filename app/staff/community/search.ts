import { DEPARTMENT_OPTIONS, type Department } from "@/lib/config/departments"
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

export type PhotoFilters = ReturnType<typeof communityFilters>

/** Team names on Photos; the directory keeps the "(FOH)" form. */
export const TEAM_NAME: Record<Department, string> = {
  foh: "Front of house",
  boh: "Back of house",
}

export const TEAM_OPTIONS = DEPARTMENT_OPTIONS.map((option) => ({
  id: option.id,
  name: TEAM_NAME[option.id],
}))

export function activeFilterCount(filters: PhotoFilters): number {
  return [filters.venueId, filters.mediaType, filters.department].filter(
    Boolean
  ).length
}

/** "Showing photos from Back of house at The Railway" */
function describeFilters(filters: PhotoFilters, venueName: string | null) {
  const media =
    filters.mediaType === "image"
      ? "photos"
      : filters.mediaType === "video"
        ? "videos"
        : "photos and videos"
  const team = filters.department ? TEAM_NAME[filters.department] : "all teams"
  const venue = filters.venueId ? (venueName ?? "all venues") : "all venues"
  return `Showing ${media} from ${team} at ${venue}`
}

/** The filtered-view notice; null while no filter is on. */
export function filterSummary(
  filters: PhotoFilters,
  venueName: string | null
): string | null {
  if (activeFilterCount(filters) === 0) return null
  return `${describeFilters(filters, venueName)}, newest first.`
}

/**
 * Why nothing matched and what to widen. Team and venue are offered first;
 * the media type only when it is the one filter on.
 */
export function nothingMatches(
  filters: PhotoFilters,
  venueName: string | null
): string {
  const wider = [
    filters.department ? "all teams" : null,
    filters.venueId ? "all venues" : null,
  ].filter((part): part is string => part !== null)
  if (wider.length === 0 && filters.mediaType) wider.push("photos and videos")
  const tryWider = wider.length > 0 ? ` Try ${wider.join(", or ")}.` : ""
  return `${describeFilters(filters, venueName)}.${tryWider}`
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
