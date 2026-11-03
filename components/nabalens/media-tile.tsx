"use client"

import * as React from "react"
import {
  FilmStripIcon,
  ImageIcon,
  PlayIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

import { formatDate, formatDuration, UPLOAD_STATE_LABEL } from "./format"
import { labelBadgeText } from "./labels"
import type { MediaItem } from "./types"

/** A small badge over a photo: the photo, not the theme, is behind it. */
export function TileBadge({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      data-slot="tile-badge"
      className={cn(
        "inline-flex min-h-[22px] items-center gap-1 rounded-chip bg-tile-badge px-[7px] text-chip-touch whitespace-nowrap text-on-tile-badge tabular-nums backdrop-blur-[6px] wdth-92 md:text-chip [&_svg]:size-[13px]",
        className
      )}
    >
      {children}
    </span>
  )
}

type MediaTileProps = {
  item: MediaItem
  onOpen: (item: MediaItem) => void
  /** Admin views show who uploaded it and where. */
  showAttribution?: boolean
  /** v0.3: small "Needs labels" / "N labels" badge on ready tiles. */
  showLabelBadge?: boolean
  className?: string
}

function describe(
  item: MediaItem,
  showAttribution: boolean,
  labelText: string | null
) {
  const parts = [item.mediaType === "video" ? "Video" : "Photo"]
  if (item.originalFilename !== null) parts.push(item.originalFilename)
  if (showAttribution) parts.push(`by ${item.contributorName}`, item.venueName)
  parts.push(`uploaded ${formatDate(item.createdAt)}`)
  if (item.uploadState !== "ready")
    parts.push(UPLOAD_STATE_LABEL[item.uploadState])
  // The visible duration badge must be part of the name (WCAG 2.5.3).
  if (item.mediaType === "video" && item.durationSeconds)
    parts.push(`duration ${formatDuration(item.durationSeconds)}`)
  // Likewise the visible labels badge.
  if (labelText) parts.push(labelText)
  return parts.join(", ")
}

/**
 * One square, cropped thumbnail. The whole tile is a button so it is reachable
 * by keyboard and touch; there are no hover-only actions.
 */
export function MediaTile({
  item,
  onOpen,
  showAttribution = false,
  showLabelBadge = false,
  className,
}: MediaTileProps) {
  const labelText =
    showLabelBadge && item.uploadState === "ready"
      ? labelBadgeText(item.labels)
      : null
  // Track the URL that failed so a refreshed signed URL gets a fresh attempt.
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null)
  const showThumb = item.thumbnailUrl && item.thumbnailUrl !== failedUrl

  return (
    <figure
      data-state={item.uploadState}
      className={cn("group/tile grid min-w-0 content-start gap-1.5", className)}
    >
      {/* The labels badge sits outside the button (aria-hidden; its text is
          already in the button's name) so the button's visible text stays a
          contiguous part of its accessible name (WCAG 2.5.3, QA D1). */}
      <div className="relative">
        <button
          type="button"
          onClick={() => onOpen(item)}
          aria-label={describe(item, showAttribution, labelText)}
          className={cn(
            "relative block aspect-square w-full overflow-hidden rounded-print bg-media-placeholder outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            item.uploadState === "failed" &&
              "shadow-[inset_0_0_0_2px_var(--negative)]"
          )}
        >
          {showThumb ? (
            // Signed private URLs: deliberately not routed through next/image so
            // private media never passes through a shared optimisation cache.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnailUrl!}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setFailedUrl(item.thumbnailUrl)}
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-ink-muted">
              {item.uploadState === "uploading" ||
              item.uploadState === "processing" ? (
                <SpinnerGapIcon
                  className="size-7 motion-safe:animate-spin"
                  aria-hidden
                />
              ) : item.uploadState === "failed" ? (
                <WarningCircleIcon
                  className="size-7 text-negative"
                  aria-hidden
                />
              ) : // No video poster frames (no transcoding); a neutral video tile.
              item.mediaType === "video" ? (
                <FilmStripIcon className="size-7" aria-hidden />
              ) : (
                <ImageIcon className="size-7" aria-hidden />
              )}
            </span>
          )}
          {item.mediaType === "video" ? (
            <TileBadge className="pointer-events-none absolute right-1.5 bottom-1.5">
              <PlayIcon aria-hidden />
              {item.durationSeconds
                ? formatDuration(item.durationSeconds)
                : "Video"}
            </TileBadge>
          ) : null}
          {item.uploadState !== "ready" ? (
            <TileBadge className="pointer-events-none absolute top-1.5 left-1.5">
              {item.uploadState === "processing" ? (
                <SpinnerGapIcon
                  aria-hidden
                  className="motion-safe:animate-spin"
                />
              ) : item.uploadState === "failed" ? (
                <WarningCircleIcon aria-hidden />
              ) : null}
              {UPLOAD_STATE_LABEL[item.uploadState]}
            </TileBadge>
          ) : null}
        </button>
        {item.uploadState === "ready" && labelText ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1.5 left-1.5"
          >
            <TileBadge>{labelText}</TileBadge>
          </span>
        ) : null}
      </div>
      {showAttribution ? (
        <figcaption className="grid min-w-0 px-px">
          <span className="truncate text-meta-touch font-semibold text-ink md:text-meta-strong">
            {item.contributorName}
          </span>
          <span className="truncate text-meta-touch text-ink-muted md:text-caption">
            {item.venueName} · {formatDate(item.createdAt)}
          </span>
        </figcaption>
      ) : null}
    </figure>
  )
}
