import type { Metadata } from "next"

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { NotManagerPage } from "@/app/staff/manage/_shared/frame"
import { AmenityCheckScreen } from "@/app/staff/manage/_shared/screens/amenities"

export const metadata: Metadata = {
  title: "Amenity check · Manage · Naba-Lens",
}

export default async function ManageAmenityCheckPage({
  params,
}: {
  params: Promise<{ checkId: string }>
}) {
  const { checkId } = await params
  const access = await managerAccess()
  if (!access.ok) return <NotManagerPage viewerName={access.viewerName} />
  return <AmenityCheckScreen ctx={access.ctx} checkId={checkId} />
}
