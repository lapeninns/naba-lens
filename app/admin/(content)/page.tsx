import { AppShell } from "@/components/nabalens"
import { requireActiveAdmin } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import {
  getFilterLists,
  listCollections,
  listTags,
} from "@/lib/server/library/service"
import {
  libraryFilterOptions,
  listLibrary,
  parseAdminLibraryFilters,
} from "@/lib/server/media/library"
import { libraryLabelFilterOptions } from "@/lib/server/media/library-labels"

import { AdminLibrary } from "../admin-library"
import type { LibraryPageResult } from "../library-actions"
import { toFilterValue } from "../library-search"

export const metadata = { title: "Library" }

/**
 * Admin library: every ready upload across venues, newest first, filtered
 * server-side through URL search params: venue, staff member and type, plus
 * the optional labels (menu item and variant, category, content type,
 * labelled or not, label/note search and an upload date range), and the A4
 * filters (S2-LIBRARY: in use or withdrawn, review state, dates taken,
 * orientation, tag, collection, request, publication destination).
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const filters = parseAdminLibraryFilters(await searchParams)
  // Not awaited: the header and filters render while the grid streams in, and
  // a failed page shows in the grid's place (LibraryErrorBoundary).
  const page: Promise<LibraryPageResult> = listLibrary(
    auth.actor,
    filters
  ).then((result) =>
    result.ok
      ? {
          ok: true,
          page: { items: result.items, nextCursor: result.nextCursor },
        }
      : { ok: false, message: result.message }
  )
  const [options, menu, tags, collections, lists] = await Promise.all([
    libraryFilterOptions(auth.actor),
    libraryLabelFilterOptions(auth.actor, filters.venueId),
    listTags(auth.actor),
    listCollections(auth.actor),
    getFilterLists(auth.actor),
  ])
  // A failed list leaves that filter without choices, never the page broken.
  const named = (o: {
    id: string
    name: string
    venueName?: string | null
  }) => ({
    id: o.id,
    name: o.venueName ? `${o.name} · ${o.venueName}` : o.name,
  })

  return (
    <AppShell variant="admin" active="content" userName={profile.displayName}>
      <AdminLibrary
        venues={options.venues}
        staff={options.staff}
        menuOptions={
          filters.venueId ? { ...menu, venueId: filters.venueId } : null
        }
        filters={toFilterValue(filters)}
        extra={filters}
        extraOptions={{
          tags: tags.ok ? tags.value.map(named) : [],
          collections: collections.ok ? collections.value.map(named) : [],
          requests: lists.ok ? lists.value.requests.map(named) : [],
          destinations: lists.ok ? lists.value.destinations.map(named) : [],
          // S5-IMPORT (FA-54): each legacy import batch with its count.
          imports: lists.ok
            ? lists.value.imports.map((b) => ({
                id: b.id,
                name: `${b.name} · ${b.imported} imported`,
              }))
            : [],
        }}
        initialPage={page}
      />
    </AppShell>
  )
}
