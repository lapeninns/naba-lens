import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** The team's skeleton: header, then people as rows in one card. */
export default function ManageTeamLoading() {
  return (
    <SkeletonRegion
      label="Loading the team…"
      className="mx-auto grid w-full max-w-(--size-page) gap-(--gutter) px-(--page-gutter) py-4 md:gap-4 md:px-6 md:py-8"
    >
      <div className="grid gap-2 px-1">
        <Skeleton shape="title" className="w-[40%]" />
        <Skeleton shape="line" className="w-[70%]" />
      </div>
      <div className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
        {[
          ["w-3/5", "w-[35%]"],
          ["w-[52%]", "w-[30%]"],
          ["w-[66%]", "w-[40%]"],
        ].map(([wide, narrow]) => (
          <div key={wide} className="flex items-center gap-3 p-4">
            <Skeleton shape="av" />
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
