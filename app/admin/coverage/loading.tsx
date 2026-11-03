import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { COVERAGE_COPY } from "./coverage-copy"

const ROWS = [
  ["60%", "35%"],
  ["52%", "30%"],
  ["66%", "40%"],
  ["48%", "28%"],
  ["58%", "36%"],
] as const

export default function CoverageLoading() {
  return (
    <AppShell variant="admin" active="coverage" logoutAction={logout}>
      <div className="flex flex-col gap-6">
        {/* Also the boundary for /admin/coverage/[venueId] and /managers. */}
        <PageHeader
          title={COVERAGE_COPY.title}
          className="pb-0 md:pb-0"
        />
        <SkeletonRegion label={COVERAGE_COPY.loading} className="grid gap-5">
          {ROWS.map(([first, second], i) => (
            <div key={i} className="grid gap-2">
              <Skeleton shape="line" style={{ width: first }} />
              <Skeleton shape="line" style={{ width: second }} />
            </div>
          ))}
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
