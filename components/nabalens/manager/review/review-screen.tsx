"use client"

import type { Option } from "@/components/nabalens/types"
import type {
  Page,
  QueueCard,
  QueueStatus,
} from "@/lib/server/menu-photos/types"

import type { ReviewScope, ReviewView } from "./links"
import { ReviewFilters } from "./review-filters"
import { ReviewList } from "./review-list"

/**
 * The Review screen of the manager workspace, the admin Review page and the
 * contributor view: filters above one list. The list keeps its own state
 * (loaded pages, decided cards) until the filter changes.
 */
export function ReviewScreen({
  scope,
  view,
  initial,
  sections,
  contributors,
  showMine,
  venueName,
  now,
  fixedContributorId,
  defaultStatus = "pending",
  itemName,
}: {
  scope: ReviewScope
  view: ReviewView
  initial: Page<QueueCard>
  sections: Option[]
  contributors?: Option[]
  showMine: boolean
  venueName: string
  now: string
  fixedContributorId?: string | null
  defaultStatus?: QueueStatus
  itemName?: string | null
}) {
  return (
    <div className="grid gap-6">
      <ReviewFilters
        scope={scope}
        view={view}
        sections={sections}
        contributors={fixedContributorId ? undefined : contributors}
        showMine={showMine}
        fixedContributorId={fixedContributorId}
        defaultStatus={defaultStatus}
        itemName={itemName}
      />
      <ReviewList
        initial={initial}
        view={view}
        scope={scope}
        venueName={venueName}
        now={now}
      />
    </div>
  )
}
