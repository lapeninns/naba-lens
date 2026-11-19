"use client"

import * as React from "react"

import { MediaGallery } from "@/app/_media/media-gallery"
import { EmptyState } from "@/components/nabalens/empty-state"
import type { MediaPage } from "@/lib/server/media/types"

import { loadCommunityPage } from "./actions"
import type { CommunitySearch } from "./search"

export function CommunityGallery({
  initialPage,
  search,
  uploaderId,
}: {
  initialPage: MediaPage
  search: CommunitySearch
  uploaderId?: string
}) {
  const loadPage = React.useCallback(
    (cursor: string | null) => loadCommunityPage(search, cursor, uploaderId),
    [search, uploaderId]
  )
  return (
    <MediaGallery
      label={uploaderId ? "Colleague portfolio" : "Organization portfolio"}
      initialPage={initialPage}
      loadPage={loadPage}
      showAttribution
      getPortfolioHref={(item) => `/staff/people/${item.contributorId}`}
      empty={
        <EmptyState
          title={
            uploaderId ? "No portfolio uploads yet." : "No uploads to show yet."
          }
          description={
            uploaderId
              ? "Photos and videos appear here when they are ready."
              : "Try another venue or media type. Ready photos and videos from your colleagues appear here."
          }
        />
      }
    />
  )
}
