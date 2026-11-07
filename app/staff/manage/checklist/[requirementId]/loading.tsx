import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

const CARD = "grid gap-3 rounded-card bg-surface p-4 shadow-card"

/** One item's skeleton: its state card, setup, then who photographs it. */
export default function ManageRequirementLoading() {
  return (
    <SkeletonRegion
      label="Loading the item…"
      className="mx-auto grid w-full max-w-(--size-page) gap-(--gutter) px-(--page-gutter) py-4 md:gap-4 md:px-6 md:py-8"
    >
      <div className="grid gap-2 px-1">
        <Skeleton shape="title" className="w-[40%]" />
        <Skeleton shape="line" className="w-[70%]" />
      </div>
      <div className={CARD}>
        <Skeleton className="h-8 w-32 rounded-round" />
        <Skeleton shape="line" className="w-[60%]" />
      </div>
      <div className={CARD}>
        <Skeleton shape="line" className="w-[45%]" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
      <div className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
        {[
          ["w-3/5", "w-[35%]"],
          ["w-[52%]", "w-[30%]"],
        ].map(([wide, narrow]) => (
          <div key={wide} className="flex items-center gap-3 p-4">
            <Skeleton className="size-6" />
            <span className="grid flex-1 gap-2">
              <Skeleton shape="line" className={wide} />
              <Skeleton shape="line" className={narrow} />
            </span>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}
