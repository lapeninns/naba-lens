"use client"

import * as React from "react"
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  ImageSquareIcon,
  PlusIcon,
  QuestionIcon,
} from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/ui/search-field"
import { cn } from "@/lib/utils"

import { LABEL_PICKER_COPY, MATCH_COPY } from "./copy"
import { SuggestSpecialRow, type SuggestSpecial } from "./suggest-special"
import {
  SHARED_KINDS,
  recentSlots,
  searchNamesAmenity,
  searchSlots,
  slotMark,
  suggestSlots,
  type MatchBoard,
  type MatchSlot,
  type SharedKind,
  type SlotMark,
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
 * waits under Match later (departures.md A-1). I'm not sure (FA-4, spec
 * §5.3) hands the photo to the manager, who chooses its slot. The person's
 * recent slots come first (spec §5.3), offered, never applied; a slot with a
 * photo already waiting is found by search and marked so (spec §6 S1).
 *
 * S3-R12 (X4, X5): a slot that already has a photo (matched in this visit,
 * still sending, waiting, in the album) is never hidden: this visit's slots
 * lead Recent, so the next photo of the same dish is one tap, and search
 * finds every slot, marked. Not on the menu? only follows a search that
 * found no slot at all.
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
  visit = [],
  exclude,
  busy = false,
  headingLevel = 2,
  recent = [],
  onMatch,
  onLater,
  onShared,
  onUnsure,
  onSuggestSpecial,
  traySearchRef,
  labelling = false,
}: {
  board: BoardState
  onRetryBoard: () => void
  /** Place key of where the person is ("unplaced" for Not placed yet). */
  current: string | null
  /** Place key of the place the person last matched in. */
  last: string | null
  /**
   * Slots a photo of this visit went to, or still sending from an earlier
   * one: never suggested as empty, but still offered (marked) under Recent
   * and in search, since another photo of the same dish is welcome (X4).
   */
  taken: ReadonlySet<string>
  /** Slot ids matched in this visit, newest first: they lead Recent. */
  visit?: readonly string[]
  /** Slots never offered at all (the photo's own slot, in Change slot). */
  exclude?: ReadonlySet<string>
  /** A choice is being sent: the buttons wait. */
  busy?: boolean
  headingLevel?: 2 | 3
  onMatch: (slot: MatchSlot) => void
  /** Slot ids the person matched most recently on this phone, newest first. */
  recent?: readonly string[]
  /** Leave out to hide Match later (the Match later screen itself). */
  onLater?: () => void
  onShared: (kind: SharedKind) => void
  /** Leave out to hide I'm not sure. */
  onUnsure?: (note?: string) => void
  /** A search that found nothing offers to suggest a special (staff). */
  onSuggestSpecial?: SuggestSpecial
  /** Tray sheet puts search above the choices and focuses it on open. */
  traySearchRef?: React.Ref<HTMLInputElement>
  /** Labelling photos already posted (D21): dish, drink or space words. */
  labelling?: boolean
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
  const offered = (slot: MatchSlot) => !exclude?.has(slot.id)
  const recents = ready
    ? recentSlots(
        ready,
        [...visit, ...recent].filter((id) => !exclude?.has(id))
      )
    : []
  const recentIds = new Set(recents.map((slot) => slot.id))
  const suggested = ready
    ? suggestSlots(ready, { current, last, taken }).filter(
        (slot) => !recentIds.has(slot.id) && offered(slot)
      )
    : []
  const found = ready ? searchSlots(ready, query, taken).filter(offered) : []
  const searching = query.trim().length > 0
  const amenity = ready && searching && searchNamesAmenity(ready, query)

  const words = labelling ? LABEL_PICKER_COPY : MATCH_COPY
  const choose = (slot: MatchSlot) => {
    setQuery("")
    onMatch(slot)
  }
  const search = (
    <SearchField
      ref={traySearchRef}
      label={words.searchLabel}
      placeholder={traySearchRef ? "Search menu items or places" : undefined}
      value={query}
      onValueChange={setQuery}
      resultCount={searching ? MATCH_COPY.searchCount(found.length) : ""}
      autoComplete="off"
    />
  )
  const askAbout =
    (traySearchRef || labelling) && ready && searching && found.length === 0
      ? query.trim().slice(0, 120)
      : ""

  return (
    <section
      aria-labelledby={questionId}
      className="grid gap-3"
      data-slot="match-picker"
    >
      <Heading
        id={questionId}
        className={traySearchRef ? "sr-only" : "type-section-title text-ink"}
      >
        {traySearchRef ? MATCH_COPY.trayChoose : words.question}
      </Heading>

      {traySearchRef ? search : null}

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

      {ready && !searching && recents.length > 0 ? (
        <SlotChoices
          label={MATCH_COPY.recent}
          heading
          slots={recents}
          taken={taken}
          busy={busy}
          onChoose={choose}
        />
      ) : null}

      {ready && !searching ? (
        suggested.length > 0 ? (
          <SlotChoices
            label={MATCH_COPY.suggested}
            heading={recents.length > 0}
            slots={suggested}
            taken={taken}
            busy={busy}
            onChoose={choose}
          />
        ) : recents.length === 0 ? (
          <p className="text-body text-ink-muted">{words.noSuggestions}</p>
        ) : null
      ) : null}

      {ready && !traySearchRef ? search : null}

      {ready && searching ? (
        found.length > 0 ? (
          <SlotChoices
            label={words.searchLabel}
            slots={found.slice(0, 30)}
            taken={taken}
            busy={busy}
            onChoose={choose}
          />
        ) : (
          <div className="grid gap-1" data-slot="match-search-empty">
            <p className="text-body text-ink">
              {words.searchNone(query.trim())}
            </p>
            {amenity ? (
              <p className="text-body text-ink-muted">
                {MATCH_COPY.amenityNote}
              </p>
            ) : null}
            {onSuggestSpecial && !amenity && query.trim().length >= 3 ? (
              <SuggestSpecialRow
                key={query.trim()}
                name={query.trim().slice(0, 120)}
                onSuggest={onSuggestSpecial}
              />
            ) : null}
          </div>
        )
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {onLater ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-12"
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
          className={cn("min-h-12", !onLater && "col-span-2")}
          disabled={busy}
          onClick={() => setAsking(true)}
        >
          {MATCH_COPY.notForSlot}
        </Button>
        {onUnsure ? (
          <Button
            type="button"
            variant="secondary"
            className="col-span-2 min-h-12 flex-col gap-0 py-1.5"
            disabled={busy}
            data-slot="match-unsure"
            onClick={() => {
              setQuery("")
              onUnsure(askAbout || undefined)
            }}
          >
            <span className="flex items-center gap-2">
              <QuestionIcon aria-hidden weight="bold" className="size-5" />
              {askAbout
                ? MATCH_COPY.trayAskAbout(askAbout)
                : traySearchRef || labelling
                  ? MATCH_COPY.trayAsk
                  : MATCH_COPY.notSure}
            </span>
            <span className="text-meta font-normal text-ink-muted">
              {MATCH_COPY.notSureHint}
            </span>
          </Button>
        ) : null}
      </div>
    </section>
  )
}

/** The line under a slot that already has a photo (X4, X5). */
const MARK_META: Record<SlotMark, string> = {
  taken: MATCH_COPY.takenMeta,
  waiting: MATCH_COPY.waitingMeta,
  accepted: MATCH_COPY.acceptedMeta,
  "check-due": MATCH_COPY.checkDueMeta,
}

/**
 * Slots as buttons, name then place: an empty one in the dashed Needed frame
 * (§4); one with a photo already on its way or waiting in a plain edge with
 * ↑, one already in the album in a plain edge with a photo icon (the dashed
 * frame belongs to Needed alone), each with its line. An optional slot
 * (FA-51) takes a plain edge with + and "Optional".
 */
function SlotChoices({
  label,
  heading = false,
  slots,
  taken,
  busy,
  onChoose,
}: {
  label: string
  /** Show the label as a small heading above the list. */
  heading?: boolean
  slots: MatchSlot[]
  taken: ReadonlySet<string>
  busy: boolean
  onChoose: (slot: MatchSlot) => void
}) {
  const id = React.useId()
  return (
    <div className="grid gap-2">
      {heading ? (
        <p id={id} className="text-meta font-semibold text-ink-muted">
          {label}
        </p>
      ) : null}
      <ul
        aria-label={heading ? undefined : label}
        aria-labelledby={heading ? id : undefined}
        className="grid gap-2 sm:grid-cols-2"
      >
        {slots.map((slot) => {
          const mark = slotMark(slot, taken)
          return (
            <li key={slot.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose(slot)}
                data-slot="match-slot"
                data-waiting={mark === "waiting" ? "" : undefined}
                data-mark={mark ?? undefined}
                data-optional={slot.optional ? "" : undefined}
                className={cn(
                  "flex min-h-15 w-full items-center gap-3 rounded-card bg-surface px-3 py-2 text-start text-ink focus-ring disabled:opacity-60",
                  // FA-51: an optional slot is not Needed; it never takes
                  // the dashed frame.
                  mark || slot.optional ? "edge" : "slot-needed"
                )}
              >
                {mark === "accepted" || mark === "check-due" ? (
                  <ImageSquareIcon
                    aria-hidden
                    className="size-6 shrink-0 text-ink-muted"
                  />
                ) : mark ? (
                  <ArrowUpIcon
                    aria-hidden
                    weight="bold"
                    className="size-6 shrink-0 text-ink-muted"
                  />
                ) : (
                  <PlusIcon
                    aria-hidden
                    weight="bold"
                    className="size-6 shrink-0 text-accent-text"
                  />
                )}
                <span className="grid min-w-0">
                  <span className="text-label [overflow-wrap:anywhere]">
                    {slot.name}
                  </span>
                  <span className="text-meta text-ink-muted">
                    {slot.placeLabel} · {slot.group}
                  </span>
                  {mark ? (
                    <span className="text-meta text-ink-muted">
                      {MARK_META[mark]}
                    </span>
                  ) : slot.optional ? (
                    <span className="text-meta text-ink-muted">
                      {MATCH_COPY.optionalMeta}
                    </span>
                  ) : slot.brief ? (
                    <span className="text-meta text-ink-muted">
                      {slot.brief}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
