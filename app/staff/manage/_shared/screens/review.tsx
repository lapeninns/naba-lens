import { FilterPill } from "@/components/ui/filter-pill"

import {
  manageHrefs,
  type SubmissionState,
} from "@/components/nabalens/coverage"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { CountBadge } from "@/components/nabalens/status-chip"
import { listReviewQueue } from "@/lib/server/coverage"
import { periodKeyOf } from "@/lib/server/coverage/time"

import { type ManageContext } from "../context"
import { ReviewQueueControl } from "../controls"
import { ManageFrame } from "../frame"

import { failed, param, type ManageSearch } from "./common"

const REVIEW_TABS: { state: SubmissionState | "all"; label: string }[] = [
  { state: "submitted", label: "To review" },
  { state: "needs_another_photo", label: "Needs another photo" },
  { state: "accepted", label: "Accepted" },
  { state: "all", label: "All" },
]

export async function ReviewScreen({
  ctx,
  search,
}: {
  ctx: ManageContext
  search: ManageSearch
}) {
  const requested = param(search, "state")
  const tab = REVIEW_TABS.find((t) => t.state === requested) ?? REVIEW_TABS[0]
  const filter = {
    state: tab.state,
    newestFirst: tab.state !== "submitted",
  }
  const queue = await listReviewQueue(ctx.actor, {
    venueId: ctx.venueId,
    ...filter,
  })
  if (!queue.ok) return failed(ctx, queue)
  const href = manageHrefs(ctx.basePath).review
  const pendingReview = ctx.coverage?.summary.pendingReview
  const nothingToReview = tab.state === "submitted" && queue.items.length === 0

  return (
    <ManageFrame
      ctx={ctx}
      section="review"
      title="Review photos"
      summary={
        nothingToReview
          ? undefined
          : "Oldest first. Accepting decides whether a photo counts, and shares it with colleagues in Photos."
      }
      pendingReview={pendingReview}
    >
      <OfflineNotice />
      <nav aria-label="Show" className="flex flex-wrap gap-2">
        {REVIEW_TABS.map((t) => (
          <FilterPill
            key={t.state}
            href={t.state === "submitted" ? href : `${href}?state=${t.state}`}
            selected={t.state === tab.state}
          >
            {t.label}
            {t.state === "submitted" && pendingReview ? (
              <CountBadge count={pendingReview} label="to review" />
            ) : null}
          </FilterPill>
        ))}
      </nav>
      <ReviewQueueControl
        initial={queue}
        viewerId={ctx.viewerId}
        venueId={ctx.venueId}
        currentPeriod={periodKeyOf(new Date())}
        filter={filter}
        emptyTitle={tab.state === "submitted" ? undefined : "No photos here."}
      />
    </ManageFrame>
  )
}
