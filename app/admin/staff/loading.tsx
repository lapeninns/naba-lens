import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { STAFF_SUMMARY } from "./copy"

const ROWS = [
  [60, 35],
  [52, 30],
  [66, 40],
  [48, 28],
  [58, 36],
  [60, 35],
]

export default function StaffLoading() {
  return (
    <div className="mx-auto grid w-full max-w-(--size-page) gap-5 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        venueScope
        scope="All venues"
        title="Staff"
        summary={STAFF_SUMMARY}
        className="pb-0 md:pb-0"
      />
      <SkeletonRegion label="Loading staff…" className="grid gap-5">
        {ROWS.map(([name, meta], index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton shape="av" />
            <div className="grid flex-1 gap-2">
              <Skeleton shape="line" style={{ width: `${name}%` }} />
              <Skeleton shape="line" style={{ width: `${meta}%` }} />
            </div>
          </div>
        ))}
      </SkeletonRegion>
    </div>
  )
}
