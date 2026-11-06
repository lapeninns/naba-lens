"use client"

import * as React from "react"

import { MediaGallery } from "@/app/_media/media-gallery"
import { EmptyState } from "@/components/nabalens/empty-state"
import { useAddRefreshSignal } from "@/components/nabalens/shell/add-context"
import type { MediaPage } from "@/lib/server/media/types"

import { loadCommunityPage } from "./actions"
import type { CommunitySearch } from "./search"

function showingCount(shown: number) {
  return (
    <p className="text-meta-touch text-ink-muted tabular-nums md:text-meta">
      Showing {shown}, newest first
    </p>
  )
}

export function CommunityGallery({
  initialPage,
  search,
  uploaderId,
  empty,
  showCount = false,
}: {
  initialPage: MediaPage
  search: CommunitySearch
  uploaderId?: string
  /** Replaces the default empty state, e.g. "Nothing matches these filters." */
  empty?: React.ReactNode
  /** "Showing 24, newest first" above the grid. */
  showCount?: boolean
}) {
  const refreshSignal = useAddRefreshSignal()
  const loadPage = React.useCallback(
    (cursor: string | null) => loadCommunityPage(search, cursor, uploaderId),
    [search, uploaderId]
  )
  return (
    <MediaGallery
      label={uploaderId ? "Shared photos" : "Organization portfolio"}
      initialPage={initialPage}
      loadPage={loadPage}
      refreshSignal={uploaderId ? undefined : refreshSignal}
      showAttribution
      getPortfolioHref={(item) => `/staff/people/${item.contributorId}`}
      summary={showCount ? showingCount : undefined}
      empty={
        empty ?? (
          <EmptyState
            title={
              uploaderId
                ? "No portfolio uploads yet."
                : "No uploads to show yet."
            }
            description={
              uploaderId
                ? "Photos and videos appear here when they are ready."
                : "Try another venue or media type. Ready photos and videos from your colleagues appear here."
            }
          />
        )
      }
    />
  )
}
