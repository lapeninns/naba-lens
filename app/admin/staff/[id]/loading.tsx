import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

const LINES = [
  [60, 35],
  [52, 30],
  [66, 40],
  [48, 28],
]

export default function StaffMemberLoading() {
  return (
    <div className="mx-auto grid w-full max-w-(--size-page) gap-5 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        venueScope
        scope="All venues"
        title="Staff member"
        className="pb-0 md:pb-0"
      />
      <SkeletonRegion
        label="Loading account…"
        className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} shape="tile" />
          ))}
        </div>
        <div className="grid gap-5">
          {LINES.map(([label, value], index) => (
            <div key={index} className="grid gap-2">
              <Skeleton shape="line" style={{ width: `${label}%` }} />
              <Skeleton shape="line" style={{ width: `${value}%` }} />
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </div>
  )
}
