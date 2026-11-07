import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** The photo guide in its real shape: checklist card, dish filters, angle posts. */
export default function PhotoGuideLoading() {
  return (
    <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8">
      <PageHeader title="Photo guide" />
      <SkeletonRegion
        label="Loading the photo guide…"
        className="flex flex-col gap-(--gutter)"
      >
        <div className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
          <Skeleton shape="title" className="w-40" />
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} shape="line" className={n % 2 ? "w-3/4" : ""} />
          ))}
        </div>
        <Skeleton shape="line" className="mx-1 mt-2 h-6 w-48" />
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-11 w-28 rounded-round" />
          ))}
        </div>
        <div className="grid overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex items-center gap-2.5 p-3">
            <Skeleton shape="av" className="size-9" />
            <Skeleton shape="line" className="w-32" />
          </div>
          <Skeleton className="aspect-[4/3] rounded-none" />
          <div className="grid gap-2 p-3">
            <Skeleton shape="line" />
            <Skeleton shape="line" className="w-2/3" />
          </div>
        </div>
      </SkeletonRegion>
    </div>
  )
}
