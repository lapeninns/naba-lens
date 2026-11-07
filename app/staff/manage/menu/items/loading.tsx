import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** Our menu's skeleton: header, two filter pills, then posts. */
export default function ManageMenuItemsLoading() {
  return (
    <SkeletonRegion
      label="Loading menu photos to review…"
      className="mx-auto grid w-full max-w-(--size-page) gap-(--gutter) px-(--page-gutter) py-4 md:gap-4 md:px-6 md:py-8"
    >
      <div className="grid gap-2 px-1">
        <Skeleton shape="title" className="w-48" />
        <Skeleton shape="line" className="w-[70%]" />
      </div>
      <div className="flex flex-wrap gap-2">
        {["w-32", "w-28"].map((width) => (
          <Skeleton key={width} className={`h-11 rounded-round ${width}`} />
        ))}
      </div>
      {[0, 1].map((card) => (
        <div
          key={card}
          className="grid w-full max-w-(--size-feed) overflow-hidden rounded-card bg-surface shadow-card"
        >
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="grid gap-2 p-3">
            <Skeleton shape="line" className="w-3/5" />
            <Skeleton shape="line" className="w-[35%]" />
            <Skeleton shape="line" className="w-[50%]" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}
