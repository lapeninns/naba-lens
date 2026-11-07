import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { MANAGERS_COPY } from "./managers-copy"

const ROWS = [
  ["58%", "34%"],
  ["50%", "30%"],
  ["64%", "38%"],
] as const

/** The grant form card, then the current grants card, as they will load. */
export default function ManagersLoading() {
  return (
    <AppShell variant="admin" active="coverage" logoutAction={logout}>
      <div className="flex flex-col gap-6">
        <PageHeader
          venueScope
          scope={MANAGERS_COPY.scope}
          title={MANAGERS_COPY.title}
          summary={MANAGERS_COPY.summary}
          className="pb-0 md:pb-0"
        />
        <SkeletonRegion label={MANAGERS_COPY.loading} className="grid gap-6">
          <div className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
            <Skeleton shape="title" className="w-64 max-w-full" />
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid gap-1.5">
                  <Skeleton shape="line" className="w-24" />
                  <Skeleton className="h-14" />
                </div>
              ))}
              <Skeleton className="h-13 md:w-48" />
            </div>
          </div>
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
