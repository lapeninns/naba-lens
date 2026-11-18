import { AppShell } from "@/components/nabalens/app-shell"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** The venue rows in one box while the list loads. */
export default function AdminVenuesLoading() {
  return (
    <AppShell variant="admin" active="venues">
      <div className="flex flex-col gap-6">
        <PageHeader
          scope="All venues"
          title="Venues"
          className="pb-0 md:pb-0"
        />
        <SkeletonRegion label="Loading venues" className="grid gap-3">
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="grid min-h-16 gap-2 px-4 py-3.5">
                <Skeleton shape="line" className="w-48" />
                <Skeleton shape="line" className="w-64" />
              </div>
            ))}
          </div>
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
