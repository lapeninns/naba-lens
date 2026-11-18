"use client"

import { venueHistoryAction } from "@/app/manager/venue/actions"
import type { HistoryCursor, VenueHistoryItem } from "@/lib/manager/venue"

import { VenueHistoryList } from "./venue-history-list"

/** The History page's list with "Show older changes" (S2-MGR). */
export function VenueHistoryPager({
  items,
  nextCursor,
  source,
}: {
  items: VenueHistoryItem[]
  nextCursor: HistoryCursor | null
  source: string | null
}) {
  return (
    <VenueHistoryList
      items={items}
      nextCursor={nextCursor}
      loadMore={(cursor) =>
        venueHistoryAction({ source: source ?? undefined, before: cursor })
      }
    />
  )
}
