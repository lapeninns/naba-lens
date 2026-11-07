"use client"

import { AmenitiesError } from "@/app/staff/manage/_shared/screens/amenities-fallbacks"

export default function AdminVenueAmenityCheckError({
  retry,
}: {
  retry: () => void
}) {
  return (
    <AmenitiesError
      title="Amenity check"
      what="this check"
      retry={retry}
      admin
    />
  )
}
