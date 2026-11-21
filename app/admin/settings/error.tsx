"use client"

import { usePathname } from "next/navigation"

import { AdminErrorPage } from "../_components/admin-boundary"
import { ADMIN_SECTION_TITLES, AdminTabs } from "../_components/admin-tabs"

/** Settings › Rules, or a shot template under it, that could not load. */
export default function AdminSettingsError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const template = (usePathname() ?? "").includes("/shot-templates/")
  return template ? (
    <AdminErrorPage
      section="settings"
      title="Shot template"
      back={{ href: "/admin/settings#shot-templates", label: "Settings" }}
      what="This shot template couldn't be loaded"
      error={error}
      retry={retry}
    />
  ) : (
    <AdminErrorPage
      section="settings"
      title={ADMIN_SECTION_TITLES.settings}
      tabs={<AdminTabs set="settings" active="rules" />}
      what="Settings couldn't be loaded"
      error={error}
      retry={retry}
    />
  )
}
