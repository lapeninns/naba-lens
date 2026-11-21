"use client"

import { useParams } from "next/navigation"

import { AdminErrorPage } from "../../../../_components/admin-boundary"
import { adminVenueHrefs } from "../../../../_components/admin-tabs"

/** One amenity question that could not load, under Album › Amenities. */
export default function AdminVenueAmenityCheckError({
  retry,
}: {
  retry: () => void
}) {
  const { venueId = "" } = useParams<{ venueId?: string }>() ?? {}
  return (
    <AdminErrorPage
      section="venues"
      title="The question"
      back={{
        href: adminVenueHrefs(venueId).albumAmenities,
        label: "Amenities",
      }}
      what="This question couldn't be loaded"
      retry={retry}
    />
  )
}
