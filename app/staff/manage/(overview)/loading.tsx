import { ManageNav } from "@/components/nabalens/coverage"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { currentMonthLabel } from "../_shared/frame"

/** Header and tabs for real; only the body waits. */
export default function OverviewLoading() {
  return (
    <div className="grid gap-6 md:gap-8">
      <div>
        <PageHeader scope={currentMonthLabel()} title="Overview" />
        <ManageNav basePath="/staff/manage" active="overview" />
      </div>
      <SkeletonRegion label="Loading overview…" className="grid gap-6">
        <div className="grid gap-3">
          <Skeleton shape="title" className="w-[30%]" />
          <Skeleton shape="line" className="w-[80%]" />
          <Skeleton shape="line" className="w-[60%]" />
        </div>
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Skeleton shape="line" className="w-[60%]" />
            <Skeleton shape="line" className="w-[35%]" />
          </div>
          <div className="grid gap-2">
            <Skeleton shape="line" className="w-[52%]" />
            <Skeleton shape="line" className="w-[30%]" />
          </div>
        </div>
      </SkeletonRegion>
    </div>
  )
}
