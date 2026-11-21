"use client"

import { AdminErrorPage } from "../_components/admin-boundary"
import { ADMIN_SECTION_TITLES, AdminTabs } from "../_components/admin-tabs"

/** A failed overview read: what happened and Retry. */
export default function AdminOverviewError({
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
      tabs={<AdminTabs set="overview" active="by-venue" />}
      what="The overview couldn't be loaded"
      error={error}
      retry={retry}
    />
  )
}
