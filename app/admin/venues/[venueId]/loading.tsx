import { AppShell } from "@/components/nabalens/app-shell"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** The venue's header and its setup checklist while they load. */
export default function AdminVenueLoading() {
  return (
    <AppShell variant="admin" active="venues">
      <SkeletonRegion label="Loading the venue" className="grid gap-6">
        <div className="grid gap-2 px-1">
          <Skeleton shape="line" className="w-24" />
          <Skeleton shape="title" className="w-64" />
        </div>
        <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="grid min-h-16 gap-2 px-4 py-3.5">
              <Skeleton shape="line" className="w-56" />
              <Skeleton shape="line" className="w-40" />
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </AppShell>
  )
}
