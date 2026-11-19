import type { Metadata } from "next"

import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import { AmenityCheckScreen } from "@/app/staff/manage/_shared/screens/amenities"

export const metadata: Metadata = {
  title: "Amenity check · Venue coverage · Naba-Lens",
}

export default async function AdminVenueAmenityCheckPage({
  params,
}: {
  params: Promise<{ venueId: string; checkId: string }>
}) {
  const { venueId, checkId } = await params
  const ctx = await adminVenueContext(venueId)
  return <AmenityCheckScreen ctx={ctx} checkId={checkId} />
}
