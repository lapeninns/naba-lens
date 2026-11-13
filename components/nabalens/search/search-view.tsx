"use client"

import * as React from "react"
import { XIcon } from "@phosphor-icons/react"
import { usePathname, useRouter } from "next/navigation"

import {
  EMPTY_SEARCH_FILTERS,
  filtersToSearch,
  type SearchFilterValue,
  type SearchMode,
} from "@/app/_media/search-params"
import { Button } from "@/components/ui/button"
import type {
  MenuDecisionState,
  SearchFilterKey,
  SearchRights,
} from "@/lib/server/media/search/types"

import { EmptyState } from "../empty-state"
import {
  DECISION_LABEL,
  RIGHTS_LABEL,
  SEARCH_COPY,
  filterDay,
} from "./search-copy"
import { CONTROL_ORDER, SearchFilters, fieldId } from "./search-filters"
import {
  ERROR_SUMMARY_ID,
  SearchErrorBoundary,
  SearchResults,
} from "./search-results"
import { SearchGridSkeleton } from "./search-skeleton"
import type { SearchMenuOptions, SearchOption, SearchPageResult } from "./types"

const SLOW_MS = 15_000

type Pill = { key: SearchFilterKey; text: string }

/** The applied filters in words, one removable pill each. */
export function filterPills(
  value: SearchFilterValue,
  {
    mode,
    venues,
    menuOptions,
    destinations,
    now,
  }: {
    mode: SearchMode
    venues: SearchOption[]
    menuOptions: SearchMenuOptions | null
    destinations: SearchOption[]
    now: Date
  }
): Pill[] {
  const v = { ...EMPTY_SEARCH_FILTERS, ...value }
  const item = menuOptions?.items.find((i) => i.id === v.item) ?? null
  const pills: Pill[] = []
  const add = (key: SearchFilterKey, text: string) => pills.push({ key, text })
  if (v.venue && mode === "admin")
    add(
      "venue",
      venues.find((x) => x.id === v.venue)?.name ?? SEARCH_COPY.pillVenue
    )
  if (v.mediaType)
    add(
      "mediaType",
      v.mediaType === "video"
        ? SEARCH_COPY.mediaVideos
        : v.mediaType === "image"
          ? SEARCH_COPY.mediaPhotos
          : v.mediaType
    )
  if (v.item) add("item", item?.name ?? SEARCH_COPY.pillItem)
  if (v.variant)
    add(
      "variant",
      item?.variants.find((x) => x.id === v.variant)?.name ??
        SEARCH_COPY.pillVariant
    )
  if (v.rights)
    add("rights", RIGHTS_LABEL[v.rights as SearchRights] ?? v.rights)
  if (v.destination && v.rights === "in_force")
    add(
      "destination",
      destinations.find((x) => x.id === v.destination)?.name ??
        SEARCH_COPY.pillDestination
    )
  if (v.menuState)
    add(
      "menuState",
      DECISION_LABEL[v.menuState as MenuDecisionState] ?? v.menuState
    )
  if (v.uploadedFrom)
    add("uploadedFrom", SEARCH_COPY.pillFrom(filterDay(v.uploadedFrom, now)))
  if (v.uploadedTo)
    add("uploadedTo", SEARCH_COPY.pillTo(filterDay(v.uploadedTo, now)))
  if (v.check) add("check", SEARCH_COPY.pillCheck)
  if (v.group) add("group", SEARCH_COPY.pillGroup)
  if (v.submission) add("submission", SEARCH_COPY.pillSubmission)
  return pills
}

/** A control focus can land on: there, enabled and not hidden. */
function focusable(el: HTMLElement | null): el is HTMLElement {
  if (!el || el.closest("[hidden], [inert]")) return false
  if ((el as HTMLInputElement).disabled) return false
  return el.getAttribute("aria-disabled") !== "true"
}

/** The widest single step back from an empty result. */
export function widenHint(value: SearchFilterValue, mode: SearchMode): string {
  if (mode === "admin" && value.venue) return SEARCH_COPY.widenVenue
  if (value.uploadedFrom || value.uploadedTo) return SEARCH_COPY.widenDates
  return SEARCH_COPY.widen
}

/**
 * The search screen's client part: URL-driven filters, the applied filters as
 * removable pills, one status region and the result list. A filter change
 * replaces the URL in a transition; the server renders page one again.
 */
export function SearchView({
  mode,
  venueName,
  venues,
  menuOptions,
  destinations,
  filters,
  initialPage,
  now,
}: {
  mode: SearchMode
  /** The manager's venue (null for admins). */
  venueName: string | null
  venues: SearchOption[]
  menuOptions: SearchMenuOptions | null
  destinations: SearchOption[]
  /** The filters as the URL has them. */
  filters: SearchFilterValue
  initialPage: Promise<SearchPageResult>
  /** ISO instant of the render. */
  now: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = React.useTransition()
  // Filters being navigated to: a second change made before the first
  // navigation returns builds on it, not on the stale server props.
  const [shown, setShown] = React.useOptimistic(filters)
  const [attempt, setAttempt] = React.useState(0)
  const [status, setStatus] = React.useState("")
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<string, string>>
  >({})
  const [slowFor, setSlowFor] = React.useState<string | null>(null)
  const headingRef = React.useRef<HTMLHeadingElement>(null)
  const focusHeading = React.useRef(false)
  const today = React.useMemo(() => new Date(now), [now])

  const search = filtersToSearch(filters, mode)
  // The list's key: every URL filter (a manager's stray venue too), so a
  // refused page and its fix never share local state.
  const listKey = `${filtersToSearch(filters, "admin")}#${attempt}`
  const target = filtersToSearch(shown, mode)

  function navigate(
    next: SearchFilterValue,
    options: { focus?: boolean } = {}
  ) {
    const qs = filtersToSearch(next, mode)
    if (options.focus) focusHeading.current = true
    startTransition(() => {
      setShown(next)
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }

  const clear = () => navigate(EMPTY_SEARCH_FILTERS, { focus: true })
  // The Try again button goes with the list it was in: focus the heading.
  const retry = () => {
    focusHeading.current = true
    startTransition(() => {
      setAttempt((a) => a + 1)
      router.refresh()
    })
  }
  const focusResults = React.useCallback(() => headingRef.current?.focus(), [])

  React.useEffect(() => {
    if (pending || !focusHeading.current) return
    focusHeading.current = false
    headingRef.current?.focus()
  }, [pending, search])

  React.useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => setSlowFor(target), SLOW_MS)
    return () => clearTimeout(timer)
  }, [pending, target])

  // New field errors: focus the first control that has one and can take
  // focus; else the error summary, else the results heading.
  React.useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return
    for (const key of CONTROL_ORDER) {
      if (!fieldErrors[key]) continue
      const el = document.getElementById(fieldId(key))
      if (focusable(el)) return el.focus()
    }
    const summary = document.getElementById(ERROR_SUMMARY_ID)
    if (summary) summary.focus()
    else headingRef.current?.focus()
  }, [fieldErrors])

  const onFieldErrors = React.useCallback(
    (errors: Partial<Record<string, string>>) =>
      setFieldErrors((current) =>
        Object.keys(errors).length === 0 && Object.keys(current).length === 0
          ? current
          : errors
      ),
    []
  )

  const pills = filterPills(shown, {
    mode,
    venues,
    menuOptions,
    destinations,
    now: today,
  })
  const statusText = pending
    ? slowFor === target
      ? SEARCH_COPY.stillSearching
      : SEARCH_COPY.searching
    : status

  const emptyStatus =
    pills.length > 0
      ? SEARCH_COPY.emptyFiltered
      : venueName
        ? SEARCH_COPY.emptyManager(venueName)
        : SEARCH_COPY.emptyAdmin
  const empty =
    pills.length > 0 ? (
      <EmptyState
        variant="filtered"
        title={SEARCH_COPY.emptyFiltered}
        description={<p>{widenHint(filters, mode)}</p>}
        action={
          <Button
            type="button"
            variant="secondary"
            size="touch"
            onClick={clear}
          >
            {SEARCH_COPY.clearFilters}
          </Button>
        }
      />
    ) : (
      <EmptyState
        title={
          venueName
            ? SEARCH_COPY.emptyManager(venueName)
            : SEARCH_COPY.emptyAdmin
        }
        description={
          venueName ? <p>{SEARCH_COPY.emptyManagerBody}</p> : undefined
        }
      />
    )

  return (
    <div className="grid min-w-0 gap-(--gutter) md:gap-4">
      <SearchFilters
        mode={mode}
        value={shown}
        onChange={(next) => navigate(next)}
        venues={venues}
        menuOptions={menuOptions}
        destinations={destinations}
        fieldErrors={pending ? {} : fieldErrors}
        onClear={clear}
      />
      <section
        aria-labelledby="search-results-heading"
        className="grid min-w-0 gap-3"
      >
        <h2
          id="search-results-heading"
          ref={headingRef}
          tabIndex={-1}
          className="px-1 font-display text-section-title text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          {SEARCH_COPY.resultsHeading}
        </h2>
        {pills.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 px-1">
            <span className="text-body text-ink-muted">
              {SEARCH_COPY.showing}
            </span>
            <ul className="flex min-w-0 flex-wrap gap-2">
              {pills.map((pill) => (
                <li key={pill.key} className="max-w-full min-w-0">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={SEARCH_COPY.pillName(pill.text)}
                    className="h-auto max-w-full bg-accent-soft text-left [overflow-wrap:anywhere] whitespace-normal"
                    onClick={() =>
                      navigate(
                        {
                          ...shown,
                          [pill.key]: null,
                          ...(pill.key === "item" ? { variant: null } : {}),
                          ...(pill.key === "venue"
                            ? { item: null, variant: null }
                            : {}),
                          ...(pill.key === "rights"
                            ? { destination: null }
                            : {}),
                        },
                        { focus: true }
                      )
                    }
                  >
                    {pill.text}
                    <XIcon aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p role="status" className="min-h-[1lh] px-1 text-body text-ink-muted">
          {statusText}
        </p>
        {/* While new filters load, the list on screen is on its way out:
            inert, so Show more can't act on a list about to be replaced. */}
        <div
          aria-busy={pending}
          inert={pending}
          className={pending ? "opacity-60" : undefined}
        >
          <SearchErrorBoundary onStatus={setStatus}>
            <React.Suspense fallback={<SearchGridSkeleton />}>
              <SearchResults
                key={listKey}
                search={search}
                initialPage={initialPage}
                showVenue={mode === "admin"}
                now={now}
                empty={empty}
                emptyStatus={emptyStatus}
                onStatus={setStatus}
                onFieldErrors={onFieldErrors}
                onRetry={retry}
                onReload={() => navigate(shown, { focus: true })}
                onLostFocus={focusResults}
              />
            </React.Suspense>
          </SearchErrorBoundary>
        </div>
      </section>
    </div>
  )
}
