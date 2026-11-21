import { AppShell } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

const LINES = [
  [60, 35],
  [52, 30],
  [66, 40],
  [48, 28],
]

/**
 * One account in its real layout (handoff "One person"): the venues table
 * first, then account type beside the Account card.
 */
export default function StaffMemberLoading() {
  return (
    // Inside the admin frame, so the nav stays while it loads (redesign R5).
    <AppShell variant="admin" active="staff">
      <div className="grid gap-4">
        <div className="grid min-w-0 gap-1">
          <BackLink href="/admin/staff" compact>
            People
          </BackLink>
          <PageHeader
            venueScope
            scope="All venues"
            title="Staff member"
            className="pb-0 md:pb-0"
          />
        </div>
        <SkeletonRegion
          label="Loading account…"
          className="grid items-start gap-gutter lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
        >
          <div className="grid gap-3 lg:col-span-2">
            <Skeleton shape="title" className="w-64" />
            <div className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
              {[0, 1].map((index) => (
                <div key={index} className="grid min-h-12 px-4 py-3">
                  <Skeleton shape="line" className="w-3/4" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
            <Skeleton shape="title" className="w-32" />
            <Skeleton shape="line" className="w-2/3" />
            <Skeleton shape="line" className="w-1/2" />
          </div>
          <div className="grid gap-4 rounded-card bg-surface p-4 shadow-card">
            <Skeleton shape="title" className="w-32" />
            {LINES.map(([label, value], index) => (
              <div key={index} className="grid gap-2">
                <Skeleton shape="line" style={{ width: `${label}%` }} />
                <Skeleton shape="line" style={{ width: `${value}%` }} />
              </div>
            ))}
          </div>
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
