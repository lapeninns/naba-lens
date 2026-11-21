import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { AdminTabs } from "../_components/admin-tabs"
import { OVERVIEW_COPY } from "./overview-view"

/** Attention first, then the table's rows, while the overview loads. */
export default function AdminOverviewLoading() {
  return (
    <AppShell variant="admin" active="overview">
      <div className="flex flex-col gap-6">
        <PageHeader
          scope={OVERVIEW_COPY.scope}
          title={OVERVIEW_COPY.title}
          className="pb-0 md:pb-0"
        >
          <AdminTabs set="overview" active="by-venue" />
        </PageHeader>
        <SkeletonRegion label="Loading the overview" className="grid gap-6">
          <div className="grid gap-2 px-1">
            <Skeleton shape="title" className="w-56" />
            <Skeleton shape="line" className="w-72" />
          </div>
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="grid min-h-16 grid-cols-3 gap-3 px-4 py-3.5 md:grid-cols-8"
              >
                {Array.from({ length: 3 }, (_, j) => (
                  <Skeleton key={j} shape="line" />
                ))}
              </div>
            ))}
          </div>
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
