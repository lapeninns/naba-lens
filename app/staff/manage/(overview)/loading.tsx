import { ManageNav } from "@/components/nabalens/coverage"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { currentMonthLabel } from "../_shared/frame"

const CARD = "grid gap-3 rounded-card bg-surface p-4 shadow-card"

/** Header and tabs for real; only the body waits, in the overview's cards. */
export default function OverviewLoading() {
  return (
    <div className="grid gap-(--gutter) md:gap-4">
      <div className="grid gap-1">
        <PageHeader scope={currentMonthLabel()} title="Overview" />
        <ManageNav basePath="/staff/manage" active="overview" />
      </div>
      <SkeletonRegion
        label="Loading overview…"
        className="grid gap-(--gutter) md:gap-4"
      >
        <div className={CARD}>
          <Skeleton shape="title" className="w-[55%]" />
          <Skeleton shape="line" className="w-[80%]" />
          <Skeleton shape="line" className="w-[60%]" />
          <Skeleton className="h-13 w-full" />
        </div>
        <div className="grid gap-(--gutter) md:grid-cols-2 md:gap-4">
          {[0, 1].map((tally) => (
            <div key={tally} className="grid gap-(--gutter)">
              <Skeleton shape="line" className="mx-1 mt-2 h-6 w-[45%]" />
              <div className="grid grid-cols-2 gap-2 rounded-card bg-surface p-3 shadow-card">
                {[0, 1, 2].map((tile) => (
                  <Skeleton key={tile} className="h-20" />
                ))}
              </div>
            </div>
          ))}
        </div>
        <Skeleton shape="line" className="mx-1 mt-2 h-6 w-[40%]" />
        <div className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
          {[
            ["w-[60%]", "w-[35%]"],
            ["w-[52%]", "w-[30%]"],
          ].map(([wide, narrow]) => (
            <div key={wide} className="grid min-h-16 gap-2 p-3">
              <Skeleton shape="line" className={wide} />
              <Skeleton shape="line" className={narrow} />
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </div>
  )
}
