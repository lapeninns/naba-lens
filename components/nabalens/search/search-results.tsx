"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowClockwiseIcon, SpinnerGapIcon } from "@phosphor-icons/react"
import { catchError, type ErrorInfo } from "next/error"

import { fetchSearchPage } from "@/app/_media/fetch-search-page"
import { Button, buttonVariants } from "@/components/ui/button"
import { ROUTES } from "@/lib/auth/routes"
import type { AssetSearchItem } from "@/lib/server/media/search/types"

import { ErrorState } from "../error-state"
import { Notice } from "../notice"
import { SearchCard } from "./search-card"
import { SEARCH_COPY } from "./search-copy"
import { fieldErrorText } from "./search-filters"
import { RESULTS_GRID } from "./search-skeleton"
import type { SearchPageFailure, SearchPageResult } from "./types"

type MoreState = null | "failed" | "expired" | "signed_out"

/** The field errors a first page carries (a missing venue is the Venue's). */
export function pageFieldErrors(
  result: SearchPageResult
): Partial<Record<string, string>> {
  if (result.ok) return {}
  if (result.status === 404) return { venue: SEARCH_COPY.venueNotFound }
  return result.code === "invalid_input" ? (result.fieldErrors ?? {}) : {}
}

/**
 * The result list for one set of filters (keyed by its canonical query, so a
 * filter change mounts a new one). The first page is server-rendered and read
 * with use(); Show more and Search again GET /api/media/search with an abort
 * signal, and a page that lands after the list is gone is dropped.
 */
export function SearchResults({
  search,
  initialPage,
  showVenue,
  now,
  empty,
  onStatus,
  onFieldErrors,
  onRetry,
  onReload,
}: {
  /** The canonical query for /api/media/search (no cursor). */
  search: string
  initialPage: Promise<SearchPageResult>
  showVenue: boolean
  /** ISO instant of the render, so server and browser agree on "this year". */
  now: string
  empty: React.ReactNode
  /** The count line for the screen's one status region. */
  onStatus: (text: string) => void
  onFieldErrors: (errors: Partial<Record<string, string>>) => void
  /** Reads page one again (503 or a lost reply). */
  onRetry: () => void
  /** Leaves a refused URL for the screen's own one. */
  onReload: () => void
}) {
  const first = React.use(initialPage)
  const today = React.useMemo(() => new Date(now), [now])
  const [items, setItems] = React.useState<AssetSearchItem[]>(
    first.ok ? first.page.items : []
  )
  const [cursor, setCursor] = React.useState<string | null>(
    first.ok ? first.page.nextCursor : null
  )
  const [loading, setLoading] = React.useState(false)
  const [more, setMore] = React.useState<MoreState>(null)
  const listRef = React.useRef<HTMLUListElement>(null)
  const pagerRef = React.useRef<HTMLButtonElement>(null)
  const focusIndex = React.useRef<number | null>(null)
  const abort = React.useRef<AbortController | null>(null)

  React.useEffect(() => () => abort.current?.abort(), [])

  React.useEffect(() => {
    onFieldErrors(pageFieldErrors(first))
  }, [first, onFieldErrors])

  React.useEffect(() => {
    onStatus(
      first.ok && items.length > 0
        ? cursor
          ? SEARCH_COPY.shownMore(items.length)
          : SEARCH_COPY.shown(items.length)
        : ""
    )
  }, [first.ok, items.length, cursor, onStatus])

  React.useEffect(() => {
    const index = focusIndex.current
    if (index === null) return
    focusIndex.current = null
    const cards =
      listRef.current?.querySelectorAll<HTMLElement>("[data-asset-card]")
    cards?.[Math.min(index, cards.length - 1)]?.focus()
  }, [items])

  React.useEffect(() => {
    if (more === "failed") pagerRef.current?.focus()
  }, [more])

  async function load(from: string | null) {
    if (loading) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setLoading(true)
    setMore(null)
    let result: SearchPageResult
    try {
      result = await fetchSearchPage(search, from, controller.signal)
    } catch {
      return // aborted: this list is gone
    }
    if (controller.signal.aborted) return
    setLoading(false)
    if (!result.ok) {
      setMore(
        result.code === "invalid_input" && result.fieldErrors?.cursor
          ? "expired"
          : result.code === "signed_out"
            ? "signed_out"
            : "failed"
      )
      return
    }
    const page = result.page
    if (from === null) {
      // Search again: page one replaces the list.
      focusIndex.current = 0
      setItems(page.items)
    } else {
      focusIndex.current = items.length
      setItems((current) => {
        const seen = new Set(current.map((i) => i.id))
        return [...current, ...page.items.filter((i) => !seen.has(i.id))]
      })
    }
    setCursor(page.nextCursor)
  }

  if (!first.ok) {
    return <PageFailure failure={first} onRetry={onRetry} onReload={onReload} />
  }
  if (items.length === 0 && !loading) return <>{empty}</>

  return (
    <div className="grid min-w-0 gap-(--gutter)">
      <ul ref={listRef} className={RESULTS_GRID}>
        {items.map((item) => (
          <li key={item.id} className="min-w-0">
            <SearchCard item={item} showVenue={showVenue} now={today} />
          </li>
        ))}
      </ul>
      <div className="flex flex-col items-center gap-2 py-2">
        {more === "failed" ? (
          <p className="text-body font-bold text-warn-fg">
            {SEARCH_COPY.moreFailed}
          </p>
        ) : null}
        {more === "expired" ? (
          <>
            <p className="text-body font-bold text-warn-fg">
              {SEARCH_COPY.expired}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="touch"
              onClick={() => load(null)}
            >
              <ArrowClockwiseIcon aria-hidden />
              {SEARCH_COPY.searchAgain}
            </Button>
          </>
        ) : more === "signed_out" ? (
          <>
            <p className="text-body font-bold text-warn-fg">
              {SEARCH_COPY.signedOut}
            </p>
            <Link
              href={ROUTES.login}
              className={buttonVariants({
                variant: "secondary",
                size: "touch",
              })}
            >
              {SEARCH_COPY.signIn}
            </Link>
          </>
        ) : cursor ? (
          <Button
            ref={pagerRef}
            type="button"
            variant="secondary"
            size="touch"
            aria-disabled={loading || undefined}
            onClick={() => {
              if (!loading) void load(cursor)
            }}
          >
            {loading ? (
              <SpinnerGapIcon
                aria-hidden
                className="motion-safe:animate-spin"
              />
            ) : null}
            {loading
              ? SEARCH_COPY.loadingMore
              : more === "failed"
                ? SEARCH_COPY.tryAgain
                : SEARCH_COPY.showMore}
          </Button>
        ) : (
          <p className="text-meta text-ink-muted">
            {SEARCH_COPY.allShown(items.length)}
          </p>
        )}
      </div>
    </div>
  )
}

/** A first page that failed: in the list's place, the filters stay usable. */
function PageFailure({
  failure,
  onRetry,
  onReload,
}: {
  failure: SearchPageFailure
  onRetry: () => void
  onReload: () => void
}) {
  if (failure.code === "signed_out") {
    return (
      <Notice
        tone="attention"
        title={SEARCH_COPY.signedOut}
        action={
          <Link
            href={ROUTES.login}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {SEARCH_COPY.signIn}
          </Link>
        }
      />
    )
  }
  if (failure.code === "invalid_input" || failure.status === 404) {
    const errors = pageFieldErrors(failure)
    return (
      <Notice tone="negative" title={SEARCH_COPY.checkFilters}>
        <ul className="grid gap-1">
          {Object.entries(errors).map(([key, text]) => (
            <li key={key}>{fieldErrorText(key, text ?? "")}</li>
          ))}
        </ul>
      </Notice>
    )
  }
  if (failure.code === "not_permitted") {
    const wrongVenue = failure.message === SEARCH_COPY.wrongVenue
    return (
      <Notice
        tone="attention"
        title={failure.message || SEARCH_COPY.notManager}
        action={
          wrongVenue ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onReload}
            >
              <ArrowClockwiseIcon aria-hidden />
              {SEARCH_COPY.reload}
            </Button>
          ) : undefined
        }
      />
    )
  }
  return <SearchError retry={onRetry} />
}

export function SearchError({
  retry,
  digest,
}: {
  retry: () => void
  digest?: string
}) {
  return (
    <ErrorState
      title={SEARCH_COPY.couldNotLoad}
      action={
        <Button type="button" variant="secondary" size="sm" onClick={retry}>
          <ArrowClockwiseIcon aria-hidden />
          {SEARCH_COPY.tryAgain}
        </Button>
      }
      detail={digest ? `Request ID ${digest}` : undefined}
    />
  )
}

function SearchErrorFallback(_props: object, { error, retry }: ErrorInfo) {
  const digest =
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : undefined
  return <SearchError retry={retry} digest={digest} />
}

/** An unexpected throw while reading the results: the list's place only. */
export const SearchErrorBoundary = catchError(SearchErrorFallback)
