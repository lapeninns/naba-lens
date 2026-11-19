import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

export default function AmenityCaptureLoading() {
  return (
    <SkeletonRegion
      label="Loading amenity check…"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8"
    >
      <Skeleton shape="line" className="w-24" />
      <div className="flex flex-col gap-2">
        <Skeleton shape="line" className="w-40" />
        <Skeleton shape="title" />
      </div>
      <Skeleton className="h-24 rounded-panel" />
      <div className="grid gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-13 rounded-control" />
        ))}
      </div>
      <Skeleton className="h-24 rounded-panel" />
    </SkeletonRegion>
  )
}
