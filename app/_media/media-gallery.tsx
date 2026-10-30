"use client"

import * as React from "react"

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

/** A fresh first page for the foreground refresh; must honour `signal`. */
export type RefreshPage = (
  signal: AbortSignal
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
   * uses `loadPage(null)` and waits for each call to settle before the next.
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
}

/**
 * A foreground refresh that has not answered by now is aborted and reported as
 * failed; a late result is ignored. The next refresh starts only once the
 * request has actually ended, so refreshes never pile up behind a slow server.
 */
export const REFRESH_TIMEOUT_MS = 10_000

const REFRESH_FAILED = "Could not refresh. Check your connection."

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

/** True when `a` sorts after `b` in the (created_at desc, id desc) feed. */
function isOlder(a: MediaItem, b: MediaItem) {
  return (
    a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id)
  )
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
}: MediaGalleryProps) {
  const [items, setItems] = React.useState<MediaItem[]>(initialPage.items)
  const [nextCursor, setNextCursor] = React.useState(initialPage.nextCursor)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [refreshError, setRefreshError] = React.useState<string | null>(null)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<MediaItem | null>(null)
  const [downloadError, setDownloadError] = React.useState<{
    id: string
    message: string
  } | null>(null)
  const pagesLoaded = React.useRef(1)
  const refreshing = React.useRef(false)

  const { display, brokenCount, onError, attach, retryBroken } =
    usePreviewRecovery(items)
  const openItem = display.find((item) => item.id === openId) ?? null
  const hasPending = items.some(
    (i) => i.uploadState === "uploading" || i.uploadState === "processing"
  )

  const refresh = React.useCallback(async () => {
    if (refreshing.current) return
    refreshing.current = true
    const controller = new AbortController()
    const timer = window.setTimeout(
      () => controller.abort(),
      REFRESH_TIMEOUT_MS
    )
    const aborted = new Promise<"timeout">((resolve) => {
      controller.signal.addEventListener("abort", () => resolve("timeout"))
    })
    const request = refreshPage
      ? refreshPage(controller.signal)
      : loadPage(null)
    try {
      const result = await Promise.race([request, aborted])
      if (result === "timeout") {
        setRefreshError(REFRESH_FAILED)
        // An aborted fetch ends at once; a Server Function (no refreshPage)
        // cannot be aborted, so keep the guard until it settles.
        await request.catch(() => undefined)
        return
      }
      if (!result.ok) {
        setRefreshError(result.message)
        return
      }
      setRefreshError(null)
      // Broken previews get one fresh, re-signed attempt per refresh.
      retryBroken()
      const fresh = result.page
      setItems((current) => {
        // The fresh first page replaces the top; older pages already loaded stay.
        const last = fresh.items.at(-1)
        if (!fresh.nextCursor || !last) return fresh.items
        return [...fresh.items, ...current.filter((i) => isOlder(i, last))]
      })
      if (pagesLoaded.current <= 1) setNextCursor(fresh.nextCursor)
    } catch {
      setRefreshError(REFRESH_FAILED)
    } finally {
      window.clearTimeout(timer)
      refreshing.current = false
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
    if (!nextCursor) return
    setLoadingMore(true)
    setLoadError(null)
    try {
      const result = await loadPage(nextCursor)
      if (!result.ok) {
        setLoadError(result.message)
        return
      }
      pagesLoaded.current += 1
      setItems((current) => {
        const seen = new Set(current.map((i) => i.id))
        return [...current, ...result.page.items.filter((i) => !seen.has(i.id))]
      })
      setNextCursor(result.page.nextCursor)
    } catch {
      setLoadError("Could not load more. Check your connection.")
    } finally {
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
          onOpen={(item) => {
            setDownloadError(null)
            setOpenId(item.id)
            setViewerOpen(true)
          }}
        />
      )}
      <LoadMoreButton
        hasMore={nextCursor !== null}
        loading={loadingMore}
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
      />
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
          const id = deleting.id
          setItems((current) => current.filter((i) => i.id !== id))
          setViewerOpen(false)
          setOpenId(null)
          return { ok: true }
        }}
      />
    </div>
  )
}
