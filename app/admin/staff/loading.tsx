import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { AdminTabs } from "../_components/admin-tabs"
import { STAFF_SUMMARY } from "./copy"

const ROWS = [
  [60, 35],
  [52, 30],
  [66, 40],
  [48, 28],
  [58, 36],
  [60, 35],
]

/** The directory in its real layout: filter fields, then one card of rows. */
export default function StaffLoading() {
  return (
    // Inside the admin frame, so the nav stays while it loads (redesign R5).
    <AppShell variant="admin" active="staff">
      <div className="grid gap-4">
        <PageHeader
          venueScope
          scope="All venues"
          title="People"
          summary={STAFF_SUMMARY}
          className="pb-0 md:pb-0"
        >
          <AdminTabs set="people" active="accounts" />
        </PageHeader>
        <SkeletonRegion label="Loading staff…" className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3 lg:flex-nowrap">
            {["min-w-48 sm:flex-1", "sm:w-56", "sm:w-40", "sm:w-40"].map(
              (width, index) => (
                <div key={index} className={`grid w-full gap-1.5 ${width}`}>
                  <Skeleton shape="line" className="w-20" />
                  <Skeleton className="h-10" />
                </div>
              )
            )}
          </div>
          <div className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
            {ROWS.map(([name, meta], index) => (
              <div
                key={index}
                className="flex min-h-16 items-center gap-3 px-4 py-3"
              >
                <Skeleton shape="av" />
                <div className="grid flex-1 gap-2">
                  <Skeleton shape="line" style={{ width: `${name}%` }} />
                  <Skeleton shape="line" style={{ width: `${meta}%` }} />
                </div>
              </div>
            ))}
          </div>
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
