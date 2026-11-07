"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"

import { OptionSelect } from "@/components/nabalens/option-select"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import type {
  ManagerOverview,
  MenuStatusFilter,
} from "@/lib/server/menu-photos/types"

import { MANAGER_COPY } from "../copy"
import {
  MENU_QUERY_MAX,
  MENU_STATUS_ORDER,
  menuHref,
  type MenuFilter,
} from "./menu-query"

const SEARCH_DEBOUNCE_MS = 300

const SEGMENT =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-chip px-3 text-center text-meta-touch font-semibold text-ink-muted outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-0 focus-visible:outline-focus aria-[current=page]:bg-panel aria-[current=page]:text-ink aria-[current=page]:shadow-[0_0_0_1px_var(--color-line-control)] md:min-h-8 md:text-label"

/** The overview count for each status choice ("All" is every eligible item). */
function statusCount(
  overview: ManagerOverview,
  status: MenuStatusFilter | null
): number {
  switch (status) {
    case null:
      return overview.eligible
    case "needs_photo":
      return overview.needsPhotoItems
    case "awaiting_review":
      return overview.awaitingReviewItems
    case "covered":
      return overview.covered
    case "replacement":
      return overview.replacementPendingItems
    case "recheck":
      return overview.needsRecheckItems
  }
}

/**
 * Search, status and section for Menu. Every change replaces the URL without
 * scrolling, so the page re-reads the list with the filters in the address.
 */
export function MenuFilters({
  filter,
  overview,
}: {
  filter: MenuFilter
  overview: ManagerOverview
}) {
  const copy = MANAGER_COPY.menu
  const router = useRouter()
  const [query, setQuery] = React.useState(filter.query)
  // A link elsewhere changed `q` (Clear, Show all items): follow the URL.
  const [seed, setSeed] = React.useState(filter.query)
  if (seed !== filter.query) {
    setSeed(filter.query)
    if (query.trim() !== filter.query) setQuery(filter.query)
  }
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // The filter the page shows now. A pending search reads it when it fires,
  // so a status or section chosen during the debounce is kept, not replaced
  // by the filter from the render the typing happened in.
  const latest = React.useRef(filter)
  React.useLayoutEffect(() => {
    latest.current = filter
  }, [filter])
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const go = (change: Partial<MenuFilter>) =>
    router.replace(menuHref({ ...latest.current, ...change }), {
      scroll: false,
    })

  function cancelSearch() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  function onSearch(value: string) {
    setQuery(value)
    cancelSearch()
    timer.current = setTimeout(() => {
      timer.current = null
      const next = value.trim().slice(0, MENU_QUERY_MAX)
      if (next !== latest.current.query) go({ query: next })
    }, SEARCH_DEBOUNCE_MS)
  }

  const choices: (MenuStatusFilter | null)[] = [null, ...MENU_STATUS_ORDER]

  return (
    <div className="grid gap-3">
      <form
        role="search"
        aria-label={copy.search}
        onSubmit={(event) => {
          event.preventDefault()
          cancelSearch()
          go({ query: query.trim().slice(0, MENU_QUERY_MAX) })
        }}
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] md:items-end"
      >
        <Field>
          <FieldLabel htmlFor="manager-menu-q">{copy.search}</FieldLabel>
          <span className="relative block">
            <MagnifyingGlassIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-ink-muted"
            />
            <Input
              id="manager-menu-q"
              type="search"
              autoComplete="off"
              enterKeyHint="search"
              value={query}
              onChange={(event) => onSearch(event.currentTarget.value)}
              placeholder={copy.searchPlaceholder}
              maxLength={MENU_QUERY_MAX}
              className="h-11 pl-9 md:h-9"
            />
          </span>
        </Field>
        {overview.sections.length > 1 ? (
          <Field>
            <FieldLabel htmlFor="manager-menu-section">
              {copy.sectionLabel}
            </FieldLabel>
            <OptionSelect
              id="manager-menu-section"
              options={overview.sections.map((s) => ({
                id: s.sectionId,
                name: s.name,
              }))}
              value={filter.sectionId}
              emptyLabel={copy.allSections}
              onValueChange={(sectionId) => {
                // Apply typed text that is still waiting with the new section
                // in one navigation.
                const pending = timer.current !== null
                cancelSearch()
                go(
                  pending
                    ? {
                        sectionId,
                        query: query.trim().slice(0, MENU_QUERY_MAX),
                      }
                    : { sectionId }
                )
              }}
            />
          </Field>
        ) : null}
      </form>
      <nav
        aria-label={copy.statusLabel}
        className="[scrollbar-width:none] overflow-x-auto contain-inline-size [&::-webkit-scrollbar]:hidden"
      >
        <ul className="inline-flex gap-0.5 rounded-control bg-well p-0.5">
          {choices.map((status) => {
            const label = status ? copy.status[status] : copy.status.all
            const count = statusCount(overview, status)
            return (
              <li key={status ?? "all"} className="flex-none">
                <Link
                  href={menuHref({ ...filter, status })}
                  replace
                  scroll={false}
                  aria-current={filter.status === status ? "page" : undefined}
                  className={SEGMENT}
                >
                  <span className="whitespace-nowrap">{label}</span>
                  <span className="tabular-nums opacity-75">{count}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
