import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** The filters, then the list of changes. */
export default function AdminActivityLoading() {
  return (
    <AppShell variant="admin" active="settings">
      <div className="flex flex-col gap-6">
        <PageHeader
          scope="All venues"
          title="Activity"
          className="pb-0 md:pb-0"
        />
        <SkeletonRegion label="Loading activity" className="grid gap-4">
          <Skeleton shape="line" className="h-20" />
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="grid gap-2 px-4 py-3.5">
                <Skeleton shape="line" className="w-64" />
                <Skeleton shape="line" className="w-40" />
              </div>
            ))}
          </div>
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
