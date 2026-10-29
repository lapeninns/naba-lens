import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

import { MediaTile } from "./media-tile"
import type { MediaItem } from "./types"

const GRID =
  "grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 sm:gap-3"

type MediaGridProps = {
  items: MediaItem[]
  onOpen: (item: MediaItem) => void
  showAttribution?: boolean
  /** Accessible name for the list, e.g. "Your portfolio" or "Library". */
  label: string
  className?: string
}

/** Newest-first responsive grid. Order is the caller's; this only lays out. */
export function MediaGrid({
  items,
  onOpen,
  showAttribution = false,
  label,
  className,
}: MediaGridProps) {
  return (
    <ul aria-label={label} className={cn(GRID, className)}>
      {items.map((item) => (
        <li key={item.id} className="min-w-0">
          <MediaTile
            item={item}
            onOpen={onOpen}
            showAttribution={showAttribution}
          />
        </li>
      ))}
    </ul>
  )
}

export function MediaGridSkeleton({
  count = 12,
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
      className={cn(GRID, className)}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="aspect-square w-full rounded-md" />
          {showAttribution ? (
            <>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}
