"use client"

import * as React from "react"
import { VideoCameraSlashIcon, ImageBrokenIcon } from "@phosphor-icons/react"

import { EvidencePreviewButton } from "@/components/nabalens/coverage"
import type { EvidenceItem } from "@/lib/amenities/contract"
import { cn } from "@/lib/utils"

const FRAME = "aspect-[4/3] w-full rounded-print bg-media-placeholder"

function Unavailable({
  kind,
  text,
  className,
}: {
  kind: EvidenceItem["kind"]
  text: string
  className?: string
}) {
  const Icon = kind === "video" ? VideoCameraSlashIcon : ImageBrokenIcon
  return (
    <span
      role="img"
      aria-label={text}
      className={cn(
        FRAME,
        "flex flex-col items-center justify-center gap-1 px-2 text-center text-meta text-ink-muted",
        className
      )}
    >
      <Icon aria-hidden className="size-6" />
      <span aria-hidden>{text}</span>
    </span>
  )
}

/**
 * One piece of amenity evidence. Photos open the larger preview; videos play
 * from the authorised stream route, never autoplaying. Deleted or no longer
 * ready assets keep their place in history as a plain placeholder.
 */
export function EvidenceTile({
  item,
  label,
  className,
}: {
  item: EvidenceItem
  /** Accessible name, e.g. "Photo 1 from Sam Lee". */
  label: string
  className?: string
}) {
  const [failed, setFailed] = React.useState(false)

  if (!item.available) {
    return (
      <Unavailable
        kind={item.kind}
        text={
          item.kind === "video"
            ? "Video no longer available"
            : "Photo no longer available"
        }
        className={className}
      />
    )
  }

  if (item.kind === "photo") {
    return (
      <EvidencePreviewButton
        thumbnailUrl={item.thumbUrl}
        previewUrl={item.previewUrl}
        label={label}
        className={className}
      />
    )
  }

  if (!item.streamUrl || failed) {
    return (
      <Unavailable
        kind="video"
        text={
          failed ? "This video can't play in this browser" : "Video unavailable"
        }
        className={className}
      />
    )
  }

  return (
    <video
      src={item.streamUrl}
      poster={item.thumbUrl ?? undefined}
      controls
      playsInline
      preload="metadata"
      aria-label={label}
      onError={() => setFailed(true)}
      className={cn(FRAME, "bg-viewer object-contain", className)}
    />
  )
}
