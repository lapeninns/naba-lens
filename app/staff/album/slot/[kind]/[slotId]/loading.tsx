import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** A slot page's shapes while it loads: title, the photo square, the brief. */
export default function AlbumSlotLoading() {
  return (
    <SkeletonRegion label="Loading the slot…" className="grid gap-5 pb-4">
      <Skeleton shape="line" className="w-24" />
      <div className="grid gap-2">
        <Skeleton shape="line" className="w-1/3" />
        <Skeleton shape="title" />
      </div>
      <Skeleton shape="tile" className="w-full max-w-80 rounded-card" />
      <Skeleton shape="line" className="w-2/3" />
    </SkeletonRegion>
  )
}
