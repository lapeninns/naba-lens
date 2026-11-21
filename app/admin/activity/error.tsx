"use client"

import { AdminErrorPage } from "../_components/admin-boundary"
import { ADMIN_SECTION_TITLES, AdminTabs } from "../_components/admin-tabs"

export default function AdminActivityError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <AdminErrorPage
      section="settings"
      title={ADMIN_SECTION_TITLES.settings}
      tabs={<AdminTabs set="settings" active="activity" />}
      what="Activity couldn't be loaded"
      error={error}
      retry={retry}
    />
  )
}
