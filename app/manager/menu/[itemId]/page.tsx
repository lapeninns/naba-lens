import { notFound } from "next/navigation"

import { setAlbumBriefAction } from "@/app/manager/album/actions"
import { DishBrief } from "@/components/nabalens/album/dish-brief"
import { ItemDetail } from "@/components/nabalens/manager/menu/item-detail"
import { NeededByControl } from "@/components/nabalens/manager/menu/needed-by-control"
import { ItemWaiting } from "@/components/nabalens/manager/menu/item-waiting"
import { ItemWaitingReview } from "@/components/nabalens/manager/menu/item-waiting-review"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { backHref } from "@/components/nabalens/manager/menu/menu-query"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { requireManagerVenue } from "@/lib/auth/manager"
import { getDishBriefs } from "@/lib/server/album"
import { getOfferingStates } from "@/lib/server/menus/local"
import { isUuid } from "@/lib/server/coverage/validate"
import {
  getManagerItem,
  getManagerPhotoCtx,
  listItemEvents,
  neededByBounds,
} from "@/lib/server/menu-photos"

import {
  clearMenuItemNeededByAction,
  decideMenuPhotoAction,
  loadItemEventsAction,
  setMenuItemNeededByAction,
} from "../../actions"
import { failedRead } from "../../load-overview"
import { OfferingControls } from "../_components/offering-controls"
import {
  presentationChangedAction,
  requestChangeAction,
  setAvailabilityAction,
  setDisplayNameAction,
} from "../local-actions"

export const metadata = { title: "Menu item" }

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
  const [read, history, offering] = await Promise.all([
    getManagerItem(scope.ctx, itemId),
    listItemEvents(scope.ctx, { itemId }),
    getOfferingStates(scope.ctx.actor, scope.ctx.venueId),
  ])
  if (!read.ok) failedRead(read.code, undefined, here)
  const { detail } = read
  if (!detail) notFound()

  // Album AL-4: the dish's brief and its section's (DESIGN.md §5 Brief).
  const briefs = await getDishBriefs(scope.ctx.actor, scope.ctx.venueId, {
    itemId: detail.item.itemId,
    sectionId: detail.item.section.id,
  })
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
        neededBy={
          <>
            <NeededByControl
              item={{
                itemId: detail.item.itemId,
                name: detail.item.name,
                covered: detail.item.status === "covered",
                neededBy: detail.item.neededBy ?? null,
              }}
              {...neededByBounds()}
              setAction={setMenuItemNeededByAction}
              clearAction={clearMenuItemNeededByAction}
            />
            {offering.ok ? (
              <OfferingControls
                itemId={detail.item.itemId}
                menuName={detail.item.name}
                state={
                  offering.states[detail.item.itemId] ?? {
                    available: true,
                    unavailableUntil: null,
                    unavailableReason: null,
                    displayName: null,
                  }
                }
                today={neededByBounds().today}
                actions={{
                  setAvailability: setAvailabilityAction,
                  setDisplayName: setDisplayNameAction,
                  presentationChanged: presentationChangedAction,
                  requestChange: requestChangeAction,
                }}
              />
            ) : null}
            {briefs ? (
              <DishBrief
                itemId={detail.item.itemId}
                name={detail.item.name}
                brief={briefs.own}
                section={{
                  name: detail.item.section.name,
                  brief: briefs.section,
                }}
                setAction={setAlbumBriefAction}
              />
            ) : null}
          </>
        }
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
