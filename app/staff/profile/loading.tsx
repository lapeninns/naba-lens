import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

const ROWS = ["45%", "38%", "52%", "40%", "48%"]

/** The real layout: header, who you are, then the choice list in one card. */
export default function WorkProfileLoading() {
  return (
    <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <PageHeader title="Work details" className="pb-0 md:pb-0" />
      <SkeletonRegion
        label="Loading your work details…"
        className="flex flex-col gap-(--gutter)"
      >
        <div className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-card">
          <Skeleton shape="av" />
          <div className="grid flex-1 gap-2">
            <Skeleton shape="line" className="w-[45%]" />
            <Skeleton shape="line" className="w-[30%]" />
          </div>
        </div>
        <div className="grid gap-2 px-1 pt-2">
          <Skeleton className="h-7 w-[70%]" />
          <Skeleton shape="line" className="w-[90%]" />
        </div>
        <div className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
          {ROWS.map((width, i) => (
            <div key={i} className="flex min-h-16 items-center gap-3 px-4">
              <Skeleton className="size-6 rounded-round" />
              <Skeleton shape="line" style={{ width }} />
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </div>
  )
}
