"use client"

import { useParams, usePathname } from "next/navigation"

import { AdminErrorPage } from "../_components/admin-boundary"
import { AdminVenueTabs } from "../_components/admin-tabs"

/**
 * A failed venues read (redesign R5): the list, Add a venue, or one venue's
 * Setup tab, each under its own title, with Retry.
 */
export default function AdminVenuesError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const pathname = usePathname() ?? ""
  const { venueId } = useParams<{ venueId?: string }>() ?? {}
  const back = { href: "/admin/venues", label: "Venues" }
  if (venueId)
    return (
      <AdminErrorPage
        section="venues"
        title="Setup"
        back={back}
        tabs={
          <AdminVenueTabs
            venueId={venueId}
            venueName="This venue"
            active="setup"
          />
        }
        what="This venue's setup couldn't be loaded"
        error={error}
        retry={retry}
      />
    )
  return pathname.startsWith("/admin/venues/new") ? (
    <AdminErrorPage
      section="venues"
      title="Add a venue"
      back={back}
      what="Add a venue couldn't be loaded"
      error={error}
      retry={retry}
    />
  ) : (
    <AdminErrorPage
      section="venues"
      title="Venues"
      what="Venues couldn't be loaded"
      error={error}
      retry={retry}
    />
  )
}
