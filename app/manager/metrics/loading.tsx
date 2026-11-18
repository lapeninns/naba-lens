import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"
import { METRICS_COPY } from "@/components/nabalens/metrics/copy"

export default function ManagerMetricsLoading() {
  return <ManagerWorkspaceLoading label={METRICS_COPY.loading} />
}
