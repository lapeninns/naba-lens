import type { Metadata } from "next"

import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import { MenuScreen } from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = {
  title: "Menu coverage · Venue coverage · Naba-Lens",
}

export default async function AdminVenueMenuPage({
  params,
}: {
  params: Promise<{ venueId: string }>
}) {
  const { venueId } = await params
  const ctx = await adminVenueContext(venueId)
  return <MenuScreen ctx={ctx} />
}
