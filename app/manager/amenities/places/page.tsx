import type { Metadata } from "next"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { PlacesScreen } from "@/app/staff/manage/_shared/screens/amenities"

export const metadata: Metadata = { title: "Spaces" }

/**
 * Album › Spaces: the workspace venue's places (B03-b; redesign R4, ia.md).
 * The shared screen draws the Album title and the section's tabs.
 */
export default async function ManagerPlacesPage() {
  const ctx = await workspaceManagerContext()
  return (
    <div className="grid gap-6">
      <PlacesScreen ctx={ctx} />
    </div>
  )
}
