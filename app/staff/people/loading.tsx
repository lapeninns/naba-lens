import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { PEOPLE_COPY } from "./people"

const WIDTHS = [
  ["60%", "35%"],
  ["52%", "30%"],
  ["66%", "40%"],
  ["48%", "28%"],
]

export default function PeopleLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        scope={PEOPLE_COPY.scope}
        title={PEOPLE_COPY.title}
        className="pb-0 md:pb-0"
      />
      <SkeletonRegion label={PEOPLE_COPY.loading} className="grid gap-5">
        {WIDTHS.map(([name, meta], i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton shape="av" />
            <div className="grid flex-1 gap-2">
              <Skeleton shape="line" style={{ width: name }} />
              <Skeleton shape="line" style={{ width: meta }} />
            </div>
          </div>
        ))}
      </SkeletonRegion>
    </div>
  )
}
