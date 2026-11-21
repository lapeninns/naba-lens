"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  historyActionWords,
  type HistoryCursor,
  type VenueHistoryItem,
  type VenueHistoryPage,
} from "@/lib/manager/venue"

import { MANAGER_COPY } from "../copy"

/*
 * S2-MGR: the venue's change history (spec §7 M5): what changed, who changed
 * it, when, and the reason when one was given. Newest first; "Show older
 * changes" loads the next page in place.
 */

const LONDON = { timeZone: "Europe/London" } as const
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    ...LONDON,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso))
const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    ...LONDON,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso))

/** Each row leads with its time in a fixed column, so a day can be scanned
 * (second handoff). */
function Item({ item }: { item: VenueHistoryItem }) {
  const copy = MANAGER_COPY.venueHistory
  return (
    <li
      data-history={item.source}
      className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 px-4 py-3 text-body"
    >
      <time
        dateTime={item.at}
        className="grid content-start font-mono text-meta text-ink-muted tabular-nums"
      >
        <span>{day(item.at)}</span>
        <span>{clock(item.at)}</span>
      </time>
      <div className="grid min-w-0 gap-0.5">
        <p className="text-label [overflow-wrap:anywhere] text-ink">
          {historyActionWords(item.action)}
        </p>
        <p className="text-meta text-ink-muted">{copy.by(item.actorName)}</p>
        {item.reason ? (
          <p className="[overflow-wrap:anywhere] text-ink-muted">
            “{item.reason}”
          </p>
        ) : null}
      </div>
    </li>
  )
}

export function VenueHistoryList({
  items: first,
  nextCursor = null,
  loadMore,
}: {
  items: VenueHistoryItem[]
  nextCursor?: HistoryCursor | null
  /** Omit to show this page only (the hub's latest five). */
  loadMore?: (
    cursor: HistoryCursor
  ) => Promise<
    { ok: true; page: VenueHistoryPage } | { ok: false; message: string }
  >
}) {
  const copy = MANAGER_COPY.venueHistory
  const [items, setItems] = useState(first)
  const [cursor, setCursor] = useState(nextCursor)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div className="grid gap-3">
      <ol
        data-slot="venue-history"
        className="grid divide-y divide-line overflow-hidden rounded-card bg-surface edge"
      >
        {items.map((item) => (
          <Item key={`${item.source}:${item.id}`} item={item} />
        ))}
      </ol>
      {loadMore && cursor ? (
        <Button
          variant="secondary"
          className="justify-self-start max-md:w-full"
          loading={pending}
          loadingLabel={copy.loadingMore}
          onClick={() =>
            start(async () => {
              setError(null)
              const result = await loadMore(cursor)
              if (result.ok) {
                setItems((prev) => [...prev, ...result.page.items])
                setCursor(result.page.nextCursor)
              } else setError(result.message || copy.failed)
            })
          }
        >
          {copy.more}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-body text-warn-fg">
          {error}
        </p>
      ) : null}
    </div>
  )
}
