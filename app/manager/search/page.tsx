import type { Metadata } from "next"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { SearchScreen } from "@/app/staff/manage/_shared/screens"
import { BackLink } from "@/components/nabalens/back-link"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { getManagerWorkspace } from "@/lib/auth/manager"

export const metadata: Metadata = {
  title: "Search photos and videos",
}

/**
 * B05-06 asset search in the manager workspace: the venue's photos and
 * videos. The layout is not re-rendered on client navigation, so a grant that
 * ended mid-session is met here (Venue access unavailable, refreshing the
 * shell); the database checks the grant again on every search.
 */
export default async function ManagerSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available") {
    return <VenueAccessUnavailable reason={workspace.reason} refreshShell />
  }
  const ctx = await workspaceManagerContext()
  // Search opens from Album (redesign R4, ia.md), so its BackLink names Album.
  return (
    <div className="grid gap-1">
      <BackLink href={managerHrefs.menu()} compact>
        Album
      </BackLink>
      <SearchScreen mode="workspace" ctx={ctx} search={await searchParams} />
    </div>
  )
}
