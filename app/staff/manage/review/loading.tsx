import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** Review's skeleton: header, filter pills, then a feed of posts. */
export default function ManageReviewLoading() {
  return (
    <SkeletonRegion
      label="Loading photos to review…"
      className="mx-auto grid w-full max-w-(--size-page) gap-(--gutter) px-(--page-gutter) py-4 md:gap-4 md:px-6 md:py-8"
    >
      <div className="grid gap-2 px-1">
        <Skeleton shape="title" className="w-48" />
        <Skeleton shape="line" className="w-[70%]" />
      </div>
      <div className="flex flex-wrap gap-2">
        {["w-28", "w-52", "w-28", "w-14"].map((width) => (
          <Skeleton key={width} className={`h-11 rounded-round ${width}`} />
        ))}
      </div>
      {[0, 1].map((card) => (
        <div
          key={card}
          className="grid w-full max-w-(--size-feed) overflow-hidden rounded-card bg-surface shadow-card"
        >
          <div className="flex items-center gap-2.5 p-3">
            <Skeleton shape="av" />
            <span className="grid flex-1 gap-2">
              <Skeleton shape="line" className="w-3/5" />
              <Skeleton shape="line" className="w-[35%]" />
            </span>
          </div>
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="grid gap-2 p-3">
            <Skeleton shape="line" className="w-[50%]" />
            <Skeleton shape="line" className="w-[70%]" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}
