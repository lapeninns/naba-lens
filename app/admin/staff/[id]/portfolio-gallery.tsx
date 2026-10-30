"use client"

import * as React from "react"

import {
  EmptyState,
  LoadMoreButton,
  MediaGrid,
  MediaViewer,
  type MediaItem,
} from "@/components/nabalens"

import { loadMorePortfolioAction } from "../actions"

/**
 * One staff member's portfolio as admin sees it, built from the shared gallery
 * components. Preview only for now: download and delete are wired by the slice
 * and lifecycle tracks through the same MediaViewer props.
 */
export function PortfolioGallery({
  staffId,
  staffName,
  initialItems,
  initialCursor,
}: {
  staffId: string
  staffName: string
  initialItems: MediaItem[]
  initialCursor: string | null
}) {
  const [items, setItems] = React.useState(initialItems)
  const [cursor, setCursor] = React.useState(initialCursor)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState<MediaItem | null>(null)

  async function loadMore() {
    if (!cursor) return
    setLoading(true)
    setError(null)
    try {
      const result = await loadMorePortfolioAction(staffId, cursor)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setItems((current) => {
        const seen = new Set(current.map((i) => i.id))
        return [...current, ...result.items.filter((i) => !seen.has(i.id))]
      })
      setCursor(result.nextCursor)
    } catch {
      setError("More media could not be loaded. Try again.")
    } finally {
      setLoading(false)
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title={`${staffName} has no uploads yet`}
        description="Their photos and videos appear here once they finish processing."
      />
    )
  }

  return (
    <>
      <MediaGrid
        items={items}
        onOpen={setOpen}
        label={`${staffName}'s portfolio`}
      />
      <LoadMoreButton
        hasMore={!!cursor}
        loading={loading}
        error={error}
        onLoadMore={loadMore}
        shownCount={items.length}
      />
      <MediaViewer
        item={open}
        open={!!open}
        onOpenChange={(next) => {
          if (!next) setOpen(null)
        }}
        showAttribution
      />
    </>
  )
}
