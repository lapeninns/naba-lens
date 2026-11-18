import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** Exceptions, then the operations tiles and the form (spec §8 A7). */
export default function AdminSettingsLoading() {
  return (
    <AppShell variant="admin" active="settings">
      <div className="flex flex-col gap-8">
        <PageHeader
          scope="All venues"
          title="Settings"
          className="pb-0 md:pb-0"
        />
        <SkeletonRegion label="Loading settings" className="grid gap-6">
          <Skeleton shape="title" className="w-48" />
          <div className="grid gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} shape="line" className="h-16" />
            ))}
          </div>
          <Skeleton shape="title" className="w-64" />
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} shape="line" className="h-24" />
          ))}
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
