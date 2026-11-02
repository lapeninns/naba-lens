import type { Metadata } from "next"

import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import { OverviewScreen } from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = { title: "Venue coverage · Naba-Lens" }

/** An admin opens any venue's coverage tools (the same tools a manager has). */
export default async function AdminVenueCoveragePage({
  params,
}: {
  params: Promise<{ venueId: string }>
}) {
  const { venueId } = await params
  const ctx = await adminVenueContext(venueId)
  return <OverviewScreen ctx={ctx} />
}
