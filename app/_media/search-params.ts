// URL codec of the asset search screen (B05-06). Client-safe: no server-only
// imports. The keys are exactly the service's SEARCH_FILTER_KEYS; the server
// repeats every check and answers bad values with field errors.

import {
  SEARCH_FILTER_KEYS,
  type SearchFilterKey,
} from "@/lib/server/media/search/types"

/** The screen's filters as URL strings; null means no filter. */
export type SearchFilterValue = Record<SearchFilterKey, string | null>

export const EMPTY_SEARCH_FILTERS: SearchFilterValue = Object.fromEntries(
  SEARCH_FILTER_KEYS.map((key) => [key, null])
) as SearchFilterValue

/** Who the screen is for: managers never send `venue` (it is implicit). */
export type SearchMode = "admin" | "manager"

type ParamSource =
  URLSearchParams | Record<string, string | string[] | undefined | null>

function read(source: ParamSource, key: string): string | null {
  const raw =
    source instanceof URLSearchParams
      ? source.get(key)
      : Array.isArray(source[key])
        ? (source[key] as string[])[0]
        : (source[key] as string | undefined | null)
  return typeof raw === "string" && raw !== "" ? raw : null
}

/** URL params -> filters. Unknown keys are ignored; "" is no filter. */
export function searchToFilters(source: ParamSource): SearchFilterValue {
  const filters = { ...EMPTY_SEARCH_FILTERS }
  for (const key of SEARCH_FILTER_KEYS) filters[key] = read(source, key)
  return filters
}

/**
 * Filters -> a canonical query string, in SEARCH_FILTER_KEYS order, so equal
 * filters give an equal string (the result list is keyed by it). A place of
 * use narrows photos in use only, so it is dropped without `rights=in_force`;
 * a manager's venue is implicit, so `venue` is dropped for managers.
 */
export function filtersToSearch(
  filters: Partial<SearchFilterValue>,
  mode: SearchMode = "admin"
): string {
  const params = new URLSearchParams()
  for (const key of SEARCH_FILTER_KEYS) {
    const value = filters[key]
    if (!value) continue
    if (key === "venue" && mode !== "admin") continue
    if (key === "destination" && filters.rights !== "in_force") continue
    if (key === "answerUse" && !filters.answerFreshness) continue
    params.set(key, value)
  }
  return params.toString()
}

/**
 * The filters the screen actually searches with: the canonical query read
 * back (a place of use without `rights=in_force` dropped). `venue` is kept in
 * every mode, so a manager's stray venue still reaches the database and is
 * refused there. Page one, the list key and Show more all use these.
 */
export function canonicalFilters(
  filters: Partial<SearchFilterValue>
): SearchFilterValue {
  return searchToFilters(new URLSearchParams(filtersToSearch(filters, "admin")))
}

/**
 * `submission=<source>:<uuid>` -> `{ source, id }`, split at the first ":".
 * Anything else is passed through unchanged so the server answers with
 * `fieldErrors.submission`.
 */
export function decodeSubmission(
  value: string
): { source: string; id: string } | string {
  const at = value.indexOf(":")
  if (at <= 0 || at === value.length - 1) return value
  return { source: value.slice(0, at), id: value.slice(at + 1) }
}

/** The service's `filters` object for the given URL filters. */
export function toServiceFilters(
  filters: Partial<SearchFilterValue>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of SEARCH_FILTER_KEYS) {
    const value = filters[key]
    if (!value) continue
    out[key] = key === "submission" ? decodeSubmission(value) : value
  }
  return out
}

/** How many filters are on (the shown count of a filter set). */
export function countSearchFilters(
  filters: Partial<SearchFilterValue>,
  mode: SearchMode = "admin"
): number {
  return new URLSearchParams(filtersToSearch(filters, mode)).size
}
