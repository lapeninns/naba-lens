import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** The welcome guide's own skeleton (it has no TabBar and no Home header). */
export default function WelcomeLoading() {
  const card = "grid gap-3 rounded-card bg-surface p-4 shadow-card"
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto grid w-full max-w-xl gap-1 px-4 py-3">
          <p className="font-display text-page-title-compact text-ink">
            Naba-Lens
          </p>
          <Skeleton shape="line" className="w-48" />
        </div>
      </div>
      <SkeletonRegion
        label="Loading the welcome guide…"
        className="mx-auto grid w-full max-w-xl gap-(--gutter) px-(--page-gutter) py-4 md:py-8"
      >
        <div className={card}>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton shape="line" />
          <Skeleton shape="line" className="w-3/4" />
        </div>
        <div className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 p-3"
            >
              <Skeleton shape="av" />
              <div className="grid gap-2">
                <Skeleton shape="line" className="w-1/2" />
                <Skeleton shape="line" />
              </div>
            </div>
          ))}
        </div>
        <div className={card}>
          <Skeleton shape="title" />
          <Skeleton shape="line" />
          <Skeleton className="h-11 w-1/2" />
        </div>
      </SkeletonRegion>
    </div>
  )
}
