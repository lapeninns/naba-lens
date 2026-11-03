"use client"

import * as React from "react"

import { LoadMoreButton } from "@/components/nabalens/load-more-button"
import { formatDateTime } from "@/components/nabalens/menus/copy"

import { failureCode } from "./failure-code"
import {
  failureText,
  labelFor,
  periodKeyLabel,
  plural,
  type CopyMap,
} from "./copy"
import { CoverageBadge, SelfReviewBadge } from "./coverage-badges"
import { EvidencePreviewButton } from "./evidence-image"
import type {
  CoverageResult,
  Page,
  PreparationRunView,
  SelfReviewView,
} from "./types"

function usePagedList<T>(
  initial: Page<T>,
  keyOf: (item: T) => string,
  onLoadMore?: (cursor: string) => Promise<CoverageResult<Page<T>>>
) {
  const [seed, setSeed] = React.useState(initial)
  const [items, setItems] = React.useState(initial.items)
  const [cursor, setCursor] = React.useState(initial.nextCursor)
  if (seed !== initial) {
    setSeed(initial)
    setItems(initial.items)
    setCursor(initial.nextCursor)
  }
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function loadMore() {
    if (!onLoadMore || !cursor) return
    setLoading(true)
    setError(null)
    try {
      const result = await onLoadMore(cursor)
      if (!result.ok) {
        setError(failureText(result))
        return
      }
      setItems((current) => {
        const seen = new Set(current.map(keyOf))
        return [...current, ...result.items.filter((i) => !seen.has(keyOf(i)))]
      })
      setCursor(result.nextCursor)
    } catch {
      setError("More could not load. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return { items, cursor, loading, error, loadMore }
}

const DECISION_TEXT: CopyMap = {
  accept: "Accepted",
  needs_another_photo: "Needs another photo",
  reconciled: "Carried over",
}

/** Decisions managers made on their own photos, newest first. */
export function SelfReviewList({
  initial,
  onLoadMore,
}: {
  initial: Page<SelfReviewView>
  onLoadMore?: (cursor: string) => Promise<CoverageResult<Page<SelfReviewView>>>
}) {
  const list = usePagedList(initial, (i) => i.eventId, onLoadMore)
  if (list.items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No self-reviews in this period.
      </p>
    )
  }
  return (
    <div className="grid gap-2">
      <ul
        aria-label="Self-reviews"
        className="divide-y rounded-lg border bg-card"
      >
        {list.items.map((item) => (
          <li
            key={item.eventId}
            className="flex items-start gap-3 px-3 py-3 sm:px-4"
          >
            <EvidencePreviewButton
              thumbnailUrl={
                item.asset.available ? item.asset.thumbnailUrl : null
              }
              previewUrl={item.asset.available ? item.asset.previewUrl : null}
              label={`Photo by ${item.author.displayName ?? "a manager"}`}
              className="w-20 shrink-0 sm:w-24"
            />
            <div className="grid min-w-0 gap-1">
              <p className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium break-words">
                  {item.author.displayName ?? "A manager"}
                </span>
                <SelfReviewBadge />
                {!item.asset.available ? (
                  <CoverageBadge tone="negative">Photo removed</CoverageBadge>
                ) : null}
              </p>
              <p className="text-sm">
                {labelFor(DECISION_TEXT, item.decision)} their own photo at{" "}
                {item.venue.name}, {formatDateTime(item.decidedAt)}
              </p>
              {item.reason ? (
                <p className="text-sm text-muted-foreground">
                  Reason: {item.reason}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {onLoadMore ? (
        <LoadMoreButton
          hasMore={!!list.cursor}
          loading={list.loading}
          error={list.error}
          onLoadMore={() => void list.loadMore()}
        />
      ) : null}
    </div>
  )
}

/** Monthly preparation runs (scheduled and manual), newest first. */
export function PreparationRunList({
  initial,
  venueNames,
  onLoadMore,
}: {
  initial: Page<PreparationRunView>
  /** Venue id → name, for runs scoped to one venue. */
  venueNames: Record<string, string>
  onLoadMore?: (
    cursor: string
  ) => Promise<CoverageResult<Page<PreparationRunView>>>
}) {
  const list = usePagedList(initial, (i) => i.id, onLoadMore)
  if (list.items.length === 0) {
    return (
      <p className="text-body-touch text-ink-muted md:text-body">
        No preparation has run yet.
      </p>
    )
  }
  return (
    <div className="grid gap-2">
      <ul
        aria-label="Preparation runs"
        className="divide-y divide-line rounded-panel border border-line bg-panel"
      >
        {list.items.map((run) => (
          <li key={run.id} className="grid gap-1 px-3 py-3 sm:px-4">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="text-item-title-touch text-ink md:text-item-title">
                {periodKeyLabel(run.period)},{" "}
                {run.venueId
                  ? (venueNames[run.venueId] ?? "One venue")
                  : "All venues"}
              </span>
              <CoverageBadge
                tone={run.status === "failed" ? "negative" : "positive"}
              >
                {run.status === "failed" ? "Failed" : "Succeeded"}
              </CoverageBadge>
              <CoverageBadge tone="muted">
                {run.trigger === "scheduled" ? "Scheduled" : "Manual"}
              </CoverageBadge>
            </p>
            <p className="text-meta-touch text-ink-muted md:text-meta">
              {formatDateTime(run.startedAt)} ·{" "}
              {run.status === "failed"
                ? `Error code ${run.errorCode ? failureCode(run.errorCode) : "unknown"}. Nothing was half-done.`
                : `${plural(run.staffConsidered, "person", "people")} checked, ${run.targetsCopied} copied, ${run.placeholdersCreated} need setup, ${run.alreadyPresent} already set`}
            </p>
          </li>
        ))}
      </ul>
      {onLoadMore ? (
        <LoadMoreButton
          hasMore={!!list.cursor}
          loading={list.loading}
          error={list.error}
          onLoadMore={() => void list.loadMore()}
        />
      ) : null}
    </div>
  )
}
