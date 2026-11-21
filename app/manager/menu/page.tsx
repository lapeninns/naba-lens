import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr"

import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { ManagerTabs } from "@/components/nabalens/manager/manager-tabs"
import { MenuScreen } from "@/components/nabalens/manager/menu/menu-screen"
import {
  menuHref,
  parseMenuFilter,
} from "@/components/nabalens/manager/menu/menu-query"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { LinkButton } from "@/components/ui/link-button"
import { requireManagerVenue } from "@/lib/auth/manager"
import {
  getManagerPhotoCtx,
  listManagerMenuItems,
} from "@/lib/server/menu-photos"
import { activateDueMenus } from "@/lib/server/menus"

import { loadMenuItemsPageAction } from "../actions"
import { failedRead, loadManagerOverview } from "../load-overview"

export const metadata = { title: "Album" }

type MenuSearch = Record<string, string | string[] | undefined>

/**
 * Album › Menu (redesign R4, ia.md): the active menu's items and their photo
 * state. Specials and menus live under Venue › Details; search opens here. `?status=&section=&q=`
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
      <MenuScreen
        tabs={<ManagerTabs section="album" active="menu" />}
        actions={
          <LinkButton href={managerHrefs.search} size="sm">
            <MagnifyingGlassIcon data-icon="inline-start" aria-hidden />
            Search photos
          </LinkButton>
        }
        overview={overview}
        filter={filter}
        items={items}
        loadItems={loadMenuItemsPageAction}
        now={now}
      />
    </>
  )
}
