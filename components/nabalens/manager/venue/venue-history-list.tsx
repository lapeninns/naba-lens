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

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso))

function Item({ item }: { item: VenueHistoryItem }) {
  const copy = MANAGER_COPY.venueHistory
  return (
    <li data-history={item.source} className="grid gap-0.5 px-4 py-3 text-body">
      <p className="text-label [overflow-wrap:anywhere] text-ink">
        {historyActionWords(item.action)}
      </p>
      <p className="font-mono text-meta text-ink-muted">
        <time dateTime={item.at}>{when(item.at)}</time> ·{" "}
        {copy.by(item.actorName)}
      </p>
      {item.reason ? (
        <p className="[overflow-wrap:anywhere] text-ink-muted">
          “{item.reason}”
        </p>
      ) : null}
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
