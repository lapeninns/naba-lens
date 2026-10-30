import type { LibraryFilterValue } from "@/components/nabalens"

/**
 * Admin library filters <-> URL search params (`venue`, `staff`, `type`). The
 * server side reads them back with parseLibraryFilters (lib/server/media/library).
 */
export function filtersToSearch(filters: LibraryFilterValue): string {
  const params = new URLSearchParams()
  if (filters.venueId) params.set("venue", filters.venueId)
  if (filters.staffId) params.set("staff", filters.staffId)
  if (filters.type !== "all") params.set("type", filters.type)
  return params.toString()
}
