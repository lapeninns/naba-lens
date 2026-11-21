"use client"

import { usePathname } from "next/navigation"

import { AdminErrorPage } from "../_components/admin-boundary"
import { ADMIN_SECTION_TITLES, AdminTabs } from "../_components/admin-tabs"

/**
 * People › Accounts, or one person's page, that could not load (redesign
 * R5): named after People, never Library.
 */
export default function AdminStaffError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const person = (usePathname() ?? "").startsWith("/admin/staff/")
  return person ? (
    <AdminErrorPage
      section="staff"
      title="Staff member"
      back={{ href: "/admin/staff", label: ADMIN_SECTION_TITLES.people }}
      what="This account couldn't be loaded"
      error={error}
      retry={retry}
    />
  ) : (
    <AdminErrorPage
      section="staff"
      title={ADMIN_SECTION_TITLES.people}
      tabs={<AdminTabs set="people" active="accounts" />}
      what="We couldn't load the staff list"
      error={error}
      retry={retry}
    />
  )
}
