"use client"

import { AdminErrorPage } from "../_components/admin-boundary"
import { ADMIN_SECTION_TITLES, AdminTabs } from "../_components/admin-tabs"
import { COVERAGE_COPY } from "./coverage-copy"

/** Overview › This month; [venueId] and /managers have their own. */
export default function CoverageError({
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
      tabs={<AdminTabs set="overview" active="this-month" />}
      what={COVERAGE_COPY.couldNotLoad}
      error={error}
      retry={retry}
    />
  )
}
