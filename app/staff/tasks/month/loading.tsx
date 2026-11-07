import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** Monthly photos in its real shape: month switch, month card, sent rows. */
export default function MonthLoading() {
  return (
    <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <PageHeader
        title="Monthly photos"
        summary="Accepted photos count toward your target. Each photo counts for the month its upload started."
      />
      <SkeletonRegion
        label="Loading your month…"
        className="flex flex-col gap-(--gutter)"
      >
        <div className="grid grid-cols-[minmax(3rem,1fr)_auto_minmax(3rem,1fr)] items-center gap-2 rounded-card bg-surface p-2 shadow-card">
          <Skeleton className="h-12" />
          <Skeleton shape="line" className="w-36" />
          <Skeleton className="h-12" />
        </div>
        <div className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
          <Skeleton shape="title" />
          <Skeleton shape="line" className="w-56" />
          <Skeleton className="h-11 w-40" />
          <Skeleton className="h-3 rounded-round" />
          <Skeleton shape="line" className="w-48" />
        </div>
        <Skeleton shape="line" className="mx-1 mt-2 h-6 w-52" />
        <div className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
          {[0, 1].map((n) => (
            <div
              key={n}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-3"
            >
              <Skeleton className="size-16 sm:size-20" />
              <div className="grid gap-2">
                <Skeleton shape="line" className="w-32" />
                <Skeleton shape="line" className="w-44" />
                <Skeleton className="h-8 w-28 rounded-round" />
              </div>
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </div>
  )
}
