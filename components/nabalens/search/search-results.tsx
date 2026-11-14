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

/** The loaded pages, tied to the generation of the page one they grew from. */
type ListState = {
  gen: number
  items: AssetSearchItem[]
  cursor: string | null
  /** Focus was in the results when this page one replaced them. */
  recoverFocus: boolean
}

function listFrom(
  first: SearchPageResult,
  gen: number,
  recoverFocus = false
): ListState {
  return first.ok
    ? {
        gen,
        items: first.page.items,
        cursor: first.page.nextCursor,
        recoverFocus,
      }
    : { gen, items: [], cursor: null, recoverFocus }
}

/** The field errors a first page carries (a missing venue is the Venue's). */
export function pageFieldErrors(
  result: SearchPageResult
): Partial<Record<string, string>> {
  if (result.ok) return {}
  if (result.status === 404) return { venue: SEARCH_COPY.venueNotFound }
  return result.code === "invalid_input" ? (result.fieldErrors ?? {}) : {}
}

/** The id of the error summary a 400 shows, for focus when no control can. */
export const ERROR_SUMMARY_ID = "search-error-summary"

/** What the one status region says for a first page that failed. */
export function failureStatus(failure: SearchPageFailure): string {
  if (failure.code === "signed_out") return SEARCH_COPY.signedOut
  if (failure.code === "invalid_input" || failure.status === 404)
    return SEARCH_COPY.checkFilters
  if (failure.code === "not_permitted")
    return failure.message || SEARCH_COPY.notManager
  return SEARCH_COPY.couldNotLoad
}

const MORE_STATUS: Record<Exclude<MoreState, null>, string> = {
  failed: SEARCH_COPY.moreFailed,
  expired: SEARCH_COPY.expired,
  signed_out: SEARCH_COPY.signedOut,
}

/**
 * The result list for one set of filters (keyed by its canonical query, so a
 * filter change mounts a new one). The first page is server-rendered and read
 * with use(); each new server render of it (a refresh, a retry) replaces the
 * list's own pages. Show more and Search again GET /api/media/search with an
 * abort signal, and a page that lands after the list moved on is dropped.
 * Every outcome is said through the screen's one status region (onStatus);
 * nothing here is a live region of its own.
 */
export function SearchResults({
  search,
  initialPage,
  showVenue,
  now,
  empty,
  emptyStatus,
  onStatus,
  onFieldErrors,
  onRetry,
  onReload,
  onLostFocus,
}: {
  /** The canonical query for /api/media/search (no cursor). */
  search: string
  initialPage: Promise<SearchPageResult>
  showVenue: boolean
  /** ISO instant of the render, so server and browser agree on "this year". */
  now: string
  empty: React.ReactNode
  /** What the status region says when nothing matches (the empty title). */
  emptyStatus: string
  /** The line for the screen's one status region. */
  onStatus: (text: string) => void
  onFieldErrors: (errors: Partial<Record<string, string>>) => void
  /** Reads page one again (503 or a lost reply). */
  onRetry: () => void
  /** Leaves a refused URL for the screen's own one. */
  onReload: () => void
  /** The focused control went away with nothing to take its place. */
  onLostFocus: () => void
}) {
  const first = React.use(initialPage)
  const today = React.useMemo(() => new Date(now), [now])
  // The loaded pages carry the generation of the page one they grew from. A
  // page asked for under an earlier generation is dropped inside the state
  // update itself, so it can never land on a newer list, whenever it settles.
  const [list, setList] = React.useState<ListState>(() => listFrom(first, 0))
  const { items, cursor } = list
  const [loading, setLoading] = React.useState(false)
  const [more, setMore] = React.useState<MoreState>(null)
  // A new server render of page one (router.refresh, a retry, a corrected
  // URL with the same key) replaces whatever this list had loaded since.
  const resultsId = React.useId()
  // Search again replaced the control that had focus, and its request is
  // still running: focus is on nothing because of this list.
  const replacedFocus = React.useRef(false)
  const [seenFirst, setSeenFirst] = React.useState(first)
  if (first !== seenFirst) {
    // Where focus is now, before the reset's commit removes anything: inside
    // whatever this list renders (cards, pager controls, the failure notice
    // or the empty state; also while the window is away, since the element
    // stays the page's focus), or on nothing because this list replaced its
    // own focused control (Search again) and that request is still running.
    // Read once, here, so recovery depends on no focus or blur event (React
    // ignores events during its commit; Chromium and WebKit differ on
    // removal). An abandoned render reads it again; nothing is written.
    const active = document.activeElement
    const onNothing = !active || active === document.body
    const recoverFocus =
      (!onNothing &&
        document.getElementById(resultsId)?.contains(active) === true) ||
      (onNothing && replacedFocus.current)
    setSeenFirst(first)
    setList((current) => listFrom(first, current.gen + 1, recoverFocus))
    setLoading(false)
    setMore(null)
  }
  const listRef = React.useRef<HTMLUListElement>(null)
  const pagerRef = React.useRef<HTMLButtonElement>(null)
  const againRef = React.useRef<HTMLButtonElement>(null)
  const signInRef = React.useRef<HTMLAnchorElement>(null)
  const focusIndex = React.useRef<number | null>(null)
  const abort = React.useRef<AbortController | null>(null)
  const lastFrom = React.useRef<string | null>(null)
  // The committed generation, for the parts of a settled page outside `list`.
  const committedGen = React.useRef(list.gen)
  // The committed list moved to a new page one: drop the page in flight now,
  // during the commit, and give focus a home if it was in the results before
  // the reset and the reset left it on nothing.
  const lostFocus = React.useRef(onLostFocus)
  React.useLayoutEffect(() => {
    lostFocus.current = onLostFocus
  })
  React.useLayoutEffect(() => {
    if (committedGen.current === list.gen) return
    committedGen.current = list.gen
    abort.current?.abort()
    replacedFocus.current = false // that request was just dropped
    if (!list.recoverFocus) return
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected)
      lostFocus.current()
  }, [list.gen, list.recoverFocus])

  // The list itself unmounting drops its page in flight.
  React.useEffect(() => () => abort.current?.abort(), [])

  React.useEffect(() => {
    onFieldErrors(pageFieldErrors(first))
  }, [first, onFieldErrors])

  React.useEffect(() => {
    onStatus(
      !first.ok
        ? failureStatus(first)
        : more
          ? MORE_STATUS[more]
          : items.length === 0
            ? loading
              ? ""
              : cursor
                ? SEARCH_COPY.noneYet
                : emptyStatus
            : cursor
              ? SEARCH_COPY.shownMore(items.length)
              : SEARCH_COPY.shown(items.length)
    )
  }, [first, more, items.length, cursor, loading, emptyStatus, onStatus])

  React.useEffect(() => {
    const index = focusIndex.current
    if (index === null) return
    focusIndex.current = null
    const cards =
      listRef.current?.querySelectorAll<HTMLElement>("[data-asset-card]")
    const card = cards?.[Math.min(index, cards.length - 1)]
    if (card) card.focus()
    else onLostFocus()
  }, [items, onLostFocus])

  // A failed Show more puts focus on the control that replaces it.
  React.useEffect(() => {
    if (more === "failed") pagerRef.current?.focus()
    else if (more === "expired") againRef.current?.focus()
    else if (more === "signed_out") signInRef.current?.focus()
  }, [more])

  async function load(from: string | null) {
    if (loading) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const gen = list.gen
    lastFrom.current = from
    // Search again's button is replaced by this request's own render; only
    // then is "focus on nothing" this list's doing (a Show more keeps its
    // button, and a non-focusing click or a blank-space click is not ours).
    replacedFocus.current =
      from === null &&
      againRef.current !== null &&
      document.activeElement === againRef.current
    setLoading(true)
    setMore(null)
    let result: SearchPageResult
    try {
      result = await fetchSearchPage(search, from, controller.signal)
    } catch {
      if (controller.signal.aborted) return // this list moved on
      result = { ok: false, status: 0, code: "no_reply", message: "" }
    }
    // This list moved on (a new page one, or unmounted) while it was asked.
    if (controller.signal.aborted || committedGen.current !== gen) return
    replacedFocus.current = false // settled: focus goes where this page says
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
    focusIndex.current = from === null ? 0 : items.length
    setList((current) => {
      if (current.gen !== gen) return current // a newer page one won
      if (from === null) {
        // Search again: page one replaces the list (same generation; focus
        // goes to its first card through focusIndex).
        return { ...current, items: page.items, cursor: page.nextCursor }
      }
      const seen = new Set(current.items.map((i) => i.id))
      return {
        ...current,
        items: [...current.items, ...page.items.filter((i) => !seen.has(i.id))],
        cursor: page.nextCursor,
      }
    })
  }

  // Each branch's root carries resultsId, so the reset snapshot sees focus on
  // any control this list renders (one branch renders at a time). The
  // failure and empty wrappers add no box: `contents` keeps their layout.
  if (!first.ok) {
    return (
      <div id={resultsId} className="contents">
        <PageFailure failure={first} onRetry={onRetry} onReload={onReload} />
      </div>
    )
  }
  // An empty page that still has a cursor (freshness pages are capped at 500
  // rated candidates) keeps Show more, so older matches stay reachable.
  if (items.length === 0 && !loading && !more && !cursor)
    return (
      <div id={resultsId} className="contents">
        {empty}
      </div>
    )

  return (
    <div id={resultsId} className="grid min-w-0 gap-(--gutter)">
      {items.length === 0 && cursor && !loading ? (
        <p className="text-body text-ink-muted">{SEARCH_COPY.noneYet}</p>
      ) : null}
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
              ref={againRef}
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
              ref={signInRef}
              href={ROUTES.login}
              className={buttonVariants({
                variant: "secondary",
                size: "touch",
              })}
            >
              {SEARCH_COPY.signIn}
            </Link>
          </>
        ) : cursor || more === "failed" ? (
          <Button
            ref={pagerRef}
            type="button"
            variant="secondary"
            size="touch"
            aria-disabled={loading || undefined}
            onClick={() => {
              if (loading) return
              // Try again repeats the page that failed (page one after an
              // expired link); otherwise the next page.
              void load(more === "failed" ? lastFrom.current : cursor)
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

/**
 * A first page that failed: in the list's place, the filters stay usable.
 * Not a live region: its title is said through the screen's status region.
 */
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
        role="none"
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
      <Notice
        id={ERROR_SUMMARY_ID}
        tabIndex={-1}
        tone="negative"
        role="none"
        title={SEARCH_COPY.checkFilters}
      >
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
        role="none"
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
  return <SearchError retry={onRetry} live={false} />
}

export function SearchError({
  retry,
  digest,
  live = true,
}: {
  retry: () => void
  digest?: string
  /** False inside the search screen, whose status region says the title. */
  live?: boolean
}) {
  return (
    <ErrorState
      title={SEARCH_COPY.couldNotLoad}
      role={live ? undefined : "none"}
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

function SearchErrorFallback(
  { onStatus }: { onStatus: (text: string) => void },
  { error, retry }: ErrorInfo
) {
  const digest =
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : undefined
  return <BoundaryFailure onStatus={onStatus} retry={retry} digest={digest} />
}

function BoundaryFailure({
  onStatus,
  retry,
  digest,
}: {
  onStatus: (text: string) => void
  retry: () => void
  digest?: string
}) {
  React.useEffect(() => onStatus(SEARCH_COPY.couldNotLoad), [onStatus])
  return <SearchError retry={retry} digest={digest} live={false} />
}

/** An unexpected throw while reading the results: the list's place only. */
export const SearchErrorBoundary = catchError(SearchErrorFallback)
