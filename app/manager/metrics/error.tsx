"use client"

import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceError } from "@/components/nabalens/manager/workspace-error"
import { METRICS_COPY } from "@/components/nabalens/metrics/copy"

export default function ManagerMetricsError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <ManagerWorkspaceError
      title={METRICS_COPY.title}
      what={METRICS_COPY.what}
      error={error}
      retry={retry}
      back={{ href: managerHrefs.overview, label: MANAGER_COPY.overview.title }}
    />
  )
}
