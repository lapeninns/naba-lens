"use client"

import { useRouter } from "next/navigation"
import { XIcon } from "@phosphor-icons/react"

import { OptionSelect } from "@/components/nabalens/option-select"
import type { Option } from "@/components/nabalens/types"
import type { QueueStatus } from "@/lib/server/menu-photos/types"

import { reviewHref, type ReviewScope, type ReviewView } from "./links"
import {
  REVIEW_COPY,
  REVIEW_STATUS_LABEL,
  REVIEW_STATUS_ORDER,
} from "./review-copy"

const SEGMENT =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-chip px-3 text-center text-meta-touch font-semibold text-ink-muted outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-0 focus-visible:outline-focus aria-pressed:bg-panel aria-pressed:text-ink aria-pressed:shadow-[0_0_0_1px_var(--color-line-control)] md:min-h-8 md:text-label md:whitespace-nowrap"

const CHIP =
  "inline-flex min-h-11 items-center gap-1.5 rounded-chip border border-ink bg-ink px-3 text-meta-touch text-paper outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus md:min-h-8 md:text-meta"

/**
 * Review filters: status, section and contributor, plus a removable chip
 * when the view shows one item. Every change replaces the URL without
 * scrolling, and the page reads the new view.
 */
export function ReviewFilters({
  scope,
  view,
  sections,
  contributors,
  showMine,
  fixedContributorId,
  defaultStatus = "pending",
  itemName,
}: {
  scope: ReviewScope
  view: ReviewView
  sections: Option[]
  /** Omit on the contributor page (the contributor is fixed). */
  contributors?: Option[]
  /** "Your photos": only when the caller has earlier photos waiting. */
  showMine: boolean
  fixedContributorId?: string | null
  defaultStatus?: QueueStatus
  itemName?: string | null
}) {
  const router = useRouter()
  const go = (next: Partial<ReviewView>) =>
    router.replace(
      reviewHref(
        scope,
        { ...view, ...next },
        fixedContributorId,
        defaultStatus
      ),
      { scroll: false }
    )
  const statuses = REVIEW_STATUS_ORDER.filter(
    (s) => s !== "mine" || showMine || view.status === "mine"
  )

  return (
    <div
      role="group"
      aria-label={REVIEW_COPY.filtersLabel}
      className="grid gap-3"
    >
      <div
        role="group"
        aria-label={REVIEW_COPY.statusLabel}
        className="[scrollbar-width:none] overflow-x-auto contain-inline-size [&::-webkit-scrollbar]:hidden"
      >
        <div className="inline-flex gap-0.5 rounded-control bg-well p-0.5">
          {statuses.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={view.status === status}
              className={SEGMENT}
              onClick={() => go({ status })}
            >
              {REVIEW_STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 md:items-end">
        {sections.length > 0 ? (
          <div className="grid gap-1.5">
            <span
              id="review-filter-section"
              className="text-label-touch text-ink md:text-label"
            >
              {REVIEW_COPY.sectionLabel}
            </span>
            <OptionSelect
              aria-label={REVIEW_COPY.sectionLabel}
              options={sections}
              value={view.sectionId}
              emptyLabel={REVIEW_COPY.allSections}
              onValueChange={(sectionId) => go({ sectionId })}
            />
          </div>
        ) : null}
        {contributors && contributors.length > 0 ? (
          <div className="grid gap-1.5">
            <span className="text-label-touch text-ink md:text-label">
              {REVIEW_COPY.contributorLabel}
            </span>
            <OptionSelect
              aria-label={REVIEW_COPY.contributorLabel}
              options={contributors}
              value={view.contributorId}
              emptyLabel={REVIEW_COPY.allContributors}
              onValueChange={(contributorId) => go({ contributorId })}
            />
          </div>
        ) : null}
      </div>
      {view.itemId ? (
        <div>
          <button
            type="button"
            className={CHIP}
            aria-label={REVIEW_COPY.removeItemFilter(itemName ?? "one item")}
            onClick={() => go({ itemId: null })}
          >
            {itemName
              ? REVIEW_COPY.showingItem(itemName)
              : REVIEW_COPY.showingThisItem}
            <XIcon aria-hidden className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
