import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

const LINES = [
  [60, 35],
  [52, 30],
  [66, 40],
  [48, 28],
]

/** One account in its real layout: the Photos card beside the Account card. */
export default function StaffMemberLoading() {
  return (
    <div className="mx-auto grid w-full max-w-(--size-page) gap-4 px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <PageHeader
        venueScope
        scope="All venues"
        title="Staff member"
        className="pb-0 md:pb-0"
      />
      <SkeletonRegion
        label="Loading account…"
        className="grid items-start gap-(--gutter) lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]"
      >
        <div className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
          <Skeleton shape="title" className="w-32" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} shape="tile" />
            ))}
          </div>
        </div>
        <div className="grid gap-4 rounded-card bg-surface p-4 shadow-card">
          <Skeleton shape="title" className="w-32" />
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
