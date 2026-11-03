import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

export default function ManageTeamLoading() {
  return (
    <SkeletonRegion
      label="Loading the team…"
      className="mx-auto grid w-full max-w-(--size-page) gap-5 px-4 py-6 sm:px-6 sm:py-8"
    >
      <div className="grid gap-2">
        <Skeleton shape="title" className="w-[40%]" />
        <Skeleton shape="line" className="w-[70%]" />
      </div>
      {[
        ["w-3/5", "w-[35%]"],
        ["w-[52%]", "w-[30%]"],
        ["w-[66%]", "w-[40%]"],
      ].map(([wide, narrow]) => (
        <div key={wide} className="flex items-center gap-3">
          <Skeleton shape="av" />
          <span className="grid flex-1 gap-2">
            <Skeleton shape="line" className={wide} />
            <Skeleton shape="line" className={narrow} />
          </span>
        </div>
      ))}
    </SkeletonRegion>
  )
}
