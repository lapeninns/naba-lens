import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { ADMIN_SECTION_TITLES, AdminTabs } from "../_components/admin-tabs"
import { COVERAGE_COPY } from "./coverage-copy"

const ROWS = [
  ["60%", "35%"],
  ["52%", "30%"],
  ["66%", "40%"],
  ["48%", "28%"],
  ["58%", "36%"],
] as const

/** The two tally cards, counted apart, then the venue rows in one card. */
export default function CoverageLoading() {
  return (
    <AppShell variant="admin" active="overview">
      <div className="flex flex-col gap-6">
        {/* Overview › This month; [venueId] and /managers have their own. */}
        <PageHeader
          title={ADMIN_SECTION_TITLES.overview}
          className="pb-0 md:pb-0"
        >
          <AdminTabs set="overview" active="this-month" />
        </PageHeader>
        <SkeletonRegion label={COVERAGE_COPY.loading} className="grid gap-6">
          <div className="grid items-start gap-gutter lg:grid-cols-2">
            {[3, 3].map((cells, card) => (
              <div
                key={card}
                className="grid gap-3 rounded-card bg-surface p-4 shadow-card"
              >
                <Skeleton shape="title" className="w-48" />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Array.from({ length: cells }, (_, i) => (
                    <Skeleton key={i} className="h-24 rounded-card" />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
            {ROWS.map(([first, second], i) => (
              <div key={i} className="grid min-h-16 gap-2 px-4 py-3.5">
                <Skeleton shape="line" style={{ width: first }} />
                <Skeleton shape="line" style={{ width: second }} />
              </div>
            ))}
          </div>
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
