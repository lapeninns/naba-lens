import { notFound } from "next/navigation"

import { ItemDetail } from "@/components/nabalens/manager/menu/item-detail"
import { ItemWaiting } from "@/components/nabalens/manager/menu/item-waiting"
import { ItemWaitingReview } from "@/components/nabalens/manager/menu/item-waiting-review"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { backHref } from "@/components/nabalens/manager/menu/menu-query"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { requireManagerVenue } from "@/lib/auth/manager"
import { isUuid } from "@/lib/server/coverage/validate"
import {
  getManagerItem,
  getManagerPhotoCtx,
  listItemEvents,
} from "@/lib/server/menu-photos"

import { decideMenuPhotoAction, loadItemEventsAction } from "../../actions"
import { failedRead } from "../../load-overview"

export const metadata = { title: "Menu item · Naba-Lens" }

/**
 * One active-menu item: its menu photo, alternatives, requests, rechecks,
 * waiting photos and history. Any id that is not an item of the venue's
 * active menu is not found; `?from=` keeps the Menu list's filters.
 */
export default async function ManagerMenuItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { venue } = await requireManagerVenue()
  const { itemId } = await params
  if (!isUuid(itemId)) notFound()
  const search = await searchParams
  const back = backHref(search.from)
  // Signing in again returns here, with the Menu list's filters for Back.
  const query = back.indexOf("?")
  const here =
    query < 0
      ? managerHrefs.item(itemId)
      : `${managerHrefs.item(itemId)}?${new URLSearchParams({ from: back.slice(query + 1) })}`
  const scope = await getManagerPhotoCtx()
  if (!scope.ok) failedRead(scope.code, undefined, here)
  const [read, history] = await Promise.all([
    getManagerItem(scope.ctx, itemId),
    listItemEvents(scope.ctx, { itemId }),
  ])
  if (!read.ok) failedRead(read.code, undefined, here)
  const { detail } = read
  if (!detail) notFound()

  const now = new Date().toISOString()
  return (
    <>
      <OfflineNotice className={OFFLINE_BANNER_CLASS} loadedAt={now} />
      <ItemDetail
        detail={detail}
        backHref={back}
        decide={decideMenuPhotoAction}
        history={
          history.ok
            ? { items: history.items, nextCursor: history.nextCursor }
            : null
        }
        loadEvents={loadItemEventsAction}
        waiting={
          detail.waiting.items.length > 0 ? (
            <ItemWaitingReview
              itemId={detail.item.itemId}
              initial={detail.waiting}
              venueName={venue.name}
              now={now}
            />
          ) : (
            <ItemWaiting item={detail.item} waiting={detail.waiting} />
          )
        }
      />
    </>
  )
}
