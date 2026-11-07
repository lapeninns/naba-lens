import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** Manage's skeleton in the real layout: header, tabs, then a feed of cards. */
export default function ManageLoading() {
  return (
    <SkeletonRegion
      label="Loading…"
      className="mx-auto grid w-full max-w-(--size-page) gap-(--gutter) px-(--page-gutter) py-4 md:gap-4 md:px-6 md:py-8"
    >
      <div className="grid gap-2 px-1">
        <Skeleton shape="line" className="w-40" />
        <Skeleton shape="title" className="w-64 max-w-full" />
      </div>
      <Skeleton className="h-11 w-full max-w-xl" />
      <div className="grid gap-(--gutter) sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <div
            key={card}
            className="grid gap-3 rounded-card bg-surface p-4 shadow-card"
          >
            <Skeleton shape="title" className="w-1/2" />
            <Skeleton shape="line" className="w-3/4" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}
