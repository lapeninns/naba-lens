import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** The capture form's shape, without the staff page padding (the shell has it). */
export default function ManagerAmenityCaptureLoading() {
  return (
    <SkeletonRegion
      label="Loading amenity check…"
      className="flex flex-col gap-6"
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
