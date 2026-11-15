import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"
import { homeLayout } from "@/lib/config/home-layout"

/** Static card shapes where Home's feed will be (no shimmer). */
const CARD = "grid gap-3 rounded-card bg-surface p-4 shadow-card"

export default function TasksLoading() {
  if (homeLayout() === "goals") return <GoalsLoading />
  return (
    <div className="mx-auto grid w-full max-w-feed min-w-0 gap-gutter px-page-gutter py-4 md:px-0 md:py-8">
      <PageHeader title="Home" className="pb-1 md:pb-2" />
      <SkeletonRegion label="Loading your tasks…" className="grid gap-gutter">
        {/* The share box */}
        <div className={CARD}>
          <Skeleton shape="title" />
          <Skeleton className="h-13 rounded-control" />
        </div>
        {/* To do: the lead card */}
        <div className={CARD}>
          <Skeleton shape="line" className="w-1/3" />
          <Skeleton shape="title" />
          <Skeleton shape="line" />
          <Skeleton className="h-15 rounded-control" />
        </div>
        {/* Your photos for the month (This month on B02) */}
        <div className={CARD}>
          <Skeleton shape="title" />
          <Skeleton className="h-12 w-1/2" />
          <Skeleton className="h-3 rounded-round" />
        </div>
      </SkeletonRegion>
      {/* B02 keeps Other tasks this month on Home; on B01 they are in All tasks. */}
      {homeLayout() === "b02" ? (
        <>
          <h2 className="mt-3 px-1 pt-2 type-section-title text-ink">
            Other tasks this month
          </h2>
          <SkeletonRegion
            label="Loading tasks…"
            className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
          >
            {[0, 1].map((row) => (
              <div
                key={row}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 p-3"
              >
                <Skeleton shape="av" />
                <div className="grid gap-2">
                  <Skeleton shape="line" className="w-1/3" />
                  <Skeleton shape="line" />
                </div>
              </div>
            ))}
          </SkeletonRegion>
        </>
      ) : null}
    </div>
  )
}

/** Goal-led Home: Our menu with its dish rows, then Your month. */
function GoalsLoading() {
  return (
    <div className="mx-auto grid w-full max-w-feed min-w-0 gap-gutter px-page-gutter py-4 md:px-0 md:py-8">
      <PageHeader title="Home" className="pb-1 md:pb-2" />
      <SkeletonRegion label="Loading Home…" className="grid gap-gutter">
        {/* Our menu: the count, the bar and the dishes still needed */}
        <div className={CARD}>
          <Skeleton shape="title" />
          <Skeleton shape="line" className="w-1/2" />
          <Skeleton className="h-3 rounded-round" />
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3"
            >
              <Skeleton className="aspect-square w-14 rounded-control" />
              <Skeleton shape="line" />
            </div>
          ))}
        </div>
        {/* Your month */}
        <div className={CARD}>
          <Skeleton shape="title" />
          <Skeleton className="h-12 w-1/2" />
          <Skeleton className="h-3 rounded-round" />
        </div>
      </SkeletonRegion>
    </div>
  )
}
