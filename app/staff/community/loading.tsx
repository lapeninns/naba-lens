import { MediaGridSkeleton } from "@/components/nabalens/media-grid"
import { Skeleton } from "@/components/ui/skeleton"

export default function CommunityLoading() {
  return (
    <div
      aria-label="Loading community"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8"
    >
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-11 w-full max-w-2xl" />
      <MediaGridSkeleton />
    </div>
  )
}
