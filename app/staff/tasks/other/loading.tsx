import { PageHeader } from "@/components/nabalens/page-header"
import { OTHER_JOBS_COPY } from "@/components/nabalens/tasks/copy"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** Other jobs in its real shape: the heading, then job rows (no shimmer). */
export default function OtherJobsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-feed flex-col gap-gutter px-page-gutter py-4 md:px-0 md:py-8">
      <PageHeader
        title={OTHER_JOBS_COPY.title}
        summary={OTHER_JOBS_COPY.summary}
      />
      <h2 className="px-1 pt-2 type-section-title text-ink">Assigned to you</h2>
      <SkeletonRegion
        label="Loading jobs…"
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
