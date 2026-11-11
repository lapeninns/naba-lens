// B05-m4 asset search (contracts/b05-design.md §6; build scope
// contracts/b05-m4-build-scope.md). The database owns every rule; these lists
// only give early field errors and type the RPCs until lib/db/types.ts is
// regenerated with B05-m4.

import type { MediaKind } from "@/lib/server/media/types"
import type { AssetUseState, UseGrantState } from "@/lib/server/media/use"

/** Own page limits (not MEDIA_LIMITS.pageSize): at most 48 rows a page. */
export const ASSET_SEARCH_PAGE = { default: 24, max: 48 } as const

export const SEARCH_MEDIA_TYPES = ["image", "video"] as const

/** Asset-level rights. `in_force` is the asset use state `granted`. */
export const SEARCH_RIGHTS = [
  "legacy_unknown",
  "not_granted",
  "in_force",
  "expired",
  "withdrawn",
] as const
export type SearchRights = (typeof SEARCH_RIGHTS)[number]

export const SUBMISSION_SOURCES = ["coverage", "amenity", "knowledge"] as const
export type SubmissionSource = (typeof SUBMISSION_SOURCES)[number]

/** `menu_item_photos.state`: today's menu decision state only. */
export const MENU_DECISION_STATES = [
  "accepted",
  "better_photo_requested",
  "needs_recheck",
  "withdrawn",
  "invalidated",
] as const
export type MenuDecisionState = (typeof MENU_DECISION_STATES)[number]

/** Every filter key the search accepts; any other key is refused. */
export const SEARCH_FILTER_KEYS = [
  "venue",
  "mediaType",
  "item",
  "variant",
  "check",
  "group",
  "submission",
  "rights",
  "destination",
  "uploadedFrom",
  "uploadedTo",
  "menuState",
] as const
export type SearchFilterKey = (typeof SEARCH_FILTER_KEYS)[number]

/**
 * Parsed filters. Upload days are Europe/London calendar days (YYYY-MM-DD)
 * and filter on upload time (`created_at`), never on observation time.
 */
export type AssetSearchFilters = {
  venue?: string
  mediaType?: MediaKind
  item?: string
  variant?: string
  check?: string
  group?: string
  submission?: { source: SubmissionSource; id: string }
  rights?: SearchRights
  destination?: string
  uploadedFrom?: string
  uploadedTo?: string
  menuState?: MenuDecisionState
}

/** The `p_filters` object sent to the database (upload days as instants). */
export type AssetSearchDbFilters = Omit<
  AssetSearchFilters,
  "uploadedFrom" | "uploadedTo"
> & {
  uploadedFrom?: string
  uploadedBefore?: string
}

export type SearchMenuItem = {
  itemId: string
  variantId: string | null
  itemName: string
  variantName: string | null
}

export type SearchUseSummary = {
  state: AssetUseState
  inForce: number
  withdrawn: number
  destinations: {
    destinationKey: string
    label: string
    state: UseGrantState
    until: string | null
  }[]
}

export type SearchMenuDecision = SearchMenuItem & {
  state: MenuDecisionState
  isPrimary: boolean
  basis: "staff_label" | "reviewer"
}

export type SearchSubjects = {
  menuItems: SearchMenuItem[]
  /** Question/check links through evidence; no answer roles (B03). */
  checks: {
    checkId: string
    questionKey: string
    source: "amenity" | "knowledge"
  }[]
  tasks: { requirementId: string | null; submissionId: string }[]
  group: {
    kind: "menu_item" | "task" | "question" | "none"
    id: string | null
  } | null
}

/** One row as the database returns it. */
export type AssetSearchRow = {
  id: string
  mediaType: MediaKind
  hasThumbnail: boolean
  venueName: string
  uploaderFirstName: string | null
  uploadedAt: string
  groupId: string | null
  subjects: SearchSubjects
  use: SearchUseSummary
  menuDecisions: SearchMenuDecision[]
}

/** One result: a single original asset id with its route and summaries. */
export type AssetSearchItem = Omit<AssetSearchRow, "hasThumbnail"> & {
  /** Authorised route that signs a short-lived URL per request. */
  thumbnailUrl: string | null
}

export type AssetSearchPage = {
  items: AssetSearchItem[]
  nextCursor: string | null
}

export type SearchRpcs = {
  asset_search: {
    args: {
      p_filters: AssetSearchDbFilters
      p_after_created_at: string | null
      p_after_id: string | null
      p_limit: number
    }
    returns: { hasMore: boolean; items: AssetSearchRow[] }
  }
  asset_search_can_open: {
    args: { p_asset_id: string }
    returns: boolean
  }
}
export type SearchRpcName = keyof SearchRpcs

export type SearchErrorCode =
  "not_permitted" | "not_found" | "invalid_input" | "unavailable"

/** An expected refusal, in the lib/server/media Outcome shape plus a code. */
export type SearchFailure = {
  ok: false
  status: 400 | 403 | 404 | 503
  code: SearchErrorCode
  message: string
  fieldErrors?: Partial<Record<string, string>>
}

export type SearchResult<T> = ({ ok: true } & T) | SearchFailure
