import type { Metadata } from "next"

import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import {
  TeamScreen,
  type ManageSearch,
} from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = { title: "Team · Venue coverage · Naba-Lens" }

/** Admins may also correct past months' targets, with a reason. */
export default async function AdminVenueTeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ venueId: string }>
  searchParams: Promise<ManageSearch>
}) {
  const { venueId } = await params
  const ctx = await adminVenueContext(venueId)
  return <TeamScreen ctx={ctx} search={await searchParams} />
}
