import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

export default function CommunityLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        scope="All venues"
        title="Photos"
        summary="newest first"
        className="pb-0 md:pb-0"
      />
      <SkeletonRegion
        label="Loading photos…"
        className="grid grid-cols-3 gap-0.5 max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-4 md:grid-cols-[repeat(auto-fill,minmax(var(--size-tile-min),1fr))] md:gap-x-3 md:gap-y-4"
      >
        {Array.from({ length: 24 }, (_, i) => (
          <Skeleton key={i} shape="tile" />
        ))}
      </SkeletonRegion>
    </div>
  )
}
