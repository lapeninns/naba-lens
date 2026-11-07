"use client"

import { AmenitiesError } from "@/app/staff/manage/_shared/screens/amenities-fallbacks"

export default function ManageAmenitiesError({ retry }: { retry: () => void }) {
  return <AmenitiesError title="Amenities" what="amenities" retry={retry} />
}
