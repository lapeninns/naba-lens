import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

export default function MonthLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Monthly photos"
        summary="Accepted photos count toward your target. Each photo counts for the month its upload started."
      />
      <SkeletonRegion
        label="Loading your month…"
        className="flex flex-col gap-6"
      >
        <Skeleton className="h-48 rounded-panel" />
        <Skeleton className="h-24 rounded-panel" />
        <Skeleton className="h-24 rounded-panel" />
      </SkeletonRegion>
    </div>
  )
}
