"use client"

import * as React from "react"
import { SpinnerGapIcon } from "@phosphor-icons/react"

import { failureText } from "@/components/nabalens/coverage/copy"
import { formatDate } from "@/components/nabalens/format"
import { Button } from "@/components/ui/button"

import type {
  ItemEvent,
  MenuPhotoResult,
  Page,
} from "@/lib/server/menu-photos/types"

import { MANAGER_COPY } from "../copy"

/** `loadItemEventsAction`: `{ itemId, before }`. */
export type LoadItemEvents = (input: {
  itemId: string
  before: string
}) => Promise<MenuPhotoResult<Page<ItemEvent>>>

/** "{actor} {what happened}", or the event alone when the system did it. */
export function historyText(event: ItemEvent): string {
  const copy = MANAGER_COPY.item
  const verb =
    event.action === "accepted" &&
    event.basis === "reviewer" &&
    event.correctsItemName
      ? copy.historyMoved(event.correctsItemName)
      : copy.historyVerb[event.action]
  if (event.actorName && event.actorRole !== "system")
    return `${event.actorName} ${verb}`
  return verb.charAt(0).toUpperCase() + verb.slice(1)
}

/**
 * An item's decisions, newest first: who did what, when, and why. "Show more"
 * loads older entries in place.
 */
export function ItemHistory({
  itemId,
  initial,
  loadEvents,
}: {
  itemId: string
  /** The first page; null when it could not be read. */
  initial: Page<ItemEvent> | null
  loadEvents: LoadItemEvents
}) {
  const copy = MANAGER_COPY.item
  const [events, setEvents] = React.useState(initial?.items ?? [])
  const [cursor, setCursor] = React.useState(initial?.nextCursor ?? null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(
    initial ? null : copy.historyFailed
  )

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await loadEvents({ itemId, before: cursor })
      if (!result.ok) {
        setError(failureText(result))
        return
      }
      const seen = new Set(events.map((e) => e.id))
      setEvents([...events, ...result.items.filter((e) => !seen.has(e.id))])
      setCursor(result.nextCursor)
    } catch {
      setError(copy.historyFailed)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section aria-labelledby="item-history" className="grid gap-2">
      <h2
        id="item-history"
        className="text-section-title-touch text-ink md:text-section-title"
      >
        {copy.history}
      </h2>
      {events.length === 0 && !error ? (
        <p className="text-body-touch text-ink-muted md:text-body-sm">
          {copy.historyEmpty}
        </p>
      ) : (
        <ol className="grid gap-1.5">
          {events.map((event) => (
            <li
              key={event.id}
              className="text-body-touch break-words text-ink md:text-body-sm"
            >
              {[historyText(event), formatDate(event.createdAt), event.reason]
                .filter(Boolean)
                .join(" · ")}
            </li>
          ))}
        </ol>
      )}
      {error ? (
        <p
          role="alert"
          className="text-body-touch text-negative md:text-body-sm"
        >
          {error}
        </p>
      ) : null}
      {cursor ? (
        <Button
          variant="secondary"
          size="sm"
          className="justify-self-start"
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
    </section>
  )
}
