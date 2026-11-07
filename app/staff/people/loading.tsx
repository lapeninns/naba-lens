import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { PEOPLE_COPY } from "./people"

const WIDTHS = [
  ["60%", "35%"],
  ["52%", "30%"],
  ["66%", "40%"],
  ["48%", "28%"],
]

/** The directory's real layout: header, the search card, then rows in one card. */
export default function PeopleLoading() {
  return (
    <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <PageHeader
        scope={PEOPLE_COPY.scope}
        title={PEOPLE_COPY.title}
        className="pb-0 md:pb-0"
      />
      <SkeletonRegion
        label={PEOPLE_COPY.loading}
        className="flex flex-col gap-(--gutter)"
      >
        <div className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
          <Skeleton shape="line" className="w-16" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-13 w-full" />
        </div>
        <div className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
          {WIDTHS.map(([name, meta], i) => (
            <div key={i} className="flex min-h-16 items-center gap-3 p-3">
              <Skeleton shape="av" />
              <div className="grid flex-1 gap-2">
                <Skeleton shape="line" style={{ width: name }} />
                <Skeleton shape="line" style={{ width: meta }} />
              </div>
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </div>
  )
}
