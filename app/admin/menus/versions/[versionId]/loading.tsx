import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

const ROWS = [
  ["60%", "35%"],
  ["52%", "30%"],
  ["66%", "40%"],
  ["48%", "28%"],
  ["58%", "36%"],
]

/** The sections beside the About this version card, as they will load. */
export default function MenuVersionLoading() {
  return (
    <div className="mx-auto w-full max-w-(--size-page) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <PageHeader title="Menu version" />
      <SkeletonRegion
        label="Loading the draft…"
        className="grid items-start gap-(--gutter) lg:grid-cols-[minmax(0,1fr)_22rem]"
      >
        <div className="grid gap-(--gutter)">
          {ROWS.map(([title, meta], index) => (
            <div
              key={index}
              className="grid gap-2 rounded-card bg-surface p-4 shadow-card"
            >
              <Skeleton shape="line" style={{ width: title }} />
              <Skeleton shape="line" style={{ width: meta }} />
            </div>
          ))}
        </div>
        <div className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
          <Skeleton shape="title" className="w-48" />
          {ROWS.slice(0, 4).map(([title], index) => (
            <Skeleton key={index} shape="line" style={{ width: title }} />
          ))}
        </div>
      </SkeletonRegion>
    </div>
  )
}
