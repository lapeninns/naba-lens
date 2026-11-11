import type {
  AssetSearchPage,
  SearchErrorCode,
} from "@/lib/server/media/search/types"

/** A failed page as the screen sees it (service failure or route-level). */
export type SearchPageFailure = {
  ok: false
  /** 0 when no reply came (offline, aborted or a broken body). */
  status: number
  code: SearchErrorCode | "signed_out" | "no_reply"
  message: string
  fieldErrors?: Partial<Record<string, string>>
}

export type SearchPageResult =
  { ok: true; page: AssetSearchPage } | SearchPageFailure

export type SearchOption = { id: string; name: string }

/** One venue's menu choices for the Menu item and Option filters. */
export type SearchMenuOptions = {
  venueId: string
  items: {
    id: string
    name: string
    sectionName: string | null
    variants: SearchOption[]
  }[]
}
