import type { Metadata } from "next"

import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import { PlacesScreen } from "@/app/staff/manage/_shared/screens/amenities"

export const metadata: Metadata = {
  title: "Places · Venue coverage · Naba-Lens",
}

export default async function AdminVenuePlacesPage({
  params,
}: {
  params: Promise<{ venueId: string }>
}) {
  const { venueId } = await params
  const ctx = await adminVenueContext(venueId)
  return <PlacesScreen ctx={ctx} />
}
