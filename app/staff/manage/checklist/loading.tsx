import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

export default function ManageChecklistLoading() {
  return (
    <SkeletonRegion
      label="Loading the checklist…"
      className="mx-auto grid w-full max-w-(--size-page) gap-5 px-4 py-6 sm:px-6 sm:py-8"
    >
      <div className="grid gap-2">
        <Skeleton shape="title" className="w-48" />
        <Skeleton shape="line" className="w-[70%]" />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[0, 1, 2, 3].map((tally) => (
          <Skeleton key={tally} shape="line" className="h-14" />
        ))}
      </div>
      <Skeleton shape="line" className="h-5 w-40" />
      {[
        ["w-3/5", "w-[35%]"],
        ["w-[52%]", "w-[30%]"],
        ["w-[66%]", "w-[40%]"],
        ["w-[45%]", "w-1/4"],
      ].map(([wide, narrow]) => (
        <div key={wide} className="grid gap-2 border-b border-line pb-3.5">
          <Skeleton shape="line" className={wide} />
          <Skeleton shape="line" className={narrow} />
        </div>
      ))}
    </SkeletonRegion>
  )
}
