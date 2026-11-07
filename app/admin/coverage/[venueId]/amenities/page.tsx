import type { Metadata } from "next"

import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import { AmenitiesScreen } from "@/app/staff/manage/_shared/screens/amenities"

export const metadata: Metadata = {
  title: "Amenities · Venue coverage · Naba-Lens",
}

/** Admins also enable Amenities for the venue. */
export default async function AdminVenueAmenitiesPage({
  params,
}: {
  params: Promise<{ venueId: string }>
}) {
  const { venueId } = await params
  const ctx = await adminVenueContext(venueId)
  return <AmenitiesScreen ctx={ctx} />
}
