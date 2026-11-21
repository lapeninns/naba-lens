import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerTabs } from "@/components/nabalens/manager/manager-tabs"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"
import { METRICS_COPY } from "@/components/nabalens/metrics/copy"

/** Venue › Progress loading, with the real title and tabs. */
export default function ManagerMetricsLoading() {
  return (
    <ManagerWorkspaceLoading
      label={METRICS_COPY.loading}
      title={MANAGER_COPY.venue.title}
      tabs={<ManagerTabs section="venue" active="progress" />}
    />
  )
}
