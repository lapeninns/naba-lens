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

const SEGMENT =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 text-center text-meta-touch font-semibold text-ink-muted outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus aria-[current=page]:bg-panel aria-[current=page]:text-ink aria-[current=page]:shadow-[0_0_0_1px_var(--color-line-control)] md:min-h-[30px] md:text-label md:whitespace-nowrap"

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
      <nav
        aria-label="Show"
        className="grid w-full grid-cols-2 gap-0.5 rounded-control bg-well p-0.5 md:inline-flex md:w-auto md:max-w-full md:justify-self-start md:overflow-x-auto"
      >
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
