import type { Metadata } from "next"

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { NotManagerPage } from "@/app/staff/manage/_shared/frame"
import { AmenitiesScreen } from "@/app/staff/manage/_shared/screens/amenities"

export const metadata: Metadata = { title: "Amenities · Manage · Naba-Lens" }

export default async function ManageAmenitiesPage() {
  const access = await managerAccess()
  if (!access.ok) return <NotManagerPage viewerName={access.viewerName} />
  return <AmenitiesScreen ctx={access.ctx} />
}
