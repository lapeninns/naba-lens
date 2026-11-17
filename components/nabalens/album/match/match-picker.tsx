"use client"

import * as React from "react"
import { ArrowLeftIcon, PlusIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/ui/search-field"
import { cn } from "@/lib/utils"

import { MATCH_COPY } from "./copy"
import {
  SHARED_KINDS,
  searchNamesAmenity,
  searchSlots,
  suggestSlots,
  type MatchBoard,
  type MatchSlot,
  type SharedKind,
} from "./model"

/** The board as Match holds it: loading, read, or failed with a retry. */
export type BoardState =
  | { state: "loading" }
  | { state: "ready"; board: MatchBoard }
  | { state: "error"; message: string }

/*
 * The match picker (DESIGN.md §5 "Match picker", §6.1): "Which empty slot is
 * this?", the suggested empty slots as dashed buttons, a search over every
 * empty slot, and two secondary buttons, Match later and Not for a slot.
 * Not for a slot then asks what the photo shows, so it is labelled and never
 * waits under Match later (departures.md A-1).
 *
 * The photo itself, and what happens after a choice, belong to the screen
 * around it (Match after picking, or Match later).
 */
export function MatchPicker({
  board,
  onRetryBoard,
  current,
  last,
  taken,
  busy = false,
  headingLevel = 2,
  onMatch,
  onLater,
  onShared,
}: {
  board: BoardState
  onRetryBoard: () => void
  /** Place key of where the person is ("unplaced" for Not placed yet). */
  current: string | null
  /** Place key of the place the person last matched in. */
  last: string | null
  /** Slots already filled in this visit. */
  taken: ReadonlySet<string>
  /** A choice is being sent: the buttons wait. */
  busy?: boolean
  headingLevel?: 2 | 3
  onMatch: (slot: MatchSlot) => void
  /** Leave out to hide Match later (the Match later screen itself). */
  onLater?: () => void
  onShared: (kind: SharedKind) => void
}) {
  const [query, setQuery] = React.useState("")
  const [asking, setAsking] = React.useState(false)
  const questionId = React.useId()
  const Heading = `h${headingLevel}` as "h2"

  if (asking)
    return (
      <section
        aria-labelledby={questionId}
        className="grid gap-3"
        data-slot="match-shared"
      >
        <Heading id={questionId} className="type-section-title text-ink">
          {MATCH_COPY.sharedQuestion}
        </Heading>
        <p className="text-body text-ink-muted">{MATCH_COPY.sharedHint}</p>
        <ul className="flex flex-wrap gap-2">
          {SHARED_KINDS.map((kind) => (
            <li key={kind}>
              <Button
                type="button"
                variant="secondary"
                className="min-h-12 rounded-round"
                disabled={busy}
                onClick={() => {
                  setAsking(false)
                  setQuery("")
                  onShared(kind)
                }}
              >
                {MATCH_COPY.sharedKind(kind)}
              </Button>
            </li>
          ))}
        </ul>
        <div>
          <Button
            type="button"
            variant="quiet"
            className="min-h-12"
            onClick={() => setAsking(false)}
          >
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            {MATCH_COPY.back}
          </Button>
        </div>
      </section>
    )

  const ready = board.state === "ready" ? board.board : null
  const suggested = ready ? suggestSlots(ready, { current, last, taken }) : []
  const found = ready ? searchSlots(ready, query, taken) : []
  const searching = query.trim().length > 0
  const amenity = ready && searching && searchNamesAmenity(ready, query)

  const choose = (slot: MatchSlot) => {
    setQuery("")
    onMatch(slot)
  }

  return (
    <section
      aria-labelledby={questionId}
      className="grid gap-3"
      data-slot="match-picker"
    >
      <Heading id={questionId} className="type-section-title text-ink">
        {MATCH_COPY.question}
      </Heading>

      {board.state === "loading" ? (
        <p role="status" className="text-body text-ink-muted">
          {MATCH_COPY.loading}
        </p>
      ) : board.state === "error" ? (
        <Notice tone="negative" role="alert">
          <span className="grid gap-2">
            <span>
              {MATCH_COPY.loadFailed} {board.message}
            </span>
            <span>
              <Button type="button" variant="secondary" onClick={onRetryBoard}>
                {MATCH_COPY.tryAgain}
              </Button>
            </span>
          </span>
        </Notice>
      ) : null}

      {ready && !searching ? (
        suggested.length > 0 ? (
          <SlotChoices
            label={MATCH_COPY.suggested}
            slots={suggested}
            busy={busy}
            onChoose={choose}
          />
        ) : (
          <p className="text-body text-ink-muted">{MATCH_COPY.noSuggestions}</p>
        )
      ) : null}

      {ready ? (
        <SearchField
          label={MATCH_COPY.searchLabel}
          value={query}
          onValueChange={setQuery}
          resultCount={searching ? MATCH_COPY.searchCount(found.length) : ""}
          autoComplete="off"
        />
      ) : null}

      {ready && searching ? (
        found.length > 0 ? (
          <SlotChoices
            label={MATCH_COPY.searchLabel}
            slots={found.slice(0, 30)}
            busy={busy}
            onChoose={choose}
          />
        ) : (
          <div className="grid gap-1" data-slot="match-search-empty">
            <p className="text-body text-ink">
              {MATCH_COPY.searchNone(query.trim())}
            </p>
            {amenity ? (
              <p className="text-body text-ink-muted">
                {MATCH_COPY.amenityNote}
              </p>
            ) : null}
          </div>
        )
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {onLater ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-13"
            disabled={busy}
            onClick={() => {
              setQuery("")
              onLater()
            }}
          >
            {MATCH_COPY.matchLater}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className={cn("min-h-13", !onLater && "col-span-2")}
          disabled={busy}
          onClick={() => setAsking(true)}
        >
          {MATCH_COPY.notForSlot}
        </Button>
      </div>
    </section>
  )
}

/** Empty slots as dashed buttons (the Needed frame, §4), name then place. */
function SlotChoices({
  label,
  slots,
  busy,
  onChoose,
}: {
  label: string
  slots: MatchSlot[]
  busy: boolean
  onChoose: (slot: MatchSlot) => void
}) {
  return (
    <ul aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {slots.map((slot) => (
        <li key={slot.id}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose(slot)}
            data-slot="match-slot"
            className="flex min-h-15 w-full items-center gap-3 rounded-card slot-needed bg-surface px-3 py-2 text-start text-ink focus-ring disabled:opacity-60"
          >
            <PlusIcon
              aria-hidden
              weight="bold"
              className="size-6 shrink-0 text-accent-text"
            />
            <span className="grid min-w-0">
              <span className="text-label [overflow-wrap:anywhere]">
                {slot.name}
              </span>
              <span className="text-meta text-ink-muted">
                {slot.placeLabel} · {slot.group}
              </span>
              {slot.brief ? (
                <span className="text-meta text-ink-muted">{slot.brief}</span>
              ) : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
