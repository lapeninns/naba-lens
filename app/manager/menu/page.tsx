import Link from "next/link"

import { MenuScreen } from "@/components/nabalens/manager/menu/menu-screen"
import {
  menuHref,
  parseMenuFilter,
} from "@/components/nabalens/manager/menu/menu-query"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { requireManagerVenue } from "@/lib/auth/manager"
import {
  getManagerPhotoCtx,
  listManagerMenuItems,
} from "@/lib/server/menu-photos"
import { activateDueMenus } from "@/lib/server/menus"

import { loadMenuItemsPageAction } from "../actions"
import { failedRead, loadManagerOverview } from "../load-overview"

export const metadata = { title: "Album" }

const MORE_LINK =
  "rounded-square font-semibold text-ink underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"

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
  // A menu scheduled for now becomes current before the list is read
  // (spec §4.3); the cron route does the same every 15 minutes.
  const scope = await getManagerPhotoCtx()
  if (scope.ok) await activateDueMenus(scope.ctx.actor, scope.ctx.venueId)
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

  const now = new Date().toISOString()
  return (
    <>
      <OfflineNotice className={OFFLINE_BANNER_CLASS} loadedAt={now} />
      <nav
        aria-label="More about the menu"
        className="flex flex-wrap gap-x-4 gap-y-1 px-1 pb-3 text-body"
      >
        <Link href="/manager/menu/specials" className={MORE_LINK}>
          Specials
        </Link>
        <Link href="/manager/menu/versions" className={MORE_LINK}>
          Current and future menus
        </Link>
      </nav>
      <MenuScreen
        overview={overview}
        filter={filter}
        items={items}
        loadItems={loadMenuItemsPageAction}
        now={now}
      />
    </>
  )
}
