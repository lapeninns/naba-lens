import type { Metadata } from "next"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { PlacesScreen } from "@/app/staff/manage/_shared/screens/amenities"
import { ManagerTabs } from "@/components/nabalens/manager/manager-tabs"

export const metadata: Metadata = { title: "Spaces" }

/**
 * Album › Spaces: the workspace venue's places (B03-b; redesign R4, ia.md).
 * The shared screen draws the title, so the section's tabs sit above it.
 */
export default async function ManagerPlacesPage() {
  const ctx = await workspaceManagerContext()
  return (
    <div className="grid gap-6">
      <ManagerTabs section="album" active="spaces" />
      <PlacesScreen ctx={ctx} />
    </div>
  )
}
