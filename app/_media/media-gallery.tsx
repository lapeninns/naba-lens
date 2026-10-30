"use client"

import * as React from "react"

import { LabelEditorHost } from "@/app/_labels/label-editor-host"
import {
  ConfirmDeleteDialog,
  LoadMoreButton,
  MediaGrid,
  MediaViewer,
  type MediaItem,
} from "@/components/nabalens"
import { Button } from "@/components/ui/button"
import type { MediaPage } from "@/lib/server/media/types"

import { deleteMedia } from "./actions"
import { usePreviewRecovery } from "./preview-recovery"

export type LoadPage = (
  cursor: string | null
) => Promise<{ ok: true; page: MediaPage } | { ok: false; message: string }>

/** A fresh cursor page for the foreground refresh; must honour `signal`. */
export type RefreshPage = (
  signal: AbortSignal,
  cursor?: string | null
) => Promise<{ ok: true; page: MediaPage } | { ok: false; message: string }>

type MediaGalleryProps = {
  /** Accessible name of the grid. */
  label: string
  initialPage: MediaPage
  loadPage: LoadPage
  /**
   * Foreground refresh (interval, focus, refreshSignal). Pass an abortable GET
   * (fetchMediaPage): a Server Function cannot be cancelled and runs in Next's
   * one-at-a-time action queue, ahead of later uploads. Without it, refresh
   * uses `loadPage(cursor)` and waits for each call to settle before the next.
   */
  refreshPage?: RefreshPage
  /** Shown when there is nothing to list. */
  empty: React.ReactNode
  showAttribution?: boolean
  getDownloadHref?: (item: MediaItem) => string
  getPortfolioHref?: (item: MediaItem) => string
  canDelete?: boolean
  /**
   * Foreground refresh interval in ms (admin library: ~15 s). Paused while the
   * tab is hidden; the tab regaining focus refreshes at once.
   */
  refreshIntervalMs?: number
  /** Change this value to refresh now (for example after an upload). */
  refreshSignal?: number
  /**
   * v0.3 optional labels: "Add/Edit labels" in the viewer for ready files
   * (staff: own files; admin: any). The server re-checks every save.
   */
  canLabel?: boolean
  /** Small labels badge on ready tiles (staff portfolio). */
  showLabelBadge?: boolean
}

/**
 * A foreground refresh that has not answered by now is aborted and reported as
 * failed; a late result is ignored. The next refresh starts only once the
 * request has actually ended, so refreshes never pile up behind a slow server.
 */
export const REFRESH_TIMEOUT_MS = 10_000

const REFRESH_FAILED = "Could not refresh. Check your connection."

/** True once a descending (created_at, id) page reaches the old range's end. */
function reachesBoundary(item: MediaItem, boundary: MediaItem) {
  return (
    item.createdAt < boundary.createdAt ||
    (item.createdAt === boundary.createdAt && item.id <= boundary.id)
  )
}

/**
 * Why a download of `href` fails, or null when it works. A native download
 * gives the page no signal, so the gallery asks for the first byte of the same
 * route alongside it (same authorisation, same storage read, 1 byte).
 */
export async function probeDownload(href: string): Promise<string | null> {
  let response: Response
  try {
    response = await fetch(href, {
      headers: { range: "bytes=0-0" },
      cache: "no-store",
    })
  } catch {
    return "The download failed. Check your connection and try again."
  }
  await response.arrayBuffer().catch(() => undefined)
  if (response.ok) return null
  if (response.status === 401) return "Sign in again to download this file."
  if (response.status === 404)
    return "This original could not be found, so it was not downloaded. It may have been removed."
  return "The download failed. Try again."
}

/**
 * Gallery wired to server data: cursor pagination, refresh, viewer and delete.
 * One implementation for the staff portfolio and the admin library; the props
 * decide which permission-aware actions appear.
 */
export function MediaGallery({
  label,
  initialPage,
  loadPage,
  refreshPage,
  empty,
  showAttribution = false,
  getDownloadHref,
  getPortfolioHref,
  canDelete = false,
  refreshIntervalMs,
  refreshSignal,
  canLabel = false,
  showLabelBadge = false,
}: MediaGalleryProps) {
  const [labelIds, setLabelIds] = React.useState<string[] | null>(null)
  const [page, setPage] = React.useState(initialPage)
  const { items, nextCursor } = page
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [refreshPending, setRefreshPending] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [refreshError, setRefreshError] = React.useState<string | null>(null)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<MediaItem | null>(null)
  const [downloadError, setDownloadError] = React.useState<{
    id: string
    message: string
  } | null>(null)
  const pageGeneration = React.useRef(0)
  const loadedRange = React.useRef(page)
  const loadingMoreRequest = React.useRef(false)
  const refreshing = React.useRef(false)
  const activeRefresh = React.useRef<AbortController | null>(null)

  React.useLayoutEffect(() => {
    loadedRange.current = page
  }, [page])

  const invalidatePageRequests = React.useCallback(() => {
    pageGeneration.current += 1
    activeRefresh.current?.abort()
  }, [])

  React.useEffect(
    () => () => invalidatePageRequests(),
    [invalidatePageRequests]
  )

  const { display, brokenCount, onError, attach, retryBroken } =
    usePreviewRecovery(items)
  const openItem = display.find((item) => item.id === openId) ?? null
  const hasPending = items.some(
    (i) => i.uploadState === "uploading" || i.uploadState === "processing"
  )

  const refresh = React.useCallback(async () => {
    if (refreshing.current) return
    refreshing.current = true
    setRefreshPending(true)
    // Older pagination responses cannot append to a newly refreshed snapshot.
    const generation = ++pageGeneration.current
    const controller = new AbortController()
    activeRefresh.current = controller
    const timer = window.setTimeout(
      () => controller.abort(),
      REFRESH_TIMEOUT_MS
    )
    const aborted = new Promise<"timeout">((resolve) => {
      controller.signal.addEventListener("abort", () => resolve("timeout"))
    })
    const boundary = loadedRange.current.items.at(-1)
    const deadline = Date.now() + REFRESH_TIMEOUT_MS
    const request = (async () => {
      const fresh: MediaPage = { items: [], nextCursor: null }
      const seen = new Set<string>()
      let reached = false
      do {
        if (Date.now() >= deadline) controller.abort()
        controller.signal.throwIfAborted()
        const cursor = fresh.nextCursor
        const result = refreshPage
          ? await refreshPage(controller.signal, cursor)
          : await loadPage(cursor)
        if (!result.ok) return result
        for (const item of result.page.items) {
          if (!seen.has(item.id)) fresh.items.push(item)
          seen.add(item.id)
        }
        fresh.nextCursor = result.page.nextCursor
        const last = result.page.items.at(-1)
        reached = !boundary || (!!last && reachesBoundary(last, boundary))
        if (fresh.nextCursor && (!last || fresh.nextCursor === cursor))
          throw new Error("Refresh cursor did not advance")
      } while (fresh.nextCursor && !reached)
      return { ok: true as const, page: fresh }
    })()
    try {
      const result = await Promise.race([request, aborted])
      if (result === "timeout") {
        if (generation === pageGeneration.current)
          setRefreshError(REFRESH_FAILED)
        // An aborted fetch ends at once; a Server Function (no refreshPage)
        // cannot be aborted, so keep the guard until it settles.
        await request.catch(() => undefined)
        return
      }
      if (generation !== pageGeneration.current) return
      if (!result.ok) {
        setRefreshError(result.message)
        return
      }
      setRefreshError(null)
      // Broken previews get one fresh, re-signed attempt per refresh.
      retryBroken()
      setLoadError(null)
      // Replace through the previous oldest sort boundary, even if that item
      // was deleted. New arrivals cannot evict older loaded files or a viewer.
      setPage(result.page)
    } catch {
      if (generation === pageGeneration.current) setRefreshError(REFRESH_FAILED)
    } finally {
      window.clearTimeout(timer)
      activeRefresh.current = null
      refreshing.current = false
      setRefreshPending(false)
    }
  }, [loadPage, refreshPage, retryBroken])

  // Refresh after an upload (or any caller signal).
  const firstSignal = React.useRef(refreshSignal)
  React.useEffect(() => {
    if (refreshSignal === firstSignal.current) return
    void refresh()
  }, [refreshSignal, refresh])

  // Foreground refresh: on an interval while visible, and on focus/visibility.
  // Staff portfolios also poll while an upload is still being processed.
  const interval = refreshIntervalMs ?? (hasPending ? 5000 : undefined)
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    window.addEventListener("focus", onVisible)
    document.addEventListener("visibilitychange", onVisible)
    const timer = interval
      ? window.setInterval(() => {
          if (document.visibilityState === "visible") void refresh()
        }, interval)
      : undefined
    return () => {
      window.removeEventListener("focus", onVisible)
      document.removeEventListener("visibilitychange", onVisible)
      if (timer) window.clearInterval(timer)
    }
  }, [interval, refresh])

  async function loadMore() {
    if (!nextCursor || refreshing.current || loadingMoreRequest.current) return
    loadingMoreRequest.current = true
    const generation = pageGeneration.current
    setLoadingMore(true)
    setLoadError(null)
    try {
      const result = await loadPage(nextCursor)
      if (generation !== pageGeneration.current) return
      if (!result.ok) {
        setLoadError(result.message)
        return
      }
      setPage((current) => {
        const seen = new Set(current.items.map((i) => i.id))
        return {
          items: [
            ...current.items,
            ...result.page.items.filter((i) => !seen.has(i.id)),
          ],
          nextCursor: result.page.nextCursor,
        }
      })
    } catch {
      if (generation === pageGeneration.current)
        setLoadError("Could not load more. Check your connection.")
    } finally {
      loadingMoreRequest.current = false
      setLoadingMore(false)
    }
  }

  return (
    // Media load errors from the grid and the viewer (a portal, but inside this
    // tree) reach this handler; see preview-recovery.ts.
    <div ref={attach} className="flex flex-col gap-4" onError={onError}>
      {refreshError ? (
        <p role="status" className="text-sm text-muted-foreground">
          {refreshError}
        </p>
      ) : null}
      {brokenCount > 0 ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-negative/40 px-4 py-2 text-sm"
        >
          <span>
            {brokenCount === 1
              ? "1 preview could not load."
              : `${brokenCount} previews could not load.`}
          </span>
          <Button variant="outline" size="touch" onClick={retryBroken}>
            Try again
          </Button>
        </div>
      ) : null}
      {items.length === 0 ? (
        empty
      ) : (
        <MediaGrid
          items={display}
          label={label}
          showAttribution={showAttribution}
          showLabelBadge={showLabelBadge}
          onOpen={(item) => {
            setDownloadError(null)
            setOpenId(item.id)
            setViewerOpen(true)
          }}
        />
      )}
      <LoadMoreButton
        hasMore={nextCursor !== null}
        loading={loadingMore || refreshPending}
        error={loadError}
        onLoadMore={loadMore}
        shownCount={items.length}
      />
      <MediaViewer
        item={openItem}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        showAttribution={showAttribution}
        getDownloadHref={getDownloadHref}
        onDownload={
          getDownloadHref
            ? (item) => {
                setDownloadError(null)
                void probeDownload(getDownloadHref(item)).then((message) => {
                  if (message) setDownloadError({ id: item.id, message })
                })
              }
            : undefined
        }
        downloadError={
          downloadError?.id === openId ? downloadError.message : null
        }
        getPortfolioHref={getPortfolioHref}
        onDelete={canDelete ? (item) => setDeleting(item) : undefined}
        onEditLabels={canLabel ? (item) => setLabelIds([item.id]) : undefined}
      />
      {canLabel ? (
        <LabelEditorHost
          assetIds={labelIds ?? []}
          open={labelIds !== null}
          onOpenChange={(open) => {
            if (!open) setLabelIds(null)
          }}
          onSaved={(results) => {
            invalidatePageRequests()
            // Show the saved labels at once, wherever the file is loaded.
            const saved = new Map(
              results.flatMap((r) => (r.ok ? [[r.assetId, r.labels]] : []))
            )
            setPage((current) => ({
              ...current,
              items: current.items.map((i) => {
                const labels = saved.get(i.id)
                return labels === undefined ? i : { ...i, labels }
              }),
            }))
          }}
        />
      ) : null}
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        fileName={deleting?.originalFilename}
        onConfirm={async () => {
          if (!deleting) return
          const result = await deleteMedia(deleting.id)
          if (!result.ok) return result
          invalidatePageRequests()
          const id = deleting.id
          setPage((current) => ({
            ...current,
            items: current.items.filter((i) => i.id !== id),
          }))
          setViewerOpen(false)
          setOpenId(null)
          return { ok: true }
        }}
      />
    </div>
  )
}
