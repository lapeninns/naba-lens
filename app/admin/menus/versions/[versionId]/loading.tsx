import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

const ROWS = [
  ["60%", "35%"],
  ["52%", "30%"],
  ["66%", "40%"],
  ["48%", "28%"],
  ["58%", "36%"],
]

export default function MenuVersionLoading() {
  return (
    <div className="mx-auto w-full max-w-(--size-page) px-4 pt-6 md:px-6 md:py-8">
      <PageHeader title="Menu version" />
      <SkeletonRegion label="Loading the draft…" className="grid gap-5">
        {ROWS.map(([title, meta], index) => (
          <div key={index} className="grid gap-2">
            <Skeleton shape="line" style={{ width: title }} />
            <Skeleton shape="line" style={{ width: meta }} />
          </div>
        ))}
      </SkeletonRegion>
    </div>
  )
}
