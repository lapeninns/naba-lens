import type { Metadata } from "next"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { AmenityCheckScreen } from "@/app/staff/manage/_shared/screens/amenities"

export const metadata: Metadata = { title: "Amenity check · Naba-Lens" }

/**
 * One amenity check of the workspace venue. Another venue's check, or an id
 * that is not a check, is not found.
 */
export default async function ManagerAmenityCheckPage({
  params,
}: {
  params: Promise<{ checkId: string }>
}) {
  const { checkId } = await params
  const ctx = await workspaceManagerContext()
  return <AmenityCheckScreen ctx={ctx} checkId={checkId} />
}
