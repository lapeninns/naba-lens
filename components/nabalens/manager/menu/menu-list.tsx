"use client"

import * as React from "react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { failureText } from "@/components/nabalens/coverage/copy"
import { Button } from "@/components/ui/button"

import type {
  ManagerMenuItem,
  MenuPhotoResult,
  OverviewSection,
  Page,
} from "@/lib/server/menu-photos/types"

import { NEEDED_BY_COPY } from "@/components/nabalens/menu-photos/needed-by-chip"

import { MANAGER_COPY } from "../copy"
import { MENU_LIST_CLASS, MenuItemRow } from "./menu-item-row"
import { itemHref, type MenuFilter } from "./menu-query"

/** `loadMenuItemsPageAction`: `{ status, sectionId, query, cursor }`. */
export type LoadMenuItems = (input: {
  status?: string
  sectionId?: string
  query?: string
  cursor: string
}) => Promise<MenuPhotoResult<Page<ManagerMenuItem>>>

type Group = {
  /** A section id, or "needed" for the dishes with a date that lead (G-7). */
  key: string
  sectionId: string | null
  name: string
  items: ManagerMenuItem[]
}

/**
 * Items in list order, grouped by section (pages arrive in order). Dishes
 * with a "needed by" date lead the list, so they form one group of their own
 * first, without a section count.
 */
function groupBySection(items: ManagerMenuItem[]): Group[] {
  const groups: Group[] = []
  for (const item of items) {
    const key = item.neededBy ? "needed" : item.section.id
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
              sectionId: item.section.id,
              name: item.section.name,
              items: [item],
            }
      )
  }
  return groups
}

/**
 * Active-menu items grouped by section, each heading with the section's
 * "{covered} of {eligible} covered". "Show more items" loads the next page in
 * place: focus stays on the button and a live region says how many arrived.
 */
export function MenuList({
  initial,
  sections,
  filter,
  loadItems,
}: {
  initial: Page<ManagerMenuItem>
  /** Section totals from the overview (for the whole section). */
  sections: OverviewSection[]
  filter: MenuFilter
  loadItems: LoadMenuItems
}) {
  const copy = MANAGER_COPY.menu
  const [items, setItems] = React.useState(initial.items)
  const [cursor, setCursor] = React.useState(initial.nextCursor)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [announcement, setAnnouncement] = React.useState("")
  const sessionEnded = useSessionEndedCatch()
  // The last page removes the button: focus moves to the first new item.
  const focusItem = React.useRef<string | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const id = focusItem.current
    if (!id) return
    focusItem.current = null
    listRef.current
      ?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"] a`)
      ?.focus()
  }, [items])
  const totals = React.useMemo(
    () => new Map(sections.map((s) => [s.sectionId, s])),
    [sections]
  )

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await loadItems({
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
        ...(filter.query ? { query: filter.query } : {}),
        cursor,
      })
      if (!result.ok) {
        setError(failureText(result))
        return
      }
      const seen = new Set(items.map((item) => item.itemId))
      const added = result.items.filter((item) => !seen.has(item.itemId))
      setItems([...items, ...added])
      setCursor(result.nextCursor)
      setAnnouncement(copy.loaded(added.length))
      if (!result.nextCursor && added[0]) focusItem.current = added[0].itemId
    } catch (cause) {
      sessionEnded(cause)
      setError(copy.loadFailed)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={listRef} className="grid gap-gutter">
      {groupBySection(items).map((group, index) => {
        const total = group.sectionId ? totals.get(group.sectionId) : null
        const headingId = `menu-section-${group.key}-${index}`
        return (
          // One white card per section: its heading and count, then the
          // items split by hairlines (Common Room row list).
          <section
            key={`${group.key}-${index}`}
            aria-labelledby={headingId}
            className="grid min-w-0 overflow-hidden rounded-card bg-surface shadow-card"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 pt-3.5 pb-1 sm:px-4">
              <h2
                id={headingId}
                className="text-heading [overflow-wrap:anywhere] text-ink"
              >
                {group.name}
              </h2>
              {total ? (
                <p className="font-mono text-meta font-semibold text-ink-muted tabular-nums">
                  {copy.sectionCount(total.covered, total.eligible)}
                </p>
              ) : null}
            </div>
            <ul aria-label={group.name} className={MENU_LIST_CLASS}>
              {group.items.map((item) => (
                <li key={item.itemId} data-item-id={item.itemId}>
                  <MenuItemRow
                    item={item}
                    href={itemHref(item.itemId, filter)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {cursor || error ? (
        <div className="flex flex-col items-center gap-2 py-4">
          {error ? (
            <p role="alert" className="text-body text-warn-fg">
              {error}
            </p>
          ) : null}
          {cursor ? (
            // aria-disabled rather than disabled: a disabled button drops
            // focus, and focus stays here while the next page loads.
            <Button
              variant="secondary"
              loading={loading}
              loadingLabel={copy.loadingMore}
              onClick={() => void loadMore()}
            >
              {copy.showMore}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
