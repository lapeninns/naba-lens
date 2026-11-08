import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { VENUE_COVERAGE_COPY } from "../coverage-copy"

const ROWS = [
  ["58%", "34%"],
  ["50%", "30%"],
  ["64%", "38%"],
  ["46%", "28%"],
] as const

export default function VenueCoverageLoading() {
  return (
    <AppShell variant="admin" active="coverage">
      <div className="flex flex-col gap-6">
        <PageHeader
          title={VENUE_COVERAGE_COPY.title}
          className="pb-0 md:pb-0"
        />
        <SkeletonRegion
          label={VENUE_COVERAGE_COPY.loading}
          className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
        >
          {ROWS.map(([first, second], i) => (
            <div key={i} className="grid min-h-16 gap-2 px-4 py-3.5">
              <Skeleton shape="line" style={{ width: first }} />
              <Skeleton shape="line" style={{ width: second }} />
            </div>
          ))}
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
