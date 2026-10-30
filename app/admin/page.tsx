import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens"
import { requireActiveAdmin } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import {
  libraryFilterOptions,
  listLibrary,
  parseLibraryFilters,
} from "@/lib/server/media/library"
import { libraryLabelFilterOptions } from "@/lib/server/media/library-labels"

import { AdminLibrary } from "./admin-library"
import { toFilterValue } from "./library-search"

export const metadata = { title: "Content · Naba-Lens" }

/**
 * Admin library: every ready upload across venues, newest first, filtered
 * server-side through URL search params: venue, staff member and type, plus
 * the optional labels (menu item and variant, category, content type,
 * labelled or not, label/note search and an upload date range).
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
  const [options, menu, page] = await Promise.all([
    libraryFilterOptions(auth.actor),
    libraryLabelFilterOptions(auth.actor, filters.venueId),
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
        menuOptions={
          filters.venueId ? { ...menu, venueId: filters.venueId } : null
        }
        filters={toFilterValue(filters)}
        initialPage={{ items: page.items, nextCursor: page.nextCursor }}
      />
    </AppShell>
  )
}
