"use client"

import * as React from "react"
import {
  ImageIcon,
  PlayIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

import { formatDate, formatDuration, UPLOAD_STATE_LABEL } from "./format"
import type { MediaItem } from "./types"
import { UploadStateBadge } from "./upload-state-badge"

type MediaTileProps = {
  item: MediaItem
  onOpen: (item: MediaItem) => void
  /** Admin views show who uploaded it and where. */
  showAttribution?: boolean
  className?: string
}

function describe(item: MediaItem, showAttribution: boolean) {
  const parts = [
    item.mediaType === "video" ? "Video" : "Photo",
    item.originalFilename,
  ]
  if (showAttribution) parts.push(`by ${item.contributorName}`, item.venueName)
  parts.push(`uploaded ${formatDate(item.createdAt)}`)
  if (item.uploadState !== "ready")
    parts.push(UPLOAD_STATE_LABEL[item.uploadState])
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
  className,
}: MediaTileProps) {
  // Track the URL that failed so a refreshed signed URL gets a fresh attempt.
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null)
  const showThumb = item.thumbnailUrl && item.thumbnailUrl !== failedUrl

  return (
    <figure
      className={cn("group/tile flex min-w-0 flex-col gap-1.5", className)}
    >
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={describe(item, showAttribution)}
        className="relative block aspect-square w-full overflow-hidden rounded-md bg-media-placeholder outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
            className="size-full object-cover transition-transform duration-200 group-hover/tile:scale-[1.02] motion-reduce:transition-none"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            {item.uploadState === "uploading" ||
            item.uploadState === "processing" ? (
              <SpinnerGapIcon
                className="size-6 motion-safe:animate-spin"
                aria-hidden
              />
            ) : item.uploadState === "failed" ? (
              <WarningCircleIcon className="size-6 text-negative" aria-hidden />
            ) : (
              <ImageIcon className="size-6" aria-hidden />
            )}
          </span>
        )}
        {item.mediaType === "video" ? (
          <span className="absolute right-1.5 bottom-1.5 inline-flex h-5 items-center gap-1 rounded-sm bg-black/70 px-1.5 text-xs font-medium text-white tabular-nums">
            <PlayIcon weight="fill" className="size-3" aria-hidden />
            {item.durationSeconds
              ? formatDuration(item.durationSeconds)
              : "Video"}
          </span>
        ) : null}
        {item.uploadState !== "ready" ? (
          <UploadStateBadge
            state={item.uploadState}
            className="absolute top-1.5 left-1.5"
          />
        ) : null}
      </button>
      {showAttribution ? (
        <figcaption className="min-w-0 px-0.5 text-xs leading-snug">
          <span className="block truncate font-medium text-foreground">
            {item.contributorName}
          </span>
          <span className="block truncate text-muted-foreground">
            {item.venueName} · {formatDate(item.createdAt)}
          </span>
        </figcaption>
      ) : null}
    </figure>
  )
}
