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

/** The directory in its real layout: filter fields, then one card of rows. */
export default function StaffLoading() {
  return (
    <div className="mx-auto grid w-full max-w-(--size-page) gap-4 px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <PageHeader
        venueScope
        scope="All venues"
        title="Staff"
        summary={STAFF_SUMMARY}
        className="pb-0 md:pb-0"
      />
      <SkeletonRegion label="Loading staff…" className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3">
          {["sm:w-44", "sm:w-44", "sm:w-44", "min-w-48 flex-1"].map(
            (width, index) => (
              <div key={index} className={`grid w-full gap-1.5 ${width}`}>
                <Skeleton shape="line" className="w-20" />
                <Skeleton className="h-14" />
              </div>
            )
          )}
        </div>
        <div className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
          {ROWS.map(([name, meta], index) => (
            <div
              key={index}
              className="flex min-h-16 items-center gap-3 px-4 py-3"
            >
              <Skeleton shape="av" />
              <div className="grid flex-1 gap-2">
                <Skeleton shape="line" style={{ width: `${name}%` }} />
                <Skeleton shape="line" style={{ width: `${meta}%` }} />
              </div>
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </div>
  )
}
