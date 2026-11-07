import { PageHeader } from "@/components/nabalens/page-header"
import { StatusChip } from "@/components/nabalens/status-chip"
import type { Contributor } from "@/lib/server/menu-photos/types"

import { CONTRIBUTOR_STATUS_LABEL, REVIEW_COPY } from "./review-copy"

/**
 * The contributor view's header: name, venue, status and tallies. As the
 * page's own header (`level="page"`, the h1), or as a section under a page
 * frame that already has one (the admin pages).
 */
export function ContributorHeader({
  contributor,
  venueName,
  level = "page",
}: {
  contributor: Contributor
  venueName: string
  level?: "page" | "section"
}) {
  const summary = (
    <>
      <p>{REVIEW_COPY.contributionsAt(venueName)}</p>
      <p className="flex flex-wrap items-center gap-2">
        <StatusChip tone={contributor.status === "here" ? "neutral" : "closed"}>
          {CONTRIBUTOR_STATUS_LABEL[contributor.status]}
        </StatusChip>
        <span>
          {REVIEW_COPY.tallies(
            contributor.labelledPhotos,
            contributor.acceptedItems,
            contributor.openFollowUps
          )}
        </span>
      </p>
    </>
  )
  if (level === "section") {
    return (
      <div className="grid gap-2">
        <h2 className="font-display text-section-title break-words text-ink">
          {contributor.name}
        </h2>
        <div className="grid max-w-(--size-reading) gap-2 text-body text-ink-muted">
          {summary}
        </div>
      </div>
    )
  }
  return (
    <PageHeader
      scope={venueName}
      venueScope
      title={contributor.name}
      className="pb-0 md:pb-0"
      summary={summary}
    />
  )
}
