import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { ADMIN_SECTION_TITLES, AdminTabs } from "../../_components/admin-tabs"
import { MANAGERS_COPY } from "./managers-copy"

const ROWS = [
  ["58%", "34%"],
  ["50%", "30%"],
  ["64%", "38%"],
] as const

/**
 * The current grants, as they will load. The grant form is a Dialog opened
 * from the title row (second handoff), so it has no skeleton of its own.
 */
export default function ManagersLoading() {
  return (
    <AppShell variant="admin" active="staff">
      <div className="flex flex-col gap-6">
        <PageHeader
          venueScope
          scope={MANAGERS_COPY.scope}
          title={ADMIN_SECTION_TITLES.people}
          summary={MANAGERS_COPY.summary}
          className="pb-0 md:pb-0"
        >
          <AdminTabs set="people" active="managers" />
        </PageHeader>
        <SkeletonRegion label={MANAGERS_COPY.loading} className="grid gap-6">
          <div className="grid gap-3">
            <Skeleton shape="title" className="mx-1 w-48" />
            <div className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
              {ROWS.map(([first, second], i) => (
                <div
                  key={i}
                  className="flex min-h-16 items-center gap-3 px-4 py-3"
                >
                  <Skeleton shape="av" />
                  <div className="grid flex-1 gap-2">
                    <Skeleton shape="line" style={{ width: first }} />
                    <Skeleton shape="line" style={{ width: second }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
