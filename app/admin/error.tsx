"use client"

import { AdminErrorPage } from "./_components/admin-boundary"

/**
 * An admin page with no boundary of its own (each section has one; redesign
 * R5): the admin nav stays and the notice says only that this page failed.
 * Never titled "Library": Library › Photos has its own in (content).
 */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <AdminErrorPage
      section="overview"
      title="This page"
      back={{ href: "/admin/overview", label: "Overview" }}
      what="This page couldn't be loaded"
      error={error}
      retry={retry}
    />
  )
}
