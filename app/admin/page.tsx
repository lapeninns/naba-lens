import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens"
import { requireActiveAdmin } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import {
  libraryFilterOptions,
  listLibrary,
  parseLibraryFilters,
} from "@/lib/server/media/library"

import { AdminLibrary } from "./admin-library"

export const metadata = { title: "Content · NabaLens" }

/**
 * Admin library: every ready upload across venues, newest first, filtered by
 * venue, staff member and type through URL search params (server-side).
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const filters = parseLibraryFilters(await searchParams)
  const [options, page] = await Promise.all([
    libraryFilterOptions(auth.actor),
    listLibrary(auth.actor, filters),
  ])
  if (!page.ok) throw new Error(page.message)

  return (
    <AppShell
      variant="admin"
      active="content"
      userName={profile.displayName}
      logoutAction={logout}
    >
      <AdminLibrary
        venues={options.venues}
        staff={options.staff}
        filters={{
          venueId: filters.venueId,
          staffId: filters.staffId,
          type: filters.type ?? "all",
        }}
        initialPage={{ items: page.items, nextCursor: page.nextCursor }}
      />
    </AppShell>
  )
}
