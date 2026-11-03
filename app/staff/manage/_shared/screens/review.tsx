import Link from "next/link"

import {
  manageHrefs,
  type SubmissionState,
} from "@/components/nabalens/coverage"
import { buttonVariants } from "@/components/ui/button"
import { listReviewQueue } from "@/lib/server/coverage"

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

  return (
    <ManageFrame
      ctx={ctx}
      section="review"
      title="Review photos"
      summary="Accept a photo when it shows what was asked: relevant, clear, well presented and adding variety. Ask for another photo with a reason otherwise. Oldest submissions come first."
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <nav aria-label="Review filter" className="flex flex-wrap gap-2">
        {REVIEW_TABS.map((t) => (
          <Link
            key={t.state}
            href={t.state === "submitted" ? href : `${href}?state=${t.state}`}
            aria-current={t.state === tab.state ? "page" : undefined}
            className={buttonVariants({
              variant: t.state === tab.state ? "secondary" : "ghost",
              size: "touch",
            })}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <ReviewQueueControl
        initial={queue}
        viewerId={ctx.viewerId}
        venueId={ctx.venueId}
        filter={filter}
        emptyTitle={
          tab.state === "submitted" ? "Nothing to review." : "No photos here."
        }
      />
    </ManageFrame>
  )
}
