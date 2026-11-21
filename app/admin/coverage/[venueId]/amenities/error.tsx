"use client"

import { AdminVenueErrorPage } from "../../../_components/admin-boundary"

/** Album › Amenities (or Spaces) that could not load. */
export default function AdminVenueAmenitiesError({
  retry,
}: {
  retry: () => void
}) {
  return <AdminVenueErrorPage retry={retry} />
}
