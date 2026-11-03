import type { Metadata } from "next"

import { logout } from "@/app/_media/actions"
import {
  AppShell,
  MenuVenueList,
  MenuVenueTally,
} from "@/components/nabalens"
import { ErrorState, ERROR_COPY } from "@/components/nabalens/error-state"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { requireActiveAdmin } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import { listMenuVenues } from "@/lib/server/menus"

import { MenusHeader } from "./menus-header"
import { RetryButton } from "./retry-button"

export const metadata: Metadata = { title: "Menus · Naba-Lens" }

const venueHref = (venueId: string) =>
  `/admin/menus/${encodeURIComponent(venueId)}`

/** Admin → Menus: every venue with its active menu, drafts and suggestions. */
export default async function MenusPage() {
  const profile = await requireActiveAdmin()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const result = await listMenuVenues(auth.actor)

  return (
    <AppShell
      variant="admin"
      active="menus"
      userName={profile.displayName}
      logoutAction={logout}
    >
      <MenusHeader />
      <div className="grid gap-6 md:gap-8">
        <OfflineNotice />
        {result.ok ? (
          <>
            {result.venues.length > 0 ? (
              <MenuVenueTally venues={result.venues} />
            ) : null}
            <MenuVenueList venues={result.venues} getVenueHref={venueHref} />
          </>
        ) : (
          <ErrorState
            title={ERROR_COPY.couldNotLoad("menus")}
            action={<RetryButton />}
          >
            {ERROR_COPY.checkConnection} No menu has changed.
          </ErrorState>
        )}
      </div>
    </AppShell>
  )
}
