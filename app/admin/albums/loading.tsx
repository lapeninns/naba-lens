import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { ADMIN_SECTION_TITLES, AdminTabs } from "../_components/admin-tabs"
import { ADMIN_ALBUMS_COPY } from "./albums-view"

/** The count, then the matrix's rows in one box (DESIGN.md §6.6). */
export default function AdminAlbumsLoading() {
  return (
    <AppShell variant="admin" active="overview">
      <div className="flex flex-col gap-6">
        <PageHeader
          scope={ADMIN_ALBUMS_COPY.scope}
          title={ADMIN_SECTION_TITLES.overview}
          className="pb-0 md:pb-0"
        >
          <AdminTabs set="overview" active="albums" />
        </PageHeader>
        <SkeletonRegion label="Loading albums" className="grid gap-6">
          <div className="grid gap-2 px-1">
            <Skeleton shape="title" className="w-64" />
            <Skeleton shape="line" className="w-48" />
          </div>
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="grid min-h-16 grid-cols-5 gap-3 px-4 py-3.5"
              >
                {Array.from({ length: 5 }, (_, j) => (
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
