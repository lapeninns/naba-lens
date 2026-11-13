import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { SEARCH_COPY } from "./search-copy"

/** The result list's columns, so the placeholder holds its place. */
export const RESULTS_GRID =
  "grid min-w-0 grid-cols-1 gap-(--gutter) md:grid-cols-2 xl:grid-cols-3"

/** Twelve card placeholders while the first page loads. */
export function SearchGridSkeleton() {
  return (
    <SkeletonRegion label={SEARCH_COPY.searching} className={RESULTS_GRID}>
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="flex gap-3 rounded-card bg-surface p-3 shadow-card"
        >
          <Skeleton className="size-24 shrink-0 rounded-control md:size-28" />
          <div className="grid flex-1 content-start gap-2">
            <Skeleton shape="line" className="w-3/4" />
            <Skeleton shape="line" className="w-1/2" />
            <Skeleton shape="line" className="w-2/3" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}

/** The filter row's placeholder (route loading files). */
export function SearchFiltersSkeleton({ admin }: { admin: boolean }) {
  return (
    <div
      aria-hidden
      className="grid gap-x-3 gap-y-4 md:grid-cols-2 lg:grid-cols-4"
    >
      {Array.from({ length: admin ? 4 : 3 }, (_, i) => (
        <div key={i} className="grid gap-1.5">
          <Skeleton shape="line" className="w-24" />
          <Skeleton className="h-14 rounded-control" />
        </div>
      ))}
    </div>
  )
}
