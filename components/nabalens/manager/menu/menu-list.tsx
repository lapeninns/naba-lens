"use client"

import * as React from "react"
import { SpinnerGapIcon } from "@phosphor-icons/react"

import { failureText } from "@/components/nabalens/coverage/copy"
import { Button } from "@/components/ui/button"

import type {
  ManagerMenuItem,
  MenuPhotoResult,
  OverviewSection,
  Page,
} from "@/lib/server/menu-photos/types"

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

type Group = { sectionId: string; name: string; items: ManagerMenuItem[] }

/** Items in menu order, grouped by section (pages arrive in order). */
function groupBySection(items: ManagerMenuItem[]): Group[] {
  const groups: Group[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last.sectionId === item.section.id) last.items.push(item)
    else
      groups.push({
        sectionId: item.section.id,
        name: item.section.name,
        items: [item],
      })
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
    } catch {
      setError(copy.loadFailed)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={listRef} className="grid gap-(--gutter)">
      {groupBySection(items).map((group, index) => {
        const total = totals.get(group.sectionId)
        const headingId = `menu-section-${group.sectionId}-${index}`
        return (
          // One white card per section: its heading and count, then the
          // items split by hairlines (Common Room row list).
          <section
            key={`${group.sectionId}-${index}`}
            aria-labelledby={headingId}
            className="grid min-w-0 overflow-hidden rounded-card bg-surface shadow-card"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 pt-3.5 pb-1 sm:px-4">
              <h2
                id={headingId}
                className="font-display text-section-title [overflow-wrap:anywhere] text-ink"
              >
                {group.name}
              </h2>
              {total ? (
                <p className="font-mono text-meta-strong text-ink-muted tabular-nums">
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
              size="touch"
              aria-disabled={loading || undefined}
              aria-busy={loading || undefined}
              onClick={() => void loadMore()}
            >
              {loading ? (
                <SpinnerGapIcon
                  data-icon="inline-start"
                  className="motion-safe:animate-spin"
                  aria-hidden
                />
              ) : null}
              {loading ? copy.loadingMore : copy.showMore}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
