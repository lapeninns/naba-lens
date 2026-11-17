import "server-only"

import type * as React from "react"

import {
  decidable,
  fromAreaCard,
  fromMenuCard,
} from "@/components/nabalens/album/review/model"
import { ThumbReview } from "@/components/nabalens/album/review/thumb-review"
import { ROUTES } from "@/lib/auth/routes"
import { getAlbumBriefs, getAlbumPlacements } from "@/lib/server/album"
import { listAreaPhotoQueue } from "@/lib/server/area-photos"
import {
  getManagerOverview,
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

type ReviewContextRead = {
  sectionPlace: Record<string, string>
  sectionBrief: Record<string, string>
  itemBrief: Record<string, string>
}

/**
 * Where each menu section sits in the album, and the briefs the manager wrote
 * (AL-4, DESIGN.md §2 principle 4): each dish's own, and each section's by
 * section id. The stage resolves a dish to its own brief, else its section's,
 * else none; it never falls back to the guest-facing menu description. Both
 * reads are extras: a failure leaves that part empty.
 */
async function reviewContext(
  ctx: ManagerPhotoCtx
): Promise<ReviewContextRead> {
  const [placed, briefs] = await Promise.all([
    getAlbumPlacements(ctx.actor, ctx.venueId).catch(() => null),
    getAlbumBriefs(ctx.actor, ctx.venueId).catch(() => null),
  ])
  const out: ReviewContextRead = {
    sectionPlace: {},
    sectionBrief: {},
    itemBrief: {},
  }
  if (briefs?.ok) out.itemBrief = Object.fromEntries(briefs.briefs.items)
  if (!placed?.ok) return out
  const label = new Map(placed.places.map((p) => [p.subjectId, p.label]))
  const bySlug = new Map(
    placed.placements
      .filter((p) => p.source === "menu_section")
      .map((p) => [p.key, label.get(p.subjectId)])
  )
  for (const section of placed.sections) {
    const place = bySlug.get(section.slug)
    if (place) out.sectionPlace[section.sectionId] = place
    const brief = briefs?.ok ? briefs.briefs.sections.get(section.slug) : null
    if (brief) out.sectionBrief[section.sectionId] = brief
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
  const [overview, queue, areas, context] = await Promise.all([
    getManagerOverview(ctx),
    listReviewQueue(ctx, { status: "pending" }),
    listAreaPhotoQueue(ctx, "pending"),
    reviewContext(ctx),
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
      context={context}
      listHref={REVIEW_LIST_HREF}
    />
  )
}
