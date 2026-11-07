"use client"

import { AmenitiesWorkspaceError } from "../_shared/fallbacks"

export default function ManagerAmenityCheckError({
  retry,
}: {
  retry: () => void
}) {
  return (
    <AmenitiesWorkspaceError
      title="Amenity check"
      what="this check"
      retry={retry}
    />
  )
}
