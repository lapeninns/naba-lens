import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** The welcome guide's own skeleton (it has no TabBar and no Home header). */
export default function WelcomeLoading() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-6 md:py-10">
      <p className="font-display text-count-sm text-ink">Naba-Lens</p>
      <SkeletonRegion
        label="Loading the welcome guide…"
        className="flex flex-col gap-6"
      >
        <Skeleton className="h-10 w-2/3 rounded-panel" />
        <Skeleton className="h-40 rounded-panel" />
        <Skeleton className="h-28 rounded-panel" />
        <Skeleton className="h-24 rounded-panel" />
      </SkeletonRegion>
    </div>
  )
}
