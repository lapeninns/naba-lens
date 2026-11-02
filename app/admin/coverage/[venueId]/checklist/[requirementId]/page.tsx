import type { Metadata } from "next"

import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import { RequirementScreen } from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = {
  title: "Checklist item · Venue coverage · Naba-Lens",
}

export default async function AdminVenueRequirementPage({
  params,
}: {
  params: Promise<{ venueId: string; requirementId: string }>
}) {
  const { venueId, requirementId } = await params
  const ctx = await adminVenueContext(venueId)
  return <RequirementScreen ctx={ctx} requirementId={requirementId} />
}
