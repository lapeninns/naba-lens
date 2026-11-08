import { MenuScreen } from "@/components/nabalens/manager/menu/menu-screen"
import {
  menuHref,
  parseMenuFilter,
} from "@/components/nabalens/manager/menu/menu-query"
import { requireManagerVenue } from "@/lib/auth/manager"
import { listManagerMenuItems } from "@/lib/server/menu-photos"

import { loadMenuItemsPageAction } from "../actions"
import { failedRead, loadManagerOverview } from "../load-overview"

export const metadata = { title: "Menu · Naba-Lens" }

type MenuSearch = Record<string, string | string[] | undefined>

/**
 * Menu: the active menu's items and their photo state. `?status=&section=&q=`
 * filter the list; unknown values fall back to the defaults. A failed read
 * goes to error.tsx (Try again).
 */
export default async function ManagerMenuPage({
  searchParams,
}: {
  searchParams: Promise<MenuSearch>
}) {
  await requireManagerVenue()
  const parsed = parseMenuFilter(await searchParams)
  // Signing in again returns to this list, filters included.
  const here = menuHref(parsed)
  const read = await loadManagerOverview()
  if (!read.ok) failedRead(read.code, undefined, here)
  const { ctx, overview } = read
  // A section from another menu version (an old link) shows every section.
  const filter = overview.sections.some((s) => s.sectionId === parsed.sectionId)
    ? parsed
    : { ...parsed, sectionId: null }

  let items = null
  if (overview.menuState === "ready") {
    const page = await listManagerMenuItems(ctx, {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
      ...(filter.query ? { query: filter.query } : {}),
    })
    if (!page.ok) failedRead(page.code, undefined, here)
    items = { items: page.items, nextCursor: page.nextCursor }
  }

  return (
    <MenuScreen
      overview={overview}
      filter={filter}
      items={items}
      loadItems={loadMenuItemsPageAction}
      now={new Date().toISOString()}
    />
  )
}
