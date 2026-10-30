"use client"

import * as React from "react"

import type { MediaItem } from "@/components/nabalens"

/**
 * Signed-URL recovery for an open gallery.
 *
 * Thumbnails and previews point at authorised routes (`/api/media/{id}/thumb`,
 * `/preview`, `/stream`) that re-check access and redirect to a storage URL
 * signed for 60 s on every load, so a link the page holds never goes stale by
 * itself. A load can still fail: a link expired between redirect and fetch, a
 * dropped connection, or a brief storage error. Then:
 *
 * 1. the first error re-requests the same route with a new `?r=` value, which
 *    re-authorises and re-signs (one re-fetch, no loop);
 * 2. a second error marks that file's preview as broken: the gallery shows a
 *    visible message with a "Try again" action;
 * 3. the foreground refresh (15 s, focus, visibility) and "Try again" give each
 *    broken preview one fresh attempt.
 *
 * Errors are caught with one `onError` on a wrapper element: React dispatches
 * `<img>`/`<video>`/`<source>` errors through the component tree (including the
 * viewer's portal), so the presentational components stay unchanged.
 */

export type PreviewSlot = "thumb" | "preview" | "stream"

type SlotState = { version: number; retried: boolean; broken: boolean }

const ROUTE =
  /^\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(thumb|preview|stream)$/i

/** `{ id, slot }` for a gallery media route URL (relative or absolute), else null. */
export function parseMediaRoute(
  src: string | null | undefined
): { id: string; slot: PreviewSlot } | null {
  if (!src) return null
  let path: string
  try {
    path = new URL(src, "http://local.invalid").pathname
  } catch {
    return null
  }
  const match = ROUTE.exec(path)
  if (!match) return null
  return { id: match[1].toLowerCase(), slot: match[2] as PreviewSlot }
}

/** The route URL with a re-sign marker; version 0 is the plain URL. */
export function versioned(url: string, version: number): string {
  if (version <= 0) return url
  return `${url}${url.includes("?") ? "&" : "?"}r=${version}`
}

const key = (id: string, slot: PreviewSlot) => `${id}:${slot}`

/** The element's source URL: `<img src>`, `<source src>` or `<video>`'s source. */
function sourceOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const own = target.getAttribute("src")
  if (own) return own
  if (target instanceof HTMLMediaElement) {
    return (
      target.currentSrc ||
      target.querySelector("source")?.getAttribute("src") ||
      null
    )
  }
  return null
}

export type PreviewRecovery = {
  /** Items with each media URL carrying its current re-sign version. */
  display: MediaItem[]
  /** Number of files whose preview failed twice and is shown as broken. */
  brokenCount: number
  /** Pass to a wrapper element around the grid and viewer. */
  onError: React.ReactEventHandler<HTMLElement>
  /** Give every broken preview one fresh, re-signed attempt. */
  retryBroken: () => void
}

export function usePreviewRecovery(items: MediaItem[]): PreviewRecovery {
  const [slots, setSlots] = React.useState<Record<string, SlotState>>({})

  const onError = React.useCallback<React.ReactEventHandler<HTMLElement>>(
    (event) => {
      const route = parseMediaRoute(sourceOf(event.target))
      if (!route) return
      const k = key(route.id, route.slot)
      setSlots((current) => {
        const slot = current[k] ?? { version: 0, retried: false, broken: false }
        if (slot.broken) return current
        const next = slot.retried
          ? { ...slot, broken: true }
          : { version: slot.version + 1, retried: true, broken: false }
        return { ...current, [k]: next }
      })
    },
    []
  )

  const retryBroken = React.useCallback(() => {
    setSlots((current) => {
      let changed = false
      const next: Record<string, SlotState> = {}
      for (const [k, slot] of Object.entries(current)) {
        if (slot.broken) {
          changed = true
          // One fresh attempt: a further error marks it broken again.
          next[k] = { version: slot.version + 1, retried: true, broken: false }
        } else {
          next[k] = slot
        }
      }
      return changed ? next : current
    })
  }, [])

  const display = React.useMemo(() => {
    if (Object.keys(slots).length === 0) return items
    return items.map((item) => {
      const thumb = slots[key(item.id, "thumb")]
      const preview =
        slots[key(item.id, item.mediaType === "video" ? "stream" : "preview")]
      if (!thumb && !preview) return item
      return {
        ...item,
        thumbnailUrl:
          item.thumbnailUrl && thumb
            ? versioned(item.thumbnailUrl, thumb.version)
            : item.thumbnailUrl,
        previewUrl:
          item.previewUrl && preview
            ? versioned(item.previewUrl, preview.version)
            : item.previewUrl,
      }
    })
  }, [items, slots])

  const brokenCount = React.useMemo(() => {
    const ids = new Set(items.map((i) => i.id))
    const broken = new Set<string>()
    for (const [k, slot] of Object.entries(slots)) {
      const id = k.slice(0, k.indexOf(":"))
      if (slot.broken && ids.has(id)) broken.add(id)
    }
    return broken.size
  }, [items, slots])

  return { display, brokenCount, onError, retryBroken }
}
