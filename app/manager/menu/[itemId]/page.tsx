import { notFound } from "next/navigation"

import { ItemDetail } from "@/components/nabalens/manager/menu/item-detail"
import { ItemWaiting } from "@/components/nabalens/manager/menu/item-waiting"
import { backHref } from "@/components/nabalens/manager/menu/menu-query"
import { ReviewList } from "@/components/nabalens/manager/review"
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
  const scope = await getManagerPhotoCtx()
  if (!scope.ok) failedRead(scope.code)
  const [read, history, search] = await Promise.all([
    getManagerItem(scope.ctx, itemId),
    listItemEvents(scope.ctx, { itemId }),
    searchParams,
  ])
  if (!read.ok) failedRead(read.code)
  const { detail } = read
  if (!detail) notFound()

  return (
    <ItemDetail
      detail={detail}
      backHref={backHref(search.from)}
      decide={decideMenuPhotoAction}
      history={
        history.ok
          ? { items: history.items, nextCursor: history.nextCursor }
          : null
      }
      loadEvents={loadItemEventsAction}
      waiting={
        detail.waiting.items.length > 0 ? (
          <ReviewList
            initial={detail.waiting}
            view={{
              status: "pending",
              sectionId: null,
              contributorId: null,
              itemId: detail.item.itemId,
            }}
            scope={{ kind: "manager" }}
            venueName={venue.name}
            now={new Date().toISOString()}
            showItemLinks={false}
          />
        ) : (
          <ItemWaiting item={detail.item} waiting={detail.waiting} />
        )
      }
    />
  )
}
