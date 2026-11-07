"use client"

import * as React from "react"
import {
  ArrowClockwiseIcon,
  ImageBrokenIcon,
  ImageIcon,
} from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

/** The route URL with a re-sign marker; version 0 is the plain URL. */
export function versionedSrc(src: string, version: number): string {
  if (version <= 0) return src
  return `${src}${src.includes("?") ? "&" : "?"}r=${version}`
}

/**
 * A photo from an authorised route (`/api/coverage/evidence/...` or
 * `/api/media/...`) that re-checks access and redirects to a 60 s signed URL
 * on every load. A failed load (link expired between redirect and fetch, brief
 * storage error) re-requests the route once with a new `?r=`, which re-signs;
 * a second failure shows "Try again" for one more fresh attempt.
 */
export function EvidenceImage({
  src,
  alt = "",
  fit = "cover",
  className,
}: {
  src: string | null
  alt?: string
  fit?: "cover" | "contain"
  className?: string
}) {
  const [state, setState] = React.useState({
    src,
    version: 0,
    retried: false,
    broken: false,
  })
  // A new photo starts over (state is keyed by the route URL).
  const current =
    state.src === src
      ? state
      : { src, version: 0, retried: false, broken: false }
  if (current !== state) setState(current)

  // Counts one failure per URL version: a load that failed before hydration
  // is seen both by the mount check and by React's replayed error event.
  const failed = React.useCallback((version: number) => {
    setState((s) =>
      s.broken || s.version !== version
        ? s
        : s.retried
          ? { ...s, broken: true }
          : { ...s, version: s.version + 1, retried: true }
    )
  }, [])

  const version = current.version
  // Only a load that actually ended without pixels counts; a stale event that
  // arrives while the re-signed URL is still loading (not complete) does not.
  const attach = React.useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth === 0 && img.src) {
        failed(version)
      }
    },
    [failed, version]
  )

  const frame = cn(
    "relative flex items-center justify-center overflow-hidden bg-media-placeholder text-ink-muted",
    className
  )

  if (!src) {
    return (
      <span className={frame}>
        <ImageIcon className="size-6" aria-hidden />
        {alt ? <span className="sr-only">{alt}</span> : null}
      </span>
    )
  }

  if (current.broken) {
    return (
      <span className={cn(frame, "flex-col gap-1 p-1 text-center")}>
        <ImageBrokenIcon className="size-6" aria-hidden />
        {/* z-20: stays above a selectable tile's overlay button (z-10). */}
        <button
          type="button"
          className="relative z-20 inline-flex min-h-11 max-w-full flex-wrap items-center justify-center gap-x-1.5 rounded-control bg-surface px-2 text-label leading-tight text-ink outline-none hover:bg-surface-2 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus focus-visible:outline-solid"
          onClick={() =>
            setState((s) => ({
              ...s,
              version: s.version + 1,
              retried: true,
              broken: false,
            }))
          }
        >
          <ArrowClockwiseIcon className="size-[18px]" aria-hidden />
          Try again
          {alt ? <span className="sr-only">: {alt}</span> : null}
        </button>
      </span>
    )
  }

  return (
    <span className={frame}>
      {/* Authorised redirect routes; next/image cannot follow them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={attach}
        src={versionedSrc(src, current.version)}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cn(
          "size-full",
          fit === "cover" ? "object-cover" : "object-contain"
        )}
        onError={(event) => {
          const img = event.currentTarget
          if (img.complete && img.naturalWidth === 0) failed(version)
        }}
      />
    </span>
  )
}
