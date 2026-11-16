import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** All tasks in its real shape: the heading, then task rows (no shimmer). */
export default function AllTasksLoading() {
  return (
    <div className="mx-auto flex w-full max-w-feed flex-col gap-gutter px-page-gutter py-4 md:px-0 md:py-8">
      <PageHeader
        title="All tasks"
        summary="Overdue tasks still take photos."
      />
      <h2 className="px-1 pt-2 type-section-title text-ink">Assigned to you</h2>
      <SkeletonRegion
        label="Loading tasks…"
        className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
      >
        {[0, 1, 2].map((row) => (
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
