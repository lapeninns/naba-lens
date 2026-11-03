import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

export default function TasksLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Home" />
      <SkeletonRegion
        label="Loading your tasks…"
        className="flex flex-col gap-6"
      >
        <Skeleton className="h-36 rounded-panel" />
        <Skeleton className="h-32 rounded-panel" />
        <Skeleton className="h-24 rounded-panel" />
      </SkeletonRegion>
      <h2 className="font-display text-2xl text-ink">All tasks</h2>
      <SkeletonRegion
        label="Loading tasks…"
        className="grid gap-3 sm:grid-cols-2"
      >
        <Skeleton className="h-28 rounded-panel" />
        <Skeleton className="h-28 rounded-panel" />
      </SkeletonRegion>
    </div>
  )
}
