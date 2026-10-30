import type { LibraryFilterValue } from "@/components/nabalens"
import type { LibraryLabelFilters } from "@/lib/menus/types"
import type { LibraryFilters } from "@/lib/server/media/types"

/** The admin library's URL search params (LIBRARY_PARAMS on the server). */
export type LibrarySearchParams = {
  venue?: string
  staff?: string
  type?: string
  item?: string
  variant?: string
  category?: string
  content?: string
  labels?: string
  q?: string
  from?: string
  to?: string
}

/**
 * Admin library filters -> URL search params, in one fixed order so equal
 * filters give an equal string (the gallery is keyed by it). The server reads
 * them back with parseLibraryFilters (lib/server/media/library).
 */
export function filtersToParams(
  filters: LibraryFilterValue
): LibrarySearchParams {
  const params: LibrarySearchParams = {}
  if (filters.venueId) params.venue = filters.venueId
  if (filters.staffId) params.staff = filters.staffId
  if (filters.type !== "all") params.type = filters.type
  if (filters.itemId) params.item = filters.itemId
  if (filters.variantId) params.variant = filters.variantId
  if (filters.category) params.category = filters.category
  if (filters.contentType) params.content = filters.contentType
  if (filters.labelState) params.labels = filters.labelState
  if (filters.query) params.q = filters.query
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  return params
}

export function filtersToSearch(filters: LibraryFilterValue): string {
  return new URLSearchParams(filtersToParams(filters)).toString()
}

/** Parsed server filters -> the filter controls' value. */
export function toFilterValue(
  filters: LibraryFilters & LibraryLabelFilters
): Required<LibraryFilterValue> {
  return { ...filters, type: filters.type ?? "all" }
}
