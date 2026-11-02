import type { Metadata } from "next"

import { adminVenueContext } from "@/app/staff/manage/_shared/context"
import {
  ReviewScreen,
  type ManageSearch,
} from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = {
  title: "Review · Venue coverage · Naba-Lens",
}

export default async function AdminVenueReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ venueId: string }>
  searchParams: Promise<ManageSearch>
}) {
  const { venueId } = await params
  const ctx = await adminVenueContext(venueId)
  return <ReviewScreen ctx={ctx} search={await searchParams} />
}
