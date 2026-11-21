"use client"

import { METRICS_COPY } from "@/components/nabalens/metrics/copy"

import { AdminErrorPage } from "../_components/admin-boundary"
import { ADMIN_SECTION_TITLES, AdminTabs } from "../_components/admin-tabs"

export default function AdminMetricsError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <AdminErrorPage
      section="overview"
      title={ADMIN_SECTION_TITLES.overview}
      tabs={<AdminTabs set="overview" active="metrics" />}
      what={METRICS_COPY.loadFailedTitle}
      error={error}
      retry={retry}
    />
  )
}
