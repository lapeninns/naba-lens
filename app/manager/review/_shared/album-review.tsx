import "server-only"

import type * as React from "react"

import {
  decidable,
  fromAreaCard,
  fromMenuCard,
} from "@/components/nabalens/album/review/model"
import { ThumbReview } from "@/components/nabalens/album/review/thumb-review"
import { NeedsLabelList } from "@/components/nabalens/manager/review/inbox-needs-label"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { ROUTES } from "@/lib/auth/routes"
import { getAlbumBriefs, getAlbumPlacements } from "@/lib/server/album"
import { AREA_QUEUE_LIMIT, listAreaPhotoQueue } from "@/lib/server/area-photos"
import {
  getManagerOverview,
  listReviewQueue,
  type ManagerPhotoCtx,
} from "@/lib/server/menu-photos"
import { loadSlotBriefs } from "@/lib/server/shot-templates"

import { failedRead } from "../../load-overview"
import { REVIEW_LIST_HREF } from "./mode"
import { listAllNeedsLabel } from "./needs-label"

// The server half of Review in a thumb (DESIGN.md §6.5): the waiting menu
// photos and area photos at the manager's venue, each with its slot name,
// brief and album place. Every read goes through the manager photo context,
// so the database checks the venue scope each time. The place and brief
// reads are extras: when they fail the stage shows the photo without them.

type ReviewContextRead = {
  sectionPlace: Record<string, string>
  slotBrief: Record<string, string>
  sectionBrief: Record<string, string>
  itemBrief: Record<string, string>
}

/**
 * Where each menu section sits in the album, and each slot's brief. The
 * brief is the one brief resolver's (FA-52, public.slot_briefs with open
 * requests): the words staff were given on Asked for, the tile and the slot
 * page, so the reviewer judges against the same words (DESIGN.md §2
 * principle 4; S5-R2, Y4). Only when that read fails does the stage fall
 * back to the manager's album briefs (AL-4): each dish's own, else its
 * section's. Never the guest-facing menu description. Every read is an
 * extra: a failure leaves that part empty.
 */
async function reviewContext(ctx: ManagerPhotoCtx): Promise<ReviewContextRead> {
  const [placed, resolved] = await Promise.all([
    getAlbumPlacements(ctx.actor, ctx.venueId).catch(() => null),
    loadSlotBriefs(ctx.actor, {
      venueId: ctx.venueId,
      includeRequests: true,
    }).catch(() => null),
  ])
  const briefs = resolved?.ok
    ? null
    : await getAlbumBriefs(ctx.actor, ctx.venueId).catch(() => null)
  const out: ReviewContextRead = {
    sectionPlace: {},
    slotBrief: {},
    sectionBrief: {},
    itemBrief: {},
  }
  if (resolved?.ok)
    for (const [key, brief] of resolved.briefs) out.slotBrief[key] = brief.text
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
  const [overview, queue, areas, context, unlabelled] = await Promise.all([
    getManagerOverview(ctx),
    listReviewQueue(ctx, { status: "pending" }),
    listAreaPhotoQueue(ctx, "pending"),
    reviewContext(ctx),
    listAllNeedsLabel(ctx, {}),
  ])
  if (!overview.ok) failedRead(overview.code, "Review", ROUTES.managerReview)
  // Without a ready menu there are no dish photos to decide (as on the list),
  // and a failed queue read leaves the area photos working.
  const menuReady = overview.overview.menuState === "ready"
  if (menuReady && !queue.ok)
    failedRead(queue.code, "Review", ROUTES.managerReview)
  const queueCards = queue.ok ? queue.items : []
  const menuCards = menuReady ? queueCards : []
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
  // Needs label photos (FA-4, K1) are decided on their detail, not the
  // stage. Listed whatever the menu state (S3-R8 W2): Overview counts them
  // either way, and Not used needs no menu. Every page of them (S3-R13 X2),
  // not those that fit on the first page of the pending queue; a failed read
  // falls back to those.
  const needsLabel = unlabelled.ok
    ? unlabelled.items
    : queueCards.filter((c) => c.kind === "unlabelled")
  const needsLabelMore = unlabelled.ok && unlabelled.more

  return (
    <ThumbReview
      venueName={overview.overview.venueName || venueName}
      menuCards={menuCards}
      menuCursor={menuCursor}
      filter={
        needsLabel.length > 0 ? (
          <>
            {filter}
            <NeedsLabelList
              cards={needsLabel}
              more={needsLabelMore}
              note={menuReady ? undefined : REVIEW_COPY.needsLabelMenuNotReady}
            />
          </>
        ) : (
          filter
        )
      }
      areaCards={areaCards}
      areaMore={areaCards.length >= AREA_QUEUE_LIMIT}
      total={menuTotal + areaTotal + needsLabel.length}
      waitingElsewhere={needsLabel.length}
      context={context}
      listHref={REVIEW_LIST_HREF}
    />
  )
}
