"use client"

import { AdminErrorPage } from "../_components/admin-boundary"
import { ADMIN_SECTION_TITLES, AdminTabs } from "../_components/admin-tabs"

export default function AdminAlbumsError({
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
      tabs={<AdminTabs set="overview" active="albums" />}
      what="Albums couldn't be loaded"
      error={error}
      retry={retry}
    />
  )
}
