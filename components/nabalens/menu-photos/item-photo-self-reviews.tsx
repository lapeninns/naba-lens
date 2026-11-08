"use client"

import * as React from "react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { failureText } from "@/components/nabalens/coverage/copy"
import {
  CoverageBadge,
  SelfReviewBadge,
} from "@/components/nabalens/coverage/coverage-badges"
import { EvidencePreviewButton } from "@/components/nabalens/coverage/evidence-image"
import { LoadMoreButton } from "@/components/nabalens/load-more-button"
import { formatDateTime } from "@/components/nabalens/menus/copy"

import type {
  CoverageResult,
  ItemPhotoSelfReviewView,
  Page,
} from "@/lib/server/coverage/types"

export const ITEM_SELF_REVIEWS_COPY = {
  title: "Our menu self-reviews",
  body: "Managers may accept their own photos for a dish. Each one is recorded here, separately from the monthly self-reviews.",
  empty: "No Our menu self-reviews in this period.",
} as const

const DECISION = {
  accept: "Accepted",
  better_photo: "Asked for a better photo of",
} as const

/** Item-photo decisions managers made on their own photos, newest first (admins). */
export function ItemPhotoSelfReviewList({
  initial,
  onLoadMore,
}: {
  initial: Page<ItemPhotoSelfReviewView>
  onLoadMore?: (
    cursor: string
  ) => Promise<CoverageResult<Page<ItemPhotoSelfReviewView>>>
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
  const [error, setError] = React.useState<string | null>(null)
  const sessionEnded = useSessionEndedCatch()

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
        const seen = new Set(current.map((i) => i.eventId))
        return [...current, ...result.items.filter((i) => !seen.has(i.eventId))]
      })
      setCursor(result.nextCursor)
    } catch (cause) {
      sessionEnded(cause)
      setError("More could not load. Try again.")
    } finally {
      setLoading(false)
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-body text-ink-muted">{ITEM_SELF_REVIEWS_COPY.empty}</p>
    )
  }
  return (
    <div className="grid gap-2">
      <ul
        aria-label={ITEM_SELF_REVIEWS_COPY.title}
        className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
      >
        {items.map((item) => {
          const name = item.author.displayName ?? "A manager"
          const dish = item.item.variantName
            ? `${item.item.name} (${item.item.variantName})`
            : item.item.name
          return (
            <li
              key={item.eventId}
              className="flex items-start gap-3 px-3 py-3 sm:px-4"
            >
              <EvidencePreviewButton
                thumbnailUrl={
                  item.asset.available ? item.asset.thumbnailUrl : null
                }
                previewUrl={item.asset.available ? item.asset.previewUrl : null}
                label={`Photo by ${name}`}
                description={dish}
                className="w-20 shrink-0 sm:w-24"
              />
              <div className="grid min-w-0 gap-1">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="text-label [overflow-wrap:anywhere] text-ink">
                    {name}
                  </span>
                  <SelfReviewBadge />
                  {!item.asset.available ? (
                    <CoverageBadge tone="negative">Photo removed</CoverageBadge>
                  ) : null}
                </p>
                <p className="text-body">
                  {DECISION[item.decision]} {dish} with their own photo at{" "}
                  {item.venue.name}, {formatDateTime(item.decidedAt)}
                </p>
                {item.reason ? (
                  <p className="text-body text-ink-muted">
                    Reason: {item.reason}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      {onLoadMore ? (
        <LoadMoreButton
          hasMore={!!cursor}
          loading={loading}
          error={error}
          onLoadMore={() => void loadMore()}
        />
      ) : null}
    </div>
  )
}
