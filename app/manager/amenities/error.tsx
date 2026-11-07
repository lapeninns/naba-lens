"use client"

import { AmenitiesWorkspaceError } from "./_shared/fallbacks"

export default function ManagerAmenitiesError({
  retry,
}: {
  retry: () => void
}) {
  return (
    <AmenitiesWorkspaceError title="Amenities" what="amenities" retry={retry} />
  )
}
