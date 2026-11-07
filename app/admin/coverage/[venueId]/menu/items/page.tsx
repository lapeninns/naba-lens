import type { Metadata } from "next"

import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import type { ManageSearch } from "@/app/staff/manage/_shared/screens"
import { MenuItemsScreen } from "@/app/staff/manage/_shared/screens/menu-items"

export const metadata: Metadata = {
  title: "Our menu · Venue coverage · Naba-Lens",
}

export default async function AdminVenueMenuItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ venueId: string }>
  searchParams: Promise<ManageSearch>
}) {
  const { venueId } = await params
  const ctx = await adminVenueContext(venueId)
  return <MenuItemsScreen ctx={ctx} search={await searchParams} />
}
