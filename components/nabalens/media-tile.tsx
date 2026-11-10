"use client"

import * as React from "react"
import {
  FilmStripIcon,
  ImageIcon,
  PlayIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { dishName } from "@/lib/menus/dish-name"
import { cn } from "@/lib/utils"

import { Post } from "./common-room/post"
import { formatDate, formatDuration, UPLOAD_STATE_LABEL } from "./format"
import { labelBadgeText } from "./labels"
import { ProfileAvatar } from "./profile-avatar"
import { useAdd } from "./shell/add-context"
import type { MediaItem } from "./types"
import {
  OPEN_ADD,
  STOPPED_WORD,
  stoppedText,
  useUploadStopped,
} from "./upload-stopped"

/**
 * The dishes and drinks a file is labelled with, as cards show them under
 * the photo: "Onion Bhaji, Momo (Veg)", "Momo (Not specified)". Null when it
 * has none.
 */
export function labelDishNames(labels: MediaItem["labels"]): string | null {
  if (!labels || labels.items.length === 0) return null
  return labels.items.map((i) => dishName(i, i.unspecified)).join(", ")
}

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
        // A chip on a photo sits on the solid plate (DESIGN.md §4), so it
        // reads on any photo in both themes.
        "inline-flex min-h-7 items-center gap-1 rounded-square bg-plate px-2 text-chip whitespace-nowrap text-on-tile-badge tabular-nums [&_svg]:size-4",
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
  /**
   * v0.3: small "Needs labels" / "N labels" badge on ready tiles, and the
   * dishes they are labelled with under the photo.
   */
  showLabelBadge?: boolean
  /** Admin views only: staff and managers never see original file names. */
  showFileName?: boolean
  className?: string
}

function describe(
  item: MediaItem,
  showAttribution: boolean,
  showFileName: boolean,
  labelText: string | null,
  stopped = false
) {
  const kind = item.mediaType === "video" ? "Video" : "Photo"
  const parts: string[] = []
  if (showFileName) {
    parts.push(kind)
    if (item.originalFilename !== null) parts.push(item.originalFilename)
    if (showAttribution)
      parts.push(`by ${item.contributorName}`, item.venueName)
  } else if (showAttribution) {
    parts.push(`${kind} by ${item.contributorName}`, item.venueName)
  } else {
    parts.push(kind)
  }
  parts.push(`uploaded ${formatDate(item.createdAt)}`)
  if (stopped) parts.push(STOPPED_WORD)
  else if (item.uploadState !== "ready")
    parts.push(UPLOAD_STATE_LABEL[item.uploadState])
  // The visible duration badge must be part of the name (WCAG 2.5.3).
  if (item.mediaType === "video" && item.durationSeconds)
    parts.push(`duration ${formatDuration(item.durationSeconds)}`)
  // Likewise the visible labels badge.
  if (labelText) parts.push(labelText)
  return parts.join(", ")
}

/**
 * What sits inside a tile or post's media button: the thumbnail (or a quiet
 * icon while there is none) and the chips laid on it, each on the plate.
 */
function TileMedia({
  item,
  stopped = false,
}: {
  item: MediaItem
  /** An own upload nothing is sending any more (see useUploadStopped). */
  stopped?: boolean
}) {
  // Track the URL that failed so a refreshed signed URL gets a fresh attempt.
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null)
  const showThumb = item.thumbnailUrl && item.thumbnailUrl !== failedUrl
  return (
    <>
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
          {stopped ? (
            <WarningCircleIcon className="size-7 text-warn-fg" aria-hidden />
          ) : item.uploadState === "uploading" ||
            item.uploadState === "processing" ? (
            <SpinnerGapIcon
              className="size-7 motion-safe:animate-spin"
              aria-hidden
            />
          ) : item.uploadState === "failed" ? (
            <WarningCircleIcon className="size-7 text-warn-fg" aria-hidden />
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
            <SpinnerGapIcon aria-hidden className="motion-safe:animate-spin" />
          ) : item.uploadState === "failed" || stopped ? (
            <WarningCircleIcon aria-hidden />
          ) : null}
          {stopped ? STOPPED_WORD : UPLOAD_STATE_LABEL[item.uploadState]}
        </TileBadge>
      ) : null}
    </>
  )
}

const MEDIA_BUTTON =
  "relative block w-full overflow-hidden bg-media-placeholder outline-none focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-solid"

/**
 * One square, cropped thumbnail. The whole tile is a button so it is reachable
 * by keyboard and touch; there are no hover-only actions.
 */
export function MediaTile({
  item,
  onOpen,
  showAttribution = false,
  showLabelBadge = false,
  showFileName = false,
  className,
}: MediaTileProps) {
  const stopped = useUploadStopped()?.(item) ?? false
  const openAdd = useAdd()
  const labelled = showLabelBadge && item.uploadState === "ready"
  const labelText = labelled ? labelBadgeText(item.labels) : null
  // Which dish a card shows is how files are found in folders and on Me,
  // so it is on the card itself, not only in the viewer's details.
  const dishes = labelled ? labelDishNames(item.labels) : null
  const dishLine = dishes ? (
    <span
      data-slot="tile-dishes"
      title={dishes}
      className="line-clamp-2 text-meta [overflow-wrap:anywhere] text-ink"
    >
      <span className="sr-only">Labelled: </span>
      {dishes}
    </span>
  ) : null

  return (
    <figure
      data-state={stopped ? "stopped" : item.uploadState}
      className={cn("group/tile grid min-w-0 content-start gap-1.5", className)}
    >
      {/* The labels badge sits outside the button (aria-hidden; its text is
          already in the button's name) so the button's visible text stays a
          contiguous part of its accessible name (WCAG 2.5.3, QA D1). */}
      <div className="relative">
        <button
          type="button"
          onClick={() => onOpen(item)}
          data-media-id={item.id}
          aria-label={describe(
            item,
            showAttribution,
            showFileName,
            labelText,
            stopped
          )}
          className={cn(
            MEDIA_BUTTON,
            "aspect-square rounded-control focus-visible:outline-offset-2",
            (item.uploadState === "failed" || stopped) &&
              "shadow-[inset_0_0_0_2px_var(--warn-fg)]"
          )}
        >
          <TileMedia item={item} stopped={stopped} />
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
          {dishLine}
          <span
            title={item.contributorName}
            className="line-clamp-2 text-label [overflow-wrap:anywhere] text-ink"
          >
            {item.contributorName}
          </span>
          <span
            title={`${item.venueName} · ${formatDate(item.createdAt)}`}
            className="line-clamp-2 text-meta [overflow-wrap:anywhere] text-ink-muted"
          >
            {item.venueName} · {formatDate(item.createdAt)}
          </span>
        </figcaption>
      ) : dishLine ? (
        <figcaption className="grid min-w-0 px-px">{dishLine}</figcaption>
      ) : null}
      {stopped ? (
        <div className="grid min-w-0 justify-items-start gap-1.5 px-px">
          <p className="text-meta [overflow-wrap:anywhere] text-ink">
            {stoppedText(item.mediaType, item.createdAt)}
          </p>
          {openAdd ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => openAdd()}
            >
              {OPEN_ADD}
            </Button>
          ) : null}
        </div>
      ) : null}
    </figure>
  )
}

/**
 * A colleague's photo as a post (Common Room feed, DESIGN.md §4): their face,
 * name, the venue and date, then the photo edge to edge. The photo is the
 * same button a tile is (same name, same viewer). No likes, comments or
 * counts.
 */
export function MediaPost({
  item,
  onOpen,
  className,
}: {
  item: MediaItem
  onOpen: (item: MediaItem) => void
  className?: string
}) {
  return (
    <Post
      data-state={item.uploadState}
      className={className}
      avatar={<ProfileAvatar name={item.contributorName} />}
      name={item.contributorName}
      meta={
        <>
          {item.venueName} ·{" "}
          <span className="tabular-nums">{formatDate(item.createdAt)}</span>
        </>
      }
      media={
        <button
          type="button"
          onClick={() => onOpen(item)}
          data-media-id={item.id}
          aria-label={describe(item, true, false, null)}
          className={cn(
            MEDIA_BUTTON,
            "absolute inset-0 h-full -outline-offset-3",
            item.uploadState === "failed" &&
              "shadow-[inset_0_0_0_2px_var(--warn-fg)]"
          )}
        >
          <TileMedia item={item} />
        </button>
      }
    />
  )
}
