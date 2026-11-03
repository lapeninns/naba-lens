import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

import { MediaTile } from "./media-tile"
import type { MediaItem } from "./types"

/*
 * A contact sheet: three across with 2px gutters on phones, like the camera
 * roll; captioned grids take two across. From md, tiles auto-fill from 160px.
 */
const GRID =
  "grid grid-cols-3 gap-0.5 md:grid-cols-[repeat(auto-fill,minmax(var(--size-tile-min),1fr))] md:gap-x-3 md:gap-y-4"
const CAPTIONED = "max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-4"

type MediaGridProps = {
  items: MediaItem[]
  onOpen: (item: MediaItem) => void
  showAttribution?: boolean
  /** Show the small labels badge on ready tiles (staff portfolio). */
  showLabelBadge?: boolean
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
  label,
  className,
}: MediaGridProps) {
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
          />
        </li>
      ))}
    </ul>
  )
}

export function MediaGridSkeleton({
  count = 24,
  showAttribution = false,
  className,
}: {
  count?: number
  showAttribution?: boolean
  className?: string
}) {
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
