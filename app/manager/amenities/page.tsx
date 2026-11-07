import type { Metadata } from "next"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { AmenitiesScreen } from "@/app/staff/manage/_shared/screens/amenities"

export const metadata: Metadata = { title: "Amenities · Naba-Lens" }

/**
 * Amenities: the venue's amenity checks, the same screen as /staff/manage
 * inside the workspace shell. Without an effective grant it goes to /manager
 * (Venue access unavailable).
 */
export default async function ManagerAmenitiesPage() {
  const ctx = await workspaceManagerContext()
  return <AmenitiesScreen ctx={ctx} />
}
