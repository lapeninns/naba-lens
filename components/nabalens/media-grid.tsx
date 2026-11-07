import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

import { MediaPost, MediaTile } from "./media-tile"
import type { MediaItem } from "./types"

/*
 * A contact sheet: three across with 2px gutters on phones, like the camera
 * roll; captioned grids take two across. From md, tiles auto-fill from 160px.
 */
const GRID =
  "grid grid-cols-3 gap-0.5 md:grid-cols-[repeat(auto-fill,minmax(var(--size-tile-min),1fr))] md:gap-x-3 md:gap-y-4"
const CAPTIONED = "max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-4"
/** The Common Room feed: one post per file, white cards on the grey canvas. */
const FEED = "mx-auto grid w-full max-w-(--size-feed) gap-(--gutter)"

type MediaGridProps = {
  items: MediaItem[]
  onOpen: (item: MediaItem) => void
  showAttribution?: boolean
  /** Show the small labels badge on ready tiles (staff portfolio). */
  showLabelBadge?: boolean
  /** Admin views only: tile names include the original file name. */
  showFileName?: boolean
  /**
   * `grid` (default): square tiles. `feed`: colleagues' files as posts, newest
   * first (Photos). The feed always names the contributor.
   */
  layout?: "grid" | "feed"
  /** Accessible name for the list, e.g. "Your portfolio" or "Library". */
  label: string
  className?: string
}

/** Newest-first responsive grid. Order is the caller's; this only lays out. */
export function MediaGrid({
  items,
  onOpen,
  showAttribution = false,
  showLabelBadge = false,
  showFileName = false,
  layout = "grid",
  label,
  className,
}: MediaGridProps) {
  if (layout === "feed") {
    return (
      <ul aria-label={label} className={cn(FEED, className)}>
        {items.map((item) => (
          <li key={item.id} className="min-w-0">
            <MediaPost item={item} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    )
  }
  return (
    <ul
      aria-label={label}
      className={cn(GRID, showAttribution && CAPTIONED, className)}
    >
      {items.map((item) => (
        <li key={item.id} className="min-w-0">
          <MediaTile
            item={item}
            onOpen={onOpen}
            showAttribution={showAttribution}
            showLabelBadge={showLabelBadge}
            showFileName={showFileName}
          />
        </li>
      ))}
    </ul>
  )
}

/** A post-shaped placeholder: head, then a flat 4:3 photo block. */
export function MediaPostSkeleton() {
  return (
    <div className="grid overflow-hidden rounded-card bg-surface shadow-card">
      <div className="flex items-center gap-2.5 p-3">
        <Skeleton shape="av" />
        <div className="grid flex-1 gap-1.5">
          <Skeleton shape="line" className="w-2/5" />
          <Skeleton shape="line" className="w-3/5" />
        </div>
      </div>
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="h-3" />
    </div>
  )
}

export function MediaGridSkeleton({
  count = 24,
  showAttribution = false,
  layout = "grid",
  className,
}: {
  count?: number
  showAttribution?: boolean
  layout?: "grid" | "feed"
  className?: string
}) {
  if (layout === "feed") {
    return (
      <div
        role="status"
        aria-label="Loading media"
        aria-busy="true"
        className={cn(FEED, className)}
      >
        {Array.from({ length: Math.min(count, 3) }, (_, i) => (
          <MediaPostSkeleton key={i} />
        ))}
      </div>
    )
  }
  return (
    <div
      role="status"
      aria-label="Loading media"
      aria-busy="true"
      className={cn(GRID, showAttribution && CAPTIONED, className)}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton shape="tile" />
          {showAttribution ? (
            <>
              <Skeleton shape="line" className="w-3/4" />
              <Skeleton shape="line" className="w-1/2" />
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}
