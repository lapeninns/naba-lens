import {
  ReviewBody,
  type ReviewSearch,
} from "@/app/manager/review/_shared/review-page"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import {
  AllView,
  FindingsView,
  findingWaitingAt,
  photoWaitingAt,
  ReviewKindFilter,
} from "@/components/nabalens/manager/review/triage-views"
import { TO_CONFIRM_COPY } from "@/components/nabalens/knowledge/copy"
import { Notice } from "@/components/nabalens/notice"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireManagerVenue } from "@/lib/auth/manager"
import { ROUTES } from "@/lib/auth/routes"
import { managerTriageSurface } from "@/lib/config/manager-triage"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getAmenityActor } from "@/lib/server/amenities"
import {
  getManagerPhotoCtx,
  listReviewQueue,
  type ManagerPhotoCtx,
} from "@/lib/server/menu-photos"
import { mergeByWaiting, reviewKindOf } from "@/lib/work-client/triage"

import { failedRead } from "../load-overview"

export const metadata = { title: "Review · Naba-Lens" }

/**
 * Review: photos staff labelled with a menu item at the manager's venue,
 * filtered by status, section, contributor and item (`?status=&section=
 * &contributor=&item=`). Decisions update the list in place.
 */
/** To confirm rows in the server's order (R4); null when unreadable. */
async function toConfirmRows() {
  try {
    const auth = await getAmenityActor()
    if (!auth.ok) return null
    const result = await knowledgeServices.listToConfirm(auth.actor, {})
    return result.ok ? result.view.items : null
  } catch {
    return null
  }
}

/** Findings or All (B02 §6.2). Decisions stay on each row's own screen. */
async function TriageBody({
  ctx,
  kind,
}: {
  ctx: ManagerPhotoCtx
  kind: "findings" | "all"
}) {
  const [rows, queue] = await Promise.all([
    toConfirmRows(),
    kind === "all" ? listReviewQueue(ctx, { status: "pending" }) : null,
  ])
  if (queue && !queue.ok)
    failedRead(queue.code, "Review", `${ROUTES.managerReview}?kind=all`)
  const failed =
    rows === null ? (
      <Notice tone="negative" role="alert">
        {TO_CONFIRM_COPY.failed}
      </Notice>
    ) : null
  if (kind === "findings") return failed ?? <FindingsView rows={rows ?? []} />
  const photos = queue?.ok ? queue.items : []
  const merged = mergeByWaiting(
    photos,
    photoWaitingAt,
    rows ?? [],
    findingWaitingAt,
    Boolean(queue?.ok && queue.nextCursor)
  )
  return (
    <div className="grid gap-3">
      {failed}
      <AllView entries={merged.entries} heldBack={merged.heldBack} />
    </div>
  )
}

export default async function ManagerReviewPage({
  searchParams,
}: {
  searchParams: Promise<ReviewSearch>
}) {
  const { venue } = await requireManagerVenue()
  const scope = await getManagerPhotoCtx()
  if (!scope.ok) failedRead(scope.code, "Review", ROUTES.managerReview)
  const search = await searchParams
  // Switched off, the page is today's photo queue exactly.
  const triage = managerTriageSurface() === "b02"
  const kind = triage ? reviewKindOf(search.kind) : "photos"
  return (
    <div className="grid gap-6">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      <PageHeader
        scope={venue.name}
        venueScope
        title={REVIEW_COPY.title}
        summary={<p>{REVIEW_COPY.summary}</p>}
        className="pb-0 md:pb-0"
      />
      {triage ? <ReviewKindFilter active={kind} /> : null}
      {kind === "photos" ? (
        <ReviewBody ctx={scope.ctx} scope={{ kind: "manager" }} search={search} />
      ) : (
        <TriageBody ctx={scope.ctx} kind={kind} />
      )}
    </div>
  )
}
