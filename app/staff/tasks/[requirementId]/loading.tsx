import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

export default function TaskLoading() {
  return (
    <SkeletonRegion
      label="Loading task…"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8"
    >
      <Skeleton shape="line" className="w-24" />
      <div className="flex flex-col gap-2">
        <Skeleton shape="line" className="w-40" />
        <Skeleton shape="title" />
      </div>
      <Skeleton className="h-20 rounded-panel" />
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} shape="tile" />
        ))}
      </div>
    </SkeletonRegion>
  )
}
