import type { Metadata } from "next"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { PlacesScreen } from "@/app/staff/manage/_shared/screens/amenities"

export const metadata: Metadata = { title: "Places · Naba-Lens" }

/** The workspace venue's places (B03-b). */
export default async function ManagerPlacesPage() {
  const ctx = await workspaceManagerContext()
  return <PlacesScreen ctx={ctx} />
}
