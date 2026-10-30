import { MediaGridSkeleton } from "@/components/nabalens"
import { Skeleton } from "@/components/ui/skeleton"

export default function StaffLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
      <MediaGridSkeleton />
    </div>
  )
}
