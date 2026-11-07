"use client"

import * as React from "react"

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

export type LoadOurMenuItemsHandler = (
  cursor: string
) => Promise<CoverageResult<Page<OurMenuItem>>>

type Group = {
  sectionId: string
  name: string
  items: OurMenuItem[]
}

/** Items in menu order, grouped by their section (pages arrive in order). */
function groupBySection(items: OurMenuItem[]): Group[] {
  const groups: Group[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last.sectionId === item.sectionId) last.items.push(item)
    else
      groups.push({
        sectionId: item.sectionId,
        name: item.sectionName,
        items: [item],
      })
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
    } catch {
      setLoadError("More dishes could not load. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-6">
      {groupBySection(items).map((group) => {
        const total = totals.get(group.sectionId)
        const headingId = `our-menu-section-${group.sectionId}`
        return (
          <section
            key={group.sectionId}
            aria-labelledby={headingId}
            className="grid gap-2"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2
                id={headingId}
                className="text-section-title-touch break-words text-ink md:text-section-title"
              >
                {group.name}
              </h2>
              {total ? (
                <p className="text-meta-touch text-ink-muted tabular-nums md:text-meta">
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
