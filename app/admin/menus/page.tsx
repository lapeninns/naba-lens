import type { Metadata } from "next"

import { logout } from "@/app/_media/actions"
import { AppShell, MenuVenueList } from "@/components/nabalens"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { requireActiveAdmin } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import { listMenuVenues } from "@/lib/server/menus"

export const metadata: Metadata = { title: "Menus · NabaLens" }

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
      <div className="grid gap-4">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold">Menus</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Menus are used to label photos and videos. Activating a menu does
            not publish it or change any venue website.
          </p>
        </div>
        {result.ok ? (
          <MenuVenueList venues={result.venues} getVenueHref={venueHref} />
        ) : (
          <Alert variant="destructive">
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        )}
      </div>
    </AppShell>
  )
}
