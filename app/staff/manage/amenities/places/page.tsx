import type { Metadata } from "next"

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { NotManagerPage } from "@/app/staff/manage/_shared/frame"
import { PlacesScreen } from "@/app/staff/manage/_shared/screens/amenities"

export const metadata: Metadata = { title: "Places · Manage · Naba-Lens" }

export default async function ManagePlacesPage() {
  const access = await managerAccess()
  if (!access.ok) return <NotManagerPage viewerName={access.viewerName} />
  return <PlacesScreen ctx={access.ctx} />
}
