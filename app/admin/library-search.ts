import type { LibraryFilterValue } from "@/components/nabalens"
import {
  extraFiltersToParams,
  type ExtraSearchParams,
  type LibraryExtraFilters,
} from "@/lib/library/model"
import type { LibraryLabelFilters } from "@/lib/menus/types"
import type { LibraryFilters } from "@/lib/server/media/types"

/** The admin library's URL search params (ADMIN_LIBRARY_PARAMS on the server). */
export type LibrarySearchParams = ExtraSearchParams & {
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
  filters: LibraryFilterValue,
  extra?: LibraryExtraFilters
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
  // The A4 filters (S2-LIBRARY) after the others, in their own fixed order.
  return extra ? { ...params, ...extraFiltersToParams(extra) } : params
}

export function filtersToSearch(
  filters: LibraryFilterValue,
  extra?: LibraryExtraFilters
): string {
  return new URLSearchParams(
    filtersToParams(filters, extra) as Record<string, string>
  ).toString()
}

/** Parsed server filters -> the filter controls' value. */
export function toFilterValue(
  filters: LibraryFilters & LibraryLabelFilters
): Required<LibraryFilterValue> {
  return { ...filters, type: filters.type ?? "all" }
}
