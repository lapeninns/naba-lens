import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

export default function ManageMenuItemsLoading() {
  return (
    <SkeletonRegion
      label="Loading menu photos to review…"
      className="mx-auto grid w-full max-w-(--size-page) gap-4 px-4 py-6 sm:px-6 sm:py-8"
    >
      <div className="grid gap-2">
        <Skeleton shape="title" className="w-48" />
        <Skeleton shape="line" className="w-[70%]" />
      </div>
      <div className="grid grid-cols-2 gap-2 md:flex">
        {[0, 1].map((tab) => (
          <Skeleton key={tab} shape="line" className="h-9 md:w-28" />
        ))}
      </div>
      {[0, 1].map((card) => (
        <div
          key={card}
          className="grid gap-5 rounded-panel border border-line bg-panel p-4 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]"
        >
          <Skeleton shape="tile" className="aspect-[4/3]" />
          <div className="grid content-start gap-3">
            <Skeleton shape="line" className="w-3/5" />
            <Skeleton shape="line" className="w-[35%]" />
            <Skeleton shape="line" className="w-[50%]" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}
