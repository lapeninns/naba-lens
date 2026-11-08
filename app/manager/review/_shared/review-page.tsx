import "server-only"

import { notFound } from "next/navigation"

import { ContributorHeader } from "@/components/nabalens/manager/review/contributor-header"
import {
  reviewHref,
  type ReviewScope,
  type ReviewView,
} from "@/components/nabalens/manager/review/links"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { ReviewScreen } from "@/components/nabalens/manager/review/review-screen"
import { Notice } from "@/components/nabalens/notice"
import {
  getContributor,
  getManagerOverview,
  isQueueStatus,
  listContributors,
  listReviewQueue,
  type ManagerPhotoCtx,
  type MenuPhotoFailure,
  type QueueStatus,
} from "@/lib/server/menu-photos"
import { isUuid } from "@/lib/server/coverage/validate"

import { failedRead } from "../../load-overview"

// The server half of the Review screen, shared by the manager workspace
// (/manager/review, the contributor view) and the admin Review pages
// (/admin/coverage/[venueId]/menu-photos/**). Every read goes through the
// manager photo context, so the database checks the venue scope each time.

export type ReviewSearch = Record<string, string | string[] | undefined>

const one = (search: ReviewSearch, key: string) => {
  const value = search[key]
  return typeof value === "string" ? value : undefined
}
const uuidOr = (value: string | undefined) =>
  value && isUuid(value) ? value : null

/** The view in the URL; unknown values fall back to the defaults. */
export function reviewViewOf(
  search: ReviewSearch,
  defaultStatus: QueueStatus = "pending",
  fixedContributorId: string | null = null
): ReviewView {
  const status = one(search, "status")
  return {
    status: isQueueStatus(status) ? status : defaultStatus,
    sectionId: uuidOr(one(search, "section")),
    contributorId: fixedContributorId ?? uuidOr(one(search, "contributor")),
    itemId: uuidOr(one(search, "item")),
  }
}

/**
 * A failed read: an unknown item is not found. In the workspace a refusal
 * means the manager's access ended (see failedRead); for an admin an unknown
 * venue is not found. Anything else is the error boundary's.
 */
function failed(
  failure: MenuPhotoFailure,
  scope: ReviewScope,
  path: string
): never {
  if (failure.code === "not_found") notFound()
  if (scope.kind === "manager") failedRead(failure.code, undefined, path)
  if (failure.code === "wrong_venue") notFound()
  throw new Error(`Could not load menu photos: ${failure.code}`)
}

/** The menu-pending state, shared with Overview. */
function MenuNotReady({ empty }: { empty: boolean }) {
  return (
    <Notice
      tone="plain"
      title={empty ? REVIEW_COPY.emptyMenuTitle : REVIEW_COPY.noMenuTitle}
      className="max-w-(--size-reading)"
    >
      <p>{empty ? REVIEW_COPY.emptyMenuBody : REVIEW_COPY.noMenuBody}</p>
    </Notice>
  )
}

/** Filters and list of the Review screen for `search`. */
export async function ReviewBody({
  ctx,
  scope,
  search,
}: {
  ctx: ManagerPhotoCtx
  scope: ReviewScope
  search: ReviewSearch
}) {
  const view = reviewViewOf(search)
  const path = reviewHref(scope, view)
  const [overview, contributors, queue] = await Promise.all([
    getManagerOverview(ctx),
    listContributors(ctx),
    listReviewQueue(ctx, {
      status: view.status,
      sectionId: view.sectionId ?? undefined,
      contributorId: view.contributorId ?? undefined,
      itemId: view.itemId ?? undefined,
    }),
  ])
  if (!overview.ok) failed(overview, scope, path)
  if (overview.overview.menuState !== "ready")
    return <MenuNotReady empty={overview.overview.menuState === "empty"} />
  if (!contributors.ok) failed(contributors, scope, path)
  if (!queue.ok) failed(queue, scope, path)
  return (
    <ReviewScreen
      scope={scope}
      view={view}
      initial={{ items: queue.items, nextCursor: queue.nextCursor }}
      sections={overview.overview.sections.map((s) => ({
        id: s.sectionId,
        name: s.name,
      }))}
      contributors={contributors.contributors.map((c) => ({
        id: c.id,
        name: c.name,
      }))}
      showMine={overview.overview.ownWaitingPhotos > 0}
      venueName={overview.overview.venueName}
      now={new Date().toISOString()}
      itemName={itemNameOf(queue.items, view.itemId)}
    />
  )
}

function itemNameOf(
  cards: { item: { itemId: string; name: string } | null }[],
  itemId: string | null
): string | null {
  if (!itemId) return null
  return cards.find((c) => c.item?.itemId === itemId)?.item?.name ?? null
}

/**
 * The contributor view: their status and tallies at the venue, then the
 * Review list fixed to their photos (status defaults to All). An unknown id,
 * the caller's own id, or someone with no photos here is not found.
 */
export async function ContributorBody({
  ctx,
  scope,
  staffId,
  search,
  headerLevel = "page",
}: {
  ctx: ManagerPhotoCtx
  scope: ReviewScope
  staffId: string
  search: ReviewSearch
  /** "section" under a page frame that has its own h1 (admin). */
  headerLevel?: "page" | "section"
}) {
  if (!isUuid(staffId) || staffId === ctx.actor.profile.id) notFound()
  const view = reviewViewOf(search, "all", staffId)
  const path = reviewHref(scope, view, staffId, "all")
  const [contributor, overview, queue] = await Promise.all([
    getContributor(ctx, staffId),
    getManagerOverview(ctx),
    listReviewQueue(ctx, {
      status: view.status,
      sectionId: view.sectionId ?? undefined,
      contributorId: staffId,
      itemId: view.itemId ?? undefined,
    }),
  ])
  if (!contributor.ok) failed(contributor, scope, path)
  if (!contributor.contributor) notFound()
  if (!overview.ok) failed(overview, scope, path)
  const venueName = overview.overview.venueName
  const header = (
    <ContributorHeader
      contributor={contributor.contributor}
      venueName={venueName}
      level={headerLevel}
    />
  )
  if (overview.overview.menuState !== "ready") {
    return (
      <div className="grid gap-6">
        {header}
        <MenuNotReady empty={overview.overview.menuState === "empty"} />
      </div>
    )
  }
  if (!queue.ok) failed(queue, scope, path)
  return (
    <div className="grid gap-6">
      {header}
      <ReviewScreen
        scope={scope}
        view={view}
        initial={{ items: queue.items, nextCursor: queue.nextCursor }}
        sections={overview.overview.sections.map((s) => ({
          id: s.sectionId,
          name: s.name,
        }))}
        showMine={false}
        venueName={venueName}
        now={new Date().toISOString()}
        fixedContributorId={staffId}
        defaultStatus="all"
        itemName={itemNameOf(queue.items, view.itemId)}
      />
    </div>
  )
}
