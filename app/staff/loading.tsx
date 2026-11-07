import { MediaGridSkeleton } from "@/components/nabalens"
import { Skeleton } from "@/components/ui/skeleton"

/** Me's skeleton in the real layout: the profile card, then the photos. */
export default function StaffLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-(--gutter) px-(--page-gutter) py-4 md:px-6 md:py-8">
      <div className="flex items-center gap-4 rounded-card bg-surface p-4 shadow-card">
        <Skeleton shape="av" className="size-16" />
        <div className="grid min-w-0 flex-1 gap-2">
          <Skeleton shape="title" className="w-40 max-w-full" />
          <Skeleton shape="line" className="w-56 max-w-full" />
        </div>
      </div>
      <MediaGridSkeleton />
    </div>
  )
}
