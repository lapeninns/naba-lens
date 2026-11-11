"use client"

import * as React from "react"
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

// Select pills (DESIGN.md §4 filters): grey, the current one accent-soft
// with an accent-text edge.
const SEGMENT =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-round bg-surface-2 px-3.5 py-1.5 text-center text-label leading-tight font-bold whitespace-nowrap text-ink transition-[background-color,box-shadow] duration-(--duration-quick) outline-none hover:bg-raised focus-visible:outline-3 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus aria-pressed:bg-accent-soft aria-pressed:shadow-[inset_0_0_0_1.5px_var(--accent-text)]"

// The one-item filter is on, so it reads as a current pill with a remove mark.
const CHIP =
  "inline-flex min-h-11 items-center gap-2 rounded-round bg-accent-soft px-3.5 py-1.5 text-label leading-tight font-bold [overflow-wrap:anywhere] text-ink shadow-[inset_0_0_0_1.5px_var(--accent-text)] transition-colors duration-(--duration-quick) outline-none hover:bg-raised focus-visible:outline-3 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus"

/**
 * Review filters: status, section and contributor, plus a removable chip
 * when the view shows one item. Every change replaces the URL without
 * scrolling, and the page reads the new view. The choice shows at once,
 * before the server's render arrives; pass the list's `startTransition` so
 * the list can say it is updating.
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
  startTransition,
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
  startTransition?: React.TransitionStartFunction
}) {
  const router = useRouter()
  const [, startOwn] = React.useTransition()
  const start = startTransition ?? startOwn
  const [shown, setShown] = React.useOptimistic(view)
  const go = (next: Partial<ReviewView>) =>
    start(() => {
      setShown({ ...view, ...next })
      router.replace(
        reviewHref(
          scope,
          { ...view, ...next },
          fixedContributorId,
          defaultStatus
        ),
        { scroll: false }
      )
    })
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
        className="py-1"
      >
        {/* Wraps rather than scrolls: at 320px a scrolled row hides the last
            pills with no cue. */}
        <div className="flex flex-wrap gap-2">
          {statuses.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={shown.status === status}
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
            <span id="review-filter-section" className="text-label text-ink">
              {REVIEW_COPY.sectionLabel}
            </span>
            <OptionSelect
              aria-label={REVIEW_COPY.sectionLabel}
              options={sections}
              value={shown.sectionId}
              emptyLabel={REVIEW_COPY.allSections}
              onValueChange={(sectionId) => go({ sectionId })}
            />
          </div>
        ) : null}
        {contributors && contributors.length > 0 ? (
          <div className="grid gap-1.5">
            <span className="text-label text-ink">
              {REVIEW_COPY.contributorLabel}
            </span>
            <OptionSelect
              aria-label={REVIEW_COPY.contributorLabel}
              options={contributors}
              value={shown.contributorId}
              emptyLabel={REVIEW_COPY.allContributors}
              onValueChange={(contributorId) => go({ contributorId })}
            />
          </div>
        ) : null}
      </div>
      {shown.itemId ? (
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
            <XIcon aria-hidden className="size-[18px] shrink-0" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
