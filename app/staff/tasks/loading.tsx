import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** Static card shapes where Home's feed will be (no shimmer). */
const CARD = "grid gap-3 rounded-card bg-surface p-4 shadow-card"

export default function TasksLoading() {
  return (
    <div className="mx-auto grid w-full max-w-(--size-feed) min-w-0 gap-(--gutter) px-(--page-gutter) py-4 md:px-0 md:py-8">
      <PageHeader title="Home" className="pb-1 md:pb-2" />
      <SkeletonRegion
        label="Loading your tasks…"
        className="grid gap-(--gutter)"
      >
        {/* The share box */}
        <div className={CARD}>
          <Skeleton shape="title" />
          <Skeleton className="h-13 rounded-control" />
        </div>
        {/* To do: the lead card */}
        <div className={CARD}>
          <Skeleton shape="line" className="w-1/3" />
          <Skeleton shape="title" />
          <Skeleton shape="line" />
          <Skeleton className="h-15 rounded-control" />
        </div>
        {/* Your photos for the month */}
        <div className={CARD}>
          <Skeleton shape="title" />
          <Skeleton className="h-12 w-1/2" />
          <Skeleton className="h-3 rounded-round" />
        </div>
      </SkeletonRegion>
      <h2 className="mt-3 px-1 pt-2 font-display text-section-title text-ink">
        All tasks
      </h2>
      <SkeletonRegion
        label="Loading tasks…"
        className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
      >
        {[0, 1].map((row) => (
          <div
            key={row}
            className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 p-3"
          >
            <Skeleton shape="av" />
            <div className="grid gap-2">
              <Skeleton shape="line" className="w-1/3" />
              <Skeleton shape="line" />
            </div>
          </div>
        ))}
      </SkeletonRegion>
    </div>
  )
}
