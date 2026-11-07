import Link from "next/link"

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

// Select pills (DESIGN.md §4 filters): grey, the current one accent-soft
// with an accent-text edge.
const SEGMENT =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-round bg-surface-2 px-3.5 py-1.5 text-center text-label leading-tight font-bold text-ink transition-[background-color,box-shadow] duration-(--duration-quick) outline-none hover:bg-raised focus-visible:outline-3 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus aria-[current=page]:bg-accent-soft aria-[current=page]:shadow-[inset_0_0_0_1.5px_var(--accent-text)]"

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
          : "Oldest first. Accepting decides whether a photo counts. It's already shared in Photos either way."
      }
      pendingReview={pendingReview}
    >
      <OfflineNotice />
      <nav aria-label="Show" className="flex flex-wrap gap-2">
        {REVIEW_TABS.map((t) => (
          <Link
            key={t.state}
            href={t.state === "submitted" ? href : `${href}?state=${t.state}`}
            aria-current={t.state === tab.state ? "page" : undefined}
            className={SEGMENT}
          >
            {t.label}
            {t.state === "submitted" && pendingReview ? (
              <CountBadge count={pendingReview} label="to review" />
            ) : null}
          </Link>
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
