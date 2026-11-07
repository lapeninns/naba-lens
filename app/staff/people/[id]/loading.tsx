import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { PROFILE_COPY } from "../people"

/** The profile's real layout: the profile card, the heading, the photo grid. */
export default function ColleagueLoading() {
  return (
    <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <SkeletonRegion
        label={PROFILE_COPY.loading}
        className="flex flex-col gap-(--gutter)"
      >
        <div className="flex min-w-0 items-center gap-4 rounded-card bg-surface p-4 shadow-card">
          <Skeleton shape="av" className="size-21" />
          <div className="grid min-w-0 flex-1 gap-2">
            <PageHeader
              scope={[...PROFILE_COPY.scope]}
              title={<span className="sr-only">{PROFILE_COPY.srTitle}</span>}
              className="px-0 pb-0 md:pb-0"
            />
            <Skeleton shape="title" />
            <Skeleton shape="line" className="w-[55%]" />
            <Skeleton shape="line" className="w-[35%]" />
          </div>
        </div>
        <div className="px-1 pt-2">
          <Skeleton className="h-7 w-[45%]" />
        </div>
        <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-card md:grid-cols-[repeat(auto-fill,minmax(var(--size-tile-min),1fr))] md:gap-1">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} shape="tile" className="rounded-none" />
          ))}
        </div>
      </SkeletonRegion>
    </div>
  )
}
