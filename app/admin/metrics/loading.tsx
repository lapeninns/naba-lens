import { AppShell } from "@/components/nabalens/app-shell"
import { METRICS_COPY } from "@/components/nabalens/metrics/copy"
import { PageHeader } from "@/components/nabalens/page-header"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/** The attention tiles, then the venues table (spec §18.1). */
export default function AdminMetricsLoading() {
  return (
    <AppShell variant="admin" active="coverage">
      <div className="flex flex-col gap-8">
        <PageHeader
          scope="All venues"
          title={METRICS_COPY.title}
          className="pb-0 md:pb-0"
        />
        <SkeletonRegion label={METRICS_COPY.loading} className="grid gap-6">
          <div className="grid gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} shape="line" className="h-16" />
            ))}
          </div>
          <Skeleton shape="title" className="w-48" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} shape="line" className="h-14" />
          ))}
        </SkeletonRegion>
      </div>
    </AppShell>
  )
}
