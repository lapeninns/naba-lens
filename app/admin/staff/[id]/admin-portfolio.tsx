"use client"

import * as React from "react"

import { fetchMediaPage } from "@/app/_media/fetch-page"
import { MediaGallery } from "@/app/_media/media-gallery"
import { loadLibraryPage } from "@/app/admin/library-actions"
import { EmptyState } from "@/components/nabalens"
import type { MediaPage } from "@/lib/server/media/types"

const REFRESH_MS = 15_000

/**
 * One staff member's portfolio as admin sees it: the admin library filtered to
 * that contributor, through the same gallery as /admin and /staff, so preview,
 * download, delete, refresh and preview recovery behave identically.
 */
export function AdminPortfolio({
  staffId,
  staffName,
  initialPage,
}: {
  staffId: string
  staffName: string
  initialPage: MediaPage
}) {
  const loadPage = React.useCallback(
    (cursor: string | null) => loadLibraryPage({ staff: staffId }, cursor),
    [staffId]
  )
  const refreshPage = React.useCallback(
    (signal: AbortSignal) =>
      fetchMediaPage("/api/library", { staff: staffId }, signal),
    [staffId]
  )
  return (
    <MediaGallery
      label={`${staffName}'s portfolio`}
      initialPage={initialPage}
      loadPage={loadPage}
      refreshPage={refreshPage}
      showAttribution
      canDelete
      refreshIntervalMs={REFRESH_MS}
      getDownloadHref={(item) => `/api/media/${item.id}/download`}
      empty={
        <EmptyState
          title={`${staffName} has no uploads yet`}
          description="Their photos and videos appear here once they finish processing."
        />
      }
    />
  )
}
