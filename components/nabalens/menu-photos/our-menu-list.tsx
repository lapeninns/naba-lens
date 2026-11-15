"use client"

import * as React from "react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { failureText } from "@/components/nabalens/coverage/copy"
import { LoadMoreButton } from "@/components/nabalens/load-more-button"

import type {
  CoverageResult,
  OurMenuItem,
  OurMenuSection,
  Page,
} from "@/lib/server/coverage/types"

import { sectionCount } from "./copy"
import { OUR_MENU_LIST_CLASS, OurMenuItemRow } from "./item-row"
import { NEEDED_BY_COPY } from "./needed-by-chip"

export type LoadOurMenuItemsHandler = (
  cursor: string
) => Promise<CoverageResult<Page<OurMenuItem>>>

type Group = {
  /** A section id, or "needed" for the dishes with a date that lead (G-7). */
  key: string
  sectionId: string | null
  name: string
  items: OurMenuItem[]
}

/**
 * Items in list order, grouped by their section (pages arrive in order).
 * Dishes with a "needed by" date lead the list, so they form one group of
 * their own first, without a section count.
 */
function groupBySection(items: OurMenuItem[]): Group[] {
  const groups: Group[] = []
  for (const item of items) {
    const key = item.neededBy ? "needed" : item.sectionId
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else
      groups.push(
        item.neededBy
          ? {
              key,
              sectionId: null,
              name: NEEDED_BY_COPY.groupTitle,
              items: [item],
            }
          : {
              key,
              sectionId: item.sectionId,
              name: item.sectionName,
              items: [item],
            }
      )
  }
  return groups
}

/**
 * The venue's dishes and drinks grouped by menu section, each section with
 * how many of its items have an accepted photo. Later pages load with the
 * opaque cursor; the page itself owns the filters (URL search parameters).
 */
export function OurMenuList({
  initial,
  sections,
  canAdd,
  onLoadMore,
  reviewHref,
}: {
  initial: Page<OurMenuItem>
  /** Section totals from the summary (the counts are for the whole section). */
  sections: OurMenuSection[]
  canAdd: boolean
  onLoadMore?: LoadOurMenuItemsHandler
  /** Reviewers: the link to one dish's photos. */
  reviewHref?: (itemId: string) => string
}) {
  const [seed, setSeed] = React.useState(initial)
  const [items, setItems] = React.useState(initial.items)
  const [cursor, setCursor] = React.useState(initial.nextCursor)
  if (seed !== initial) {
    setSeed(initial)
    setItems(initial.items)
    setCursor(initial.nextCursor)
  }
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const sessionEnded = useSessionEndedCatch()
  const totals = React.useMemo(
    () => new Map(sections.map((s) => [s.sectionId, s])),
    [sections]
  )

  async function loadMore() {
    if (!onLoadMore || !cursor) return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await onLoadMore(cursor)
      if (!result.ok) {
        setLoadError(failureText(result))
        return
      }
      setItems((current) => {
        const seen = new Set(current.map((item) => item.itemId))
        return [
          ...current,
          ...result.items.filter((item) => !seen.has(item.itemId)),
        ]
      })
      setCursor(result.nextCursor)
    } catch (cause) {
      sessionEnded(cause)
      setLoadError("More dishes could not load. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-gutter">
      {groupBySection(items).map((group, index) => {
        const total = group.sectionId ? totals.get(group.sectionId) : null
        const headingId = `our-menu-section-${group.key}-${index}`
        return (
          // One white card per section: its heading and count, then the
          // dishes split by hairlines (Common Room row list).
          <section
            key={`${group.key}-${index}`}
            aria-labelledby={headingId}
            className="grid min-w-0 overflow-hidden rounded-card bg-surface shadow-card"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 pt-3.5 pb-1 sm:px-4">
              <h2
                id={headingId}
                className="type-section-title [overflow-wrap:anywhere] text-ink"
              >
                {group.name}
              </h2>
              {total ? (
                <p className="font-mono text-meta font-semibold text-ink-muted tabular-nums">
                  {sectionCount(total.covered, total.eligible)}
                </p>
              ) : null}
            </div>
            <ul aria-label={group.name} className={OUR_MENU_LIST_CLASS}>
              {group.items.map((item) => (
                <li key={item.itemId}>
                  <OurMenuItemRow
                    item={item}
                    canAdd={canAdd}
                    reviewHref={reviewHref?.(item.itemId)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {onLoadMore ? (
        <LoadMoreButton
          hasMore={!!cursor}
          loading={loading}
          error={loadError}
          onLoadMore={() => void loadMore()}
        />
      ) : null}
    </div>
  )
}
