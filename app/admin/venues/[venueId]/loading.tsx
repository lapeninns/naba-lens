"use client"

import { useParams } from "next/navigation"

import { AdminLoadingPage } from "../../_components/admin-boundary"
import { AdminVenueTabs } from "../../_components/admin-tabs"

/** Venues › one venue › Setup while it loads (redesign R5). */
export default function AdminVenueLoading() {
  const { venueId = "" } = useParams<{ venueId?: string }>() ?? {}
  return (
    <AdminLoadingPage
      section="venues"
      title="Setup"
      back={{ href: "/admin/venues", label: "Venues" }}
      tabs={
        venueId ? (
          <AdminVenueTabs
            venueId={venueId}
            venueName="This venue"
            active="setup"
          />
        ) : undefined
      }
      label="Loading the venue"
      rows={5}
    />
  )
}
