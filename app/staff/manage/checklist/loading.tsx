import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** The checklist's skeleton: counts in a card, then rows in a card. */
export default function ManageChecklistLoading() {
  return (
    <SkeletonRegion
      label="Loading the checklist…"
      className="mx-auto grid w-full max-w-(--size-page) gap-(--gutter) px-(--page-gutter) py-4 md:gap-4 md:px-6 md:py-8"
    >
      <div className="grid gap-2 px-1">
        <Skeleton shape="title" className="w-48" />
        <Skeleton shape="line" className="w-[70%]" />
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-card bg-surface p-3 shadow-card md:grid-cols-4">
        {[0, 1, 2, 3].map((tally) => (
          <Skeleton key={tally} className="h-20" />
        ))}
      </div>
      <Skeleton shape="line" className="mx-1 mt-2 h-6 w-40" />
      <div className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
        {[
          ["w-3/5", "w-[35%]"],
          ["w-[52%]", "w-[30%]"],
          ["w-[66%]", "w-[40%]"],
          ["w-[45%]", "w-1/4"],
        ].map(([wide, narrow]) => (
          <div key={wide} className="grid min-h-16 gap-2 p-3">
            <Skeleton shape="line" className={wide} />
            <Skeleton shape="line" className={narrow} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}
