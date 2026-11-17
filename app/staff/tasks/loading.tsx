import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/**
 * Album's shapes while it loads (DESIGN.md §5a), no shimmer: the album
 * count and its bar, the place chips, then the empty slots as squares.
 */
export default function AlbumLoading() {
  return (
    <SkeletonRegion label="Loading the album…" className="grid gap-5 pb-4">
      <div className="grid gap-2.5">
        <Skeleton shape="line" className="w-1/3" />
        <Skeleton shape="title" />
        <Skeleton className="h-3 rounded-round" />
        <Skeleton shape="line" className="w-1/2" />
      </div>
      <div className="grid gap-2">
        <Skeleton shape="title" className="w-1/2" />
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2].map((chip) => (
            <Skeleton key={chip} className="h-16 w-28 shrink-0 rounded-card" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2, 3].map((slot) => (
          <Skeleton key={slot} shape="tile" className="rounded-card" />
        ))}
      </div>
    </SkeletonRegion>
  )
}
