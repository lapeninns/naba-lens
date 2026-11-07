import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** The task thread in its real shape: task post, progress card, a photo post. */
export default function TaskLoading() {
  return (
    <SkeletonRegion
      label="Loading task…"
      className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter) px-(--page-gutter) pt-4 pb-8 md:px-6 md:py-8"
    >
      <Skeleton shape="line" className="h-11 w-24" />
      <div className="grid gap-3.5 rounded-card bg-surface p-4 shadow-card">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
          <Skeleton shape="av" />
          <div className="grid gap-2">
            <Skeleton shape="title" />
            <Skeleton shape="line" className="w-40" />
          </div>
        </div>
        <Skeleton shape="line" className="w-48" />
        <div className="grid gap-2 border-t border-line pt-3.5">
          <Skeleton shape="line" className="w-44" />
          <Skeleton shape="line" />
          <Skeleton shape="line" className="w-3/4" />
        </div>
      </div>
      <div className="grid gap-2.5 rounded-card bg-surface p-4 shadow-card">
        <Skeleton shape="line" className="w-40" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-3 rounded-round" />
        <Skeleton shape="line" className="w-52" />
      </div>
      <Skeleton shape="line" className="mx-1 mt-2 h-6 w-64" />
      <div className="grid overflow-hidden rounded-card bg-surface shadow-card">
        <Skeleton className="aspect-[4/3] rounded-none" />
        <div className="grid gap-2 p-3">
          <Skeleton className="h-8 w-28 rounded-round" />
          <Skeleton shape="line" className="w-40" />
        </div>
      </div>
    </SkeletonRegion>
  )
}
