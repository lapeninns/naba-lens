import "server-only"

import type * as React from "react"

import {
  decidable,
  fromAreaCard,
  fromMenuCard,
} from "@/components/nabalens/album/review/model"
import { ThumbReview } from "@/components/nabalens/album/review/thumb-review"
import { ROUTES } from "@/lib/auth/routes"
import { getAlbumPlacements } from "@/lib/server/album"
import { listAreaPhotoQueue } from "@/lib/server/area-photos"
import {
  getManagerOverview,
  listManagerMenuItems,
  listReviewQueue,
  type ManagerPhotoCtx,
} from "@/lib/server/menu-photos"

import { failedRead } from "../../load-overview"
import { REVIEW_LIST_HREF } from "./mode"

// The server half of Review in a thumb (DESIGN.md §6.5): the waiting menu
// photos and area photos at the manager's venue, each with its slot name,
// brief and album place. Every read goes through the manager photo context,
// so the database checks the venue scope each time. The place and brief
// reads are extras: when they fail the stage shows the photo without them.

/** Pages of the menu read for briefs; a venue's menu fits well inside. */
const BRIEF_PAGES = 10

/** Menu section id to album place label, from the album placements. */
async function sectionPlaces(
  ctx: ManagerPhotoCtx
): Promise<Record<string, string>> {
  const read = await getAlbumPlacements(ctx.actor, ctx.venueId).catch(
    () => null
  )
  if (!read?.ok) return {}
  const label = new Map(read.places.map((p) => [p.subjectId, p.label]))
  const bySlug = new Map(
    read.placements
      .filter((p) => p.source === "menu_section")
      .map((p) => [p.key, label.get(p.subjectId)])
  )
  const out: Record<string, string> = {}
  for (const section of read.sections) {
    const place = bySlug.get(section.slug)
    if (place) out[section.sectionId] = place
  }
  return out
}

/**
 * Each waiting dish's brief. Until AL-4 gives slots a brief of their own
 * (`AlbumSlot.brief`), it is the dish's menu description; swap this read
 * for the slot brief when that lands.
 */
async function itemBriefs(
  ctx: ManagerPhotoCtx,
  itemIds: ReadonlySet<string>
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (itemIds.size === 0) return out
  let cursor: string | null = null
  try {
    for (let page = 0; page < BRIEF_PAGES; page += 1) {
      const read = await listManagerMenuItems(ctx, { cursor })
      if (!read.ok) break
      for (const item of read.items) {
        const brief = item.description?.trim()
        if (brief && itemIds.has(item.itemId)) out[item.itemId] = brief
      }
      cursor = read.nextCursor
      if (!cursor || Object.keys(out).length === itemIds.size) break
    }
  } catch {
    // Briefs are an extra: the stage shows the photo without one.
  }
  return out
}

export async function AlbumReviewBody({
  ctx,
  venueName,
  filter,
}: {
  ctx: ManagerPhotoCtx
  venueName: string
  /** Shown under the title: the Findings / All switch when triage is on. */
  filter?: React.ReactNode
}) {
  const [overview, queue, areas, sectionPlace] = await Promise.all([
    getManagerOverview(ctx),
    listReviewQueue(ctx, { status: "pending" }),
    listAreaPhotoQueue(ctx, "pending"),
    sectionPlaces(ctx),
  ])
  if (!overview.ok) failedRead(overview.code, "Review", ROUTES.managerReview)
  // Without a ready menu there are no dish photos to decide (as on the list).
  const menuReady = overview.overview.menuState === "ready"
  if (menuReady && !queue.ok)
    failedRead(queue.code, "Review", ROUTES.managerReview)
  const menuCards = menuReady && queue.ok ? queue.items : []
  const menuCursor = menuReady && queue.ok ? queue.nextCursor : null
  // A failed area read leaves the menu photos working (as on the list).
  const areaCards = areas.ok ? areas.cards : []

  const itemIds = new Set(
    menuCards.flatMap((c) => (c.item ? [c.item.itemId] : []))
  )
  const itemBrief = await itemBriefs(ctx, itemIds)

  // The title counts what the caller can decide on. With more menu pages
  // to come, the overview's count stands in for the unread ones.
  const menuShown = menuCards.filter((c) => {
    const photo = fromMenuCard(c)
    return photo !== null && decidable(photo)
  }).length
  const menuTotal = menuCursor
    ? Math.max(menuShown, overview.overview.pendingPhotos)
    : menuShown
  const areaTotal = areaCards.filter((c) => decidable(fromAreaCard(c))).length

  return (
    <ThumbReview
      venueName={overview.overview.venueName || venueName}
      menuCards={menuCards}
      menuCursor={menuCursor}
      filter={filter}
      areaCards={areaCards}
      total={menuTotal + areaTotal}
      context={{ sectionPlace, itemBrief }}
      listHref={REVIEW_LIST_HREF}
    />
  )
}
