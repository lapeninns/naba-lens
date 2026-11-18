import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** The inbox's shapes while it loads: the title, then a few rows. */
export default function NoticesLoading() {
  return (
    <SkeletonRegion
      label="Loading your notices…"
      className="mx-auto grid w-full max-w-feed gap-gutter pb-4"
    >
      <Skeleton shape="title" className="w-1/2" />
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-16 rounded-card" />
      ))}
    </SkeletonRegion>
  )
}
