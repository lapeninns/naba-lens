import { Suspense } from "react"
import type { Metadata } from "next"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { AmenitiesScreen } from "@/app/staff/manage/_shared/screens/amenities"
import { ManagerEntrySection } from "@/components/nabalens/shell/manager-entry"
import { contributionEntry } from "@/lib/config/contribution-entry"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { entryMenu, type EntryMenu } from "@/lib/work-client/entry"
import { workServices } from "@/lib/work-client/services"

export const metadata: Metadata = { title: "Amenities · Naba-Lens" }

type Workspace = Awaited<ReturnType<typeof workspaceManagerContext>>

/**
 * The shared entry for this manager account (B02-02, §5.3), from its
 * capabilities: none when the entry is off for the venue, or the
 * capabilities or the working list can't be read.
 */
async function managerEntry(ctx: Workspace): Promise<EntryMenu | null> {
  if (contributionEntry(ctx.venueId) !== "b02") return null
  try {
    const [capabilities, list] = await Promise.all([
      workServices.getCapabilities(ctx.actor),
      knowledgeServices.getWorkingList(ctx.actor, {}),
    ])
    if (capabilities.status !== "ok" || !list.ok || !list.view) return null
    if (list.view.venue.id !== ctx.venueId) return null
    return entryMenu(capabilities.value, {
      venueName: ctx.venue.name,
      slots: list.view.slots,
      tasks: [],
    })
  } catch {
    return null
  }
}

/**
 * Amenities: the venue's amenity checks, the same screen as /staff/manage
 * inside the workspace shell. Without an effective grant it goes to /manager
 * (Venue access unavailable). Below it, what this account can add itself.
 */
export default async function ManagerAmenitiesPage() {
  const ctx = await workspaceManagerContext()
  return (
    <div className="grid gap-6">
      <AmenitiesScreen ctx={ctx} />
      {/* Read alongside the screen; it never holds the checks back. */}
      <Suspense fallback={null}>
        <ManagerEntry ctx={ctx} />
      </Suspense>
    </div>
  )
}

async function ManagerEntry({ ctx }: { ctx: Workspace }) {
  const entry = await managerEntry(ctx)
  return entry ? <ManagerEntrySection menu={entry} /> : null
}
