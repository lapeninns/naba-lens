import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { ADMIN_SECTION_TITLES, AdminTabs } from "../_components/admin-tabs"

/**
 * Settings › Rules in its real layout (handoff "Loading"): the rules card
 * beside Operations and Shared set-up, as sunken blocks in their shape.
 */
export default function AdminSettingsLoading() {
  return (
    <AppShell variant="admin" active="settings">
      <div className="flex flex-col gap-8">
        <PageHeader
          scope="All venues"
          title={ADMIN_SECTION_TITLES.settings}
          className="pb-0 md:pb-0"
        >
          <AdminTabs set="settings" active="rules" />
        </PageHeader>
        <SkeletonRegion
          label="Loading settings"
          className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
        >
          <div className="grid gap-3">
            <Skeleton shape="title" className="w-56" />
            <div className="grid gap-4 rounded-card bg-surface p-4 shadow-card sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="grid gap-1.5">
                  <Skeleton shape="line" className="w-2/3" />
                  <Skeleton className="h-10" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-8">
            {[4, 4].map((rows, block) => (
              <div key={block} className="grid gap-3">
                <Skeleton shape="title" className="w-36" />
                <div className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
                  {Array.from({ length: rows }, (_, i) => (
                    <div key={i} className="grid min-h-14 gap-2 px-4 py-3">
                      <Skeleton shape="line" className="w-1/2" />
                      <Skeleton shape="line" className="w-1/3" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
