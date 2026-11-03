import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { PROFILE_COPY } from "../people"

export default function ColleagueLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        scope={[...PROFILE_COPY.scope]}
        title={<span className="sr-only">{PROFILE_COPY.srTitle}</span>}
        className="pb-0 md:pb-0"
      />
      <SkeletonRegion label={PROFILE_COPY.loading} className="grid gap-5">
        <div className="flex items-center gap-3">
          <Skeleton shape="av" className="size-18" />
          <div className="grid flex-1 gap-2">
            <Skeleton shape="title" />
            <Skeleton shape="line" className="w-[35%]" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-0.5 max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-4 md:grid-cols-[repeat(auto-fill,minmax(var(--size-tile-min),1fr))] md:gap-x-3 md:gap-y-4">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} shape="tile" />
          ))}
        </div>
      </SkeletonRegion>
    </div>
  )
}
