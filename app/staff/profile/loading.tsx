import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

export default function WorkProfileLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Work details" />
      <SkeletonRegion
        label="Loading your work details…"
        className="flex flex-col gap-4"
      >
        <Skeleton className="h-12 w-56 rounded-panel" />
        <Skeleton className="h-64 rounded-panel" />
        <Skeleton className="h-32 rounded-panel" />
      </SkeletonRegion>
    </div>
  )
}
