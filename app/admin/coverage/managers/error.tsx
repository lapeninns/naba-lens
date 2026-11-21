"use client"

import { AdminErrorPage } from "../../_components/admin-boundary"
import { ADMIN_SECTION_TITLES, AdminTabs } from "../../_components/admin-tabs"
import { MANAGERS_COPY } from "./managers-copy"

/** People › Venue managers that could not load. */
export default function ManagersError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <AdminErrorPage
      section="staff"
      title={ADMIN_SECTION_TITLES.people}
      tabs={<AdminTabs set="people" active="managers" />}
      what={MANAGERS_COPY.couldNotLoad}
      error={error}
      retry={retry}
    >
      {MANAGERS_COPY.couldNotLoadBody}
    </AdminErrorPage>
  )
}
