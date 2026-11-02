import type { Metadata } from "next"

import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import { ChecklistScreen } from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = {
  title: "Checklist · Venue coverage · Naba-Lens",
}

export default async function AdminVenueChecklistPage({
  params,
}: {
  params: Promise<{ venueId: string }>
}) {
  const { venueId } = await params
  const ctx = await adminVenueContext(venueId)
  return <ChecklistScreen ctx={ctx} />
}
