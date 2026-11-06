import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

export default function PhotoGuideLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Photo guide" />
      <SkeletonRegion
        label="Loading the photo guide…"
        className="flex flex-col gap-6"
      >
        <Skeleton className="h-40 rounded-panel" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} shape="tile" />
          ))}
        </div>
      </SkeletonRegion>
    </div>
  )
}
