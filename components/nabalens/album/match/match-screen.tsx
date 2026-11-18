"use client"

import * as React from "react"
import {
  ArrowUpIcon,
  CloudArrowUpIcon,
  ImagesIcon,
  CheckIcon,
  InfoIcon,
  MapPinSimpleIcon,
  NotePencilIcon,
  PlusIcon,
  WarningIcon,
} from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { useOnline } from "@/components/nabalens/offline-notice"
import { useObjectUrl } from "@/components/nabalens/use-upload-queue"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { LinkButton } from "@/components/ui/link-button"
import { Textarea } from "@/components/ui/textarea"
import { LABEL_LIMITS } from "@/lib/menus/types"
import {
  measurePhoto,
  qualityHints,
  type QualityHint,
} from "@/lib/upload/quality"
import { cn } from "@/lib/utils"

import { MATCH_COPY } from "./copy"
import { MatchPicker, type BoardState } from "./match-picker"
import type { SuggestSpecial } from "./suggest-special"
import { groupKeys, openAfter, type MatchSlot, type SharedKind } from "./model"

/** One photo chosen from the gallery, waiting to be matched. */
export type MatchPhoto = { key: string; file: File }

/** What the person decided for a photo (§6.1 step 5). */
export type MatchOutcome =
  | { kind: "slot"; slot: MatchSlot }
  | { kind: "later" }
  | { kind: "shared"; shared: SharedKind }
  /** I'm not sure (FA-4): the manager chooses the slot (Needs label). */
  | { kind: "unsure" }

/**
 * How a decided photo is getting on in Add's queue (the honest receipts of
 * spec §5.6, in Album's words: lib/upload/states.ts). "checking": the server
 * has it and is still processing it. "waiting": processed and its slot saved
 * with it, so the manager can review it. "sent": processed, but its slot
 * was not saved with it (fixed from Me). "unfinished": the server had it and
 * could not finish it; Add photos tries again without sending it twice.
 * "refused": the queue would not take it (too large, say); it is still in
 * the gallery.
 */
export type SendState =
  | "sending"
  | "checking"
  | "waiting"
  | "sent"
  | "failed"
  | "unfinished"
  | "offline"
  | "refused"

/**
 * After a choice, a finger's tap this soon on the next photo's picker is the
 * same double tap (the list moves under it), not a choice (§6.1). Keyboard
 * and single mouse clicks are never held back.
 */
export const MATCH_TAP_GUARD_MS = 400

/** Where "See the album" goes: Album, the staff Home. */
export const ALBUM_HREF = "/staff/tasks"

/*
 * Match (DESIGN.md §5 "Match picker", §6.1): the photos chosen from the
 * gallery as a strip (the current one ringed in accent), the current photo
 * on the stage, and the match picker under it. Each choice sends the photo
 * at once and moves to the next one; once every photo has its answer, the
 * end says how many slots were filled, what happens next, and See the album.
 *
 * Closing early keeps every photo: the ones without an answer go under
 * Match later, which the close button says.
 *
 * Full App v1 (S2-ADD): the venue is always named under the title (spec
 * §5.1); "Use your choice for N photos" gives a run of one dish one answer
 * (spec §5.4, FA-3), shown on the strip and never more than asked for; I'm
 * not sure sends a photo to the manager (FA-4); a short note is optional and
 * collapsed (§5.1, §6 S2); dark, blurred and small photos get a hint that
 * never stops the send (§5.5); the end names the venue, the photo count,
 * each slot with its count and how many wait for the manager (§6 S2).
 */
export function MatchScreen({
  open,
  photos,
  outcomes,
  sendStates: sent,
  board,
  onRetryBoard,
  current,
  last,
  notice = null,
  busySlots,
  venueName = null,
  recent,
  duplicates,
  onSuggestSpecial,
  onDecide,
  onClose,
}: {
  open: boolean
  /** In capture order. */
  photos: readonly MatchPhoto[]
  outcomes: ReadonlyMap<string, MatchOutcome>
  sendStates: ReadonlyMap<string, SendState>
  board: BoardState
  onRetryBoard: () => void
  current: string | null
  last: string | null
  /** A line about the pick itself (more photos than Match takes). */
  notice?: string | null
  /**
   * Slots this phone is already sending a photo to (an earlier Match): never
   * suggested or found, so a slot is not sent twice.
   */
  busySlots?: ReadonlyMap<string, unknown>
  /** The venue these photos go to (spec §5.1). */
  venueName?: string | null
  /** Slot ids matched most recently on this phone, newest first. */
  recent?: readonly string[]
  /** Photo keys the server found were sent before (same bytes, same venue). */
  duplicates?: ReadonlySet<string>
  /** A dish not on the menu: suggest it as a local special. */
  onSuggestSpecial?: SuggestSpecial
  /**
   * One call per photo the choice applies to; `note` is the optional note
   * (trimmed, null when none), the same for every photo of the choice.
   */
  onDecide: (key: string, outcome: MatchOutcome, note?: string | null) => void
  onClose: () => void
}) {
  const [shown, setShown] = React.useState<string | null>(null)
  // "Use your choice for N photos" (§5.4): 1 unless the person asks for more.
  const [groupSize, setGroupSize] = React.useState(1)
  const [noteOpen, setNoteOpen] = React.useState(false)
  const [note, setNote] = React.useState("")
  // Without a signal a matched photo waits on the phone (§6.8).
  const online = useOnline()
  const sendStates = React.useMemo(
    () =>
      online
        ? sent
        : new Map(
            [...sent].map(([key, state]) => [
              key,
              state === "sending" ? ("offline" as const) : state,
            ])
          ),
    [online, sent]
  )
  const firstOpen = photos.find((p) => !outcomes.has(p.key))?.key ?? null
  // The photo on the stage: the one chosen in the strip, else the next one
  // without an answer.
  const shownKey =
    shown && photos.some((p) => p.key === shown) ? shown : firstOpen
  const index = photos.findIndex((p) => p.key === shownKey)
  const photo = index >= 0 ? photos[index] : null
  const decided = photo ? (outcomes.get(photo.key) ?? null) : null
  const done = firstOpen === null && (shown === null || !!decided)
  const left = photo && !decided ? openAfter(photos, outcomes, photo.key) : 0
  const size = Math.min(groupSize, left + 1)
  const group = React.useMemo(
    () =>
      photo && !decided
        ? new Set(groupKeys(photos, outcomes, photo.key, size))
        : new Set<string>(),
    [photo, decided, photos, outcomes, size]
  )
  const taken = React.useMemo(
    () =>
      new Set([
        ...[...outcomes.values()].flatMap((o) =>
          o.kind === "slot" ? [o.slot.id] : []
        ),
        ...(busySlots?.keys() ?? []),
      ]),
    [outcomes, busySlots]
  )
  const titleId = React.useId()
  const titleRef = React.useRef<HTMLHeadingElement>(null)
  const summaryRef = React.useRef<HTMLHeadingElement>(null)
  const lastChoice = React.useRef(-Infinity)
  const pointerType = React.useRef<string | null>(null)
  /** A tap that is the tail of a double tap on the choice before it. */
  const strayTap = (event: React.MouseEvent) => {
    if (event.detail === 0) return false
    if (performance.now() - lastChoice.current >= MATCH_TAP_GUARD_MS)
      return false
    return (
      event.detail > 1 ||
      pointerType.current === "touch" ||
      pointerType.current === "pen"
    )
  }
  // Each choice brings a new picker (or the end): focus goes to the title
  // ("Photo 2 of 5"), or to the end's heading, never to the page (§8).
  const [moved, setMoved] = React.useState(0)
  React.useEffect(() => {
    if (moved === 0) return
    ;(summaryRef.current ?? titleRef.current)?.focus()
  }, [moved])

  const decide = (outcome: MatchOutcome) => {
    if (!photo) return
    lastChoice.current = performance.now()
    const text = note.trim().slice(0, LABEL_LIMITS.maxNoteLength) || null
    for (const key of groupKeys(photos, outcomes, photo.key, size))
      onDecide(key, outcome, text)
    setShown(null)
    setGroupSize(1)
    setNote("")
    setNoteOpen(false)
    setMoved((n) => n + 1)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        size="viewer"
        showCloseButton={false}
        aria-labelledby={titleId}
        data-slot="match-screen"
        // minmax(0,1fr): the photo strip scrolls sideways; without it the
        // strip's full length sets the dialog's width (320px reflow).
        className="grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] bg-surface"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-2">
          <div className="grid min-w-0">
            <DialogTitle
              id={titleId}
              ref={titleRef}
              tabIndex={-1}
              className="type-section-title text-ink tabular-nums outline-none"
            >
              {done
                ? MATCH_COPY.title
                : MATCH_COPY.photoOf(index + 1, photos.length)}
            </DialogTitle>
            {venueName ? (
              <p
                className="flex items-center gap-1 text-meta font-semibold [overflow-wrap:anywhere] text-ink-muted"
                data-slot="match-venue"
              >
                <MapPinSimpleIcon aria-hidden className="size-4 shrink-0" />
                {MATCH_COPY.venueLine(venueName)}
              </p>
            ) : null}
            {!done && photos.length > 1 ? (
              <p
                className="font-mono text-mono font-semibold text-ink-muted tabular-nums"
                data-slot="match-open-count"
              >
                {MATCH_COPY.openCount(
                  photos.filter((p) => !outcomes.has(p.key)).length
                )}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="quiet"
            className="min-h-12"
            onClick={onClose}
          >
            {done || firstOpen === null
              ? MATCH_COPY.close
              : MATCH_COPY.closeRest}
          </Button>
        </div>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          {notice ? (
            <div className="px-3 pt-3">
              <Notice tone="attention" role="status">
                {notice}
              </Notice>
            </div>
          ) : null}

          {photos.length > 1 && !done ? (
            <Strip
              photos={photos}
              outcomes={outcomes}
              shownKey={shownKey}
              group={group}
              onShow={(key) => {
                setShown(key)
                setGroupSize(1)
              }}
            />
          ) : null}

          {done ? (
            <Summary
              headingRef={summaryRef}
              photos={photos}
              outcomes={outcomes}
              sendStates={sendStates}
              venueName={venueName}
              duplicates={duplicates}
              onClose={onClose}
            />
          ) : photo ? (
            <>
              <Stage
                file={photo.file}
                alt={MATCH_COPY.photoOf(index + 1, photos.length)}
              />
              {decided ? null : (
                <QualityLine key={photo.key} file={photo.file} />
              )}
              {!decided && left > 0 ? (
                <GroupControl
                  next={photos.flatMap((p, i) =>
                    i > index && !outcomes.has(p.key)
                      ? [{ photo: p, n: i + 1 }]
                      : []
                  )}
                  size={size}
                  onSize={setGroupSize}
                />
              ) : null}
              <div
                className="px-3"
                onPointerDownCapture={(event) => {
                  pointerType.current = event.pointerType
                }}
                onClickCapture={(event) => {
                  if (!strayTap(event)) return
                  event.preventDefault()
                  event.stopPropagation()
                }}
              >
                {decided ? (
                  <Decided
                    outcome={decided}
                    state={sendStates.get(photo.key) ?? null}
                    duplicate={duplicates?.has(photo.key) ?? false}
                  />
                ) : (
                  <div className="grid gap-3">
                    <MatchPicker
                      // A fresh picker (query, Not for a slot step) per photo.
                      key={photo.key}
                      board={board}
                      onRetryBoard={onRetryBoard}
                      current={current}
                      last={last}
                      taken={taken}
                      recent={recent}
                      onMatch={(slot) => decide({ kind: "slot", slot })}
                      onLater={() => decide({ kind: "later" })}
                      onShared={(shared) => decide({ kind: "shared", shared })}
                      onUnsure={() => decide({ kind: "unsure" })}
                      onSuggestSpecial={onSuggestSpecial}
                    />
                    <NoteField
                      open={noteOpen}
                      onOpen={() => setNoteOpen(true)}
                      value={note}
                      onChange={setNote}
                    />
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function outcomeWords(outcome: MatchOutcome | null): string | null {
  if (!outcome) return null
  if (outcome.kind === "slot") return MATCH_COPY.matchedTo(outcome.slot.name)
  if (outcome.kind === "later") return MATCH_COPY.laterWord
  if (outcome.kind === "unsure") return MATCH_COPY.unsureWord
  return MATCH_COPY.sharedWord
}

/**
 * "Use for the next N photos" (spec §5.4, FA-3): the next photos without an
 * answer as a row of thumbnails. One tap on a photo groups every photo up to
 * it with the shown one (a run of one dish is taken in a row); a tap on the
 * last grouped one gives it back. "All N left" groups the rest. The grouped
 * photos are ringed here and on the strip; nothing is applied until the
 * person chooses a slot (never a silent default, §5.4).
 */
function GroupControl({
  next,
  size,
  onSize,
}: {
  /** The photos after the shown one without an answer, in strip order. */
  next: readonly { photo: MatchPhoto; n: number }[]
  /** Photos the choice covers, the shown one included. */
  size: number
  onSize: (n: number) => void
}) {
  const labelId = React.useId()
  const hint = MATCH_COPY.groupHint(size)
  const all = next.length + 1
  return (
    <div className="grid min-w-0 gap-1 px-3" data-slot="match-group">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <p id={labelId} className="text-label text-ink">
          {MATCH_COPY.groupLabel}
        </p>
        {all > 2 && size < all ? (
          <Button
            type="button"
            variant="quiet"
            className="min-h-12"
            onClick={() => onSize(all)}
          >
            {MATCH_COPY.groupAll(all)}
          </Button>
        ) : size > 1 ? (
          <Button
            type="button"
            variant="quiet"
            className="min-h-12"
            onClick={() => onSize(1)}
          >
            {MATCH_COPY.groupJustThis}
          </Button>
        ) : null}
      </div>
      <ul
        aria-labelledby={labelId}
        className="flex min-w-0 gap-2 overflow-x-auto pt-1 pb-1"
      >
        {next.map(({ photo, n }, i) => {
          const on = i + 2 <= size
          return (
            <li key={photo.key} className="shrink-0">
              <button
                type="button"
                aria-pressed={on}
                aria-label={MATCH_COPY.groupPhoto(n)}
                data-slot="match-group-photo"
                // Up to this photo; tapping the last grouped one lets it go.
                onClick={() => onSize(on && i + 2 === size ? i + 1 : i + 2)}
                className={cn(
                  "relative block size-12 overflow-hidden rounded-control bg-media-placeholder focus-ring",
                  on && "ring-3 ring-accent ring-offset-2 ring-offset-surface"
                )}
              >
                <Thumb file={photo.file} />
                {on ? (
                  <span
                    aria-hidden
                    className="absolute right-0.5 bottom-0.5 grid size-5 place-items-center rounded-round bg-accent text-on-accent"
                  >
                    <CheckIcon weight="bold" className="size-3" />
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="text-meta text-ink-muted" aria-live="polite">
        {hint || MATCH_COPY.groupNone}
      </p>
    </div>
  )
}

/** The optional note (spec §5.1), collapsed until asked for (§6 S2). */
function NoteField({
  open,
  onOpen,
  value,
  onChange,
}: {
  open: boolean
  onOpen: () => void
  value: string
  onChange: (text: string) => void
}) {
  const id = React.useId()
  const hintId = React.useId()
  const field = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => {
    if (open) field.current?.focus()
  }, [open])
  if (!open)
    return (
      <div>
        <Button
          type="button"
          variant="quiet"
          className="min-h-12"
          aria-expanded={false}
          onClick={onOpen}
          data-slot="match-note-toggle"
        >
          <NotePencilIcon data-icon="inline-start" aria-hidden />
          {MATCH_COPY.noteToggle}
        </Button>
      </div>
    )
  return (
    <div className="grid gap-1" data-slot="match-note">
      <label htmlFor={id} className="text-label text-ink">
        {MATCH_COPY.noteLabel}
      </label>
      <Textarea
        ref={field}
        id={id}
        aria-describedby={hintId}
        value={value}
        maxLength={LABEL_LIMITS.maxNoteLength}
        rows={2}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={hintId} className="text-meta text-ink-muted">
        {MATCH_COPY.noteHint}
      </p>
    </div>
  )
}

const QUALITY_WORDS: Record<QualityHint, string> = {
  dark: MATCH_COPY.qualityDark,
  blurry: MATCH_COPY.qualityBlurry,
  small: MATCH_COPY.qualitySmall,
}

/** Dark, blurred or small (spec §5.5): a hint, never a block. */
function QualityLine({ file }: { file: File }) {
  const [hints, setHints] = React.useState<QualityHint[]>([])
  React.useEffect(() => {
    let live = true
    void measurePhoto(file).then((m) => {
      if (live) setHints(qualityHints(m))
    })
    return () => {
      live = false
    }
  }, [file])
  if (hints.length === 0) return null
  return (
    <ul className="grid gap-1 px-3" data-slot="match-quality" role="status">
      {hints.map((hint) => (
        <li
          key={hint}
          data-hint={hint}
          className="flex items-start gap-2 text-meta text-ink-muted"
        >
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {QUALITY_WORDS[hint]}
        </li>
      ))}
    </ul>
  )
}

/** The chosen photos, current one ringed in accent (§5). */
function Strip({
  photos,
  outcomes,
  shownKey,
  group,
  onShow,
}: {
  photos: readonly MatchPhoto[]
  outcomes: ReadonlyMap<string, MatchOutcome>
  shownKey: string | null
  /** Photos the next choice applies to besides the shown one. */
  group: ReadonlySet<string>
  onShow: (key: string) => void
}) {
  return (
    <ul
      aria-label={MATCH_COPY.stripLabel}
      className="flex min-w-0 gap-2 overflow-x-auto px-3 pt-3 pb-1"
      data-slot="match-strip"
    >
      {photos.map((photo, i) => {
        const outcome = outcomes.get(photo.key) ?? null
        const here = photo.key === shownKey
        const grouped = !here && group.has(photo.key)
        return (
          <li key={photo.key} className="shrink-0">
            <button
              type="button"
              aria-current={here ? "true" : undefined}
              data-grouped={grouped ? "" : undefined}
              aria-label={MATCH_COPY.stripPhoto(
                i + 1,
                photos.length,
                outcomeWords(outcome)
              )}
              onClick={() => onShow(photo.key)}
              className={cn(
                "relative block size-14 overflow-hidden rounded-control bg-media-placeholder focus-ring",
                here && "ring-3 ring-accent ring-offset-2 ring-offset-surface",
                grouped &&
                  "ring-2 ring-accent ring-offset-2 ring-offset-surface"
              )}
            >
              <Thumb file={photo.file} />
              {grouped ? (
                <span
                  aria-hidden
                  className="absolute right-0.5 bottom-0.5 grid size-5 place-items-center rounded-round bg-accent text-on-accent"
                >
                  <PlusIcon weight="bold" className="size-3" />
                </span>
              ) : null}
              {outcome ? (
                <span aria-hidden className="absolute inset-0 bg-scrim" />
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Thumb({ file }: { file: File }) {
  const src = useObjectUrl(file)
  return src ? (
    // A local object URL: next/image cannot optimise it.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="size-full object-cover" />
  ) : null
}

/** The current photo, large on the stage (§3.1 `stage`). */
function Stage({ file, alt }: { file: File; alt: string }) {
  const src = useObjectUrl(file)
  return (
    <div className="grid h-[min(42dvh,24rem)] place-items-center bg-stage">
      {src ? (
        // A local object URL: next/image cannot optimise it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <span className="text-body text-on-stage">{alt}</span>
      )}
    </div>
  )
}

function stateWord(state: SendState | null) {
  if (state === "waiting") return MATCH_COPY.waiting
  if (state === "checking") return MATCH_COPY.checking
  if (state === "sent") return MATCH_COPY.sentWord
  if (state === "unfinished") return MATCH_COPY.unfinishedWord
  if (state === "failed") return MATCH_COPY.notSent
  if (state === "refused") return MATCH_COPY.notAddedWord
  if (state === "offline") return MATCH_COPY.savedOnPhone
  return MATCH_COPY.sending
}

function StateIcon({ state }: { state: SendState | null }) {
  const cls = "size-5 shrink-0"
  if (state === "waiting")
    return <ArrowUpIcon aria-hidden weight="bold" className={cls} />
  if (state === "failed" || state === "refused" || state === "unfinished")
    return <WarningIcon aria-hidden weight="bold" className={cls} />
  if (state === "offline")
    return <CloudArrowUpIcon aria-hidden className={cls} />
  // Sending is a word alone (DESIGN.md §4).
  return null
}

/** A photo that already has its answer, shown again from the strip. */
function Decided({
  outcome,
  state,
  duplicate,
}: {
  outcome: MatchOutcome
  state: SendState | null
  duplicate: boolean
}) {
  return (
    <p className="flex items-center gap-2 text-body text-ink" role="status">
      {outcome.kind === "slot" || state === "refused" ? (
        <StateIcon state={state} />
      ) : null}
      <span>
        {outcome.kind === "slot"
          ? `${outcome.slot.name}: ${stateWord(state)}`
          : state === "refused"
            ? MATCH_COPY.notAddedWord
            : outcome.kind === "later"
              ? MATCH_COPY.matchLater
              : outcome.kind === "unsure"
                ? MATCH_COPY.unsureWord
                : MATCH_COPY.sharedKind(outcome.shared)}
        {duplicate ? ` · ${MATCH_COPY.duplicateWord}` : null}
      </span>
    </p>
  )
}

/** The end of Match (§6.1 step 6). */
function Summary({
  headingRef,
  photos,
  outcomes,
  sendStates,
  venueName,
  duplicates,
  onClose,
}: {
  headingRef: React.Ref<HTMLHeadingElement>
  photos: readonly MatchPhoto[]
  outcomes: ReadonlyMap<string, MatchOutcome>
  sendStates: ReadonlyMap<string, SendState>
  venueName: string | null
  duplicates?: ReadonlySet<string>
  onClose: () => void
}) {
  const matched = photos.flatMap((photo) => {
    const outcome = outcomes.get(photo.key)
    return outcome?.kind === "slot" ? [{ photo, slot: outcome.slot }] : []
  })
  // A photo the queue refused is under neither: it is still in the gallery.
  const count = (kind: MatchOutcome["kind"]) =>
    photos.filter(
      (p) =>
        outcomes.get(p.key)?.kind === kind &&
        sendStates.get(p.key) !== "refused"
    ).length
  const later = count("later")
  const shared = count("shared")
  const unsure = count("unsure")
  const added = photos.filter((p) => sendStates.get(p.key) !== "refused").length
  // One chip per slot with how many photos went to it (§6 S2 label chips).
  const chips = new Map<string, { name: string; n: number }>()
  for (const { slot } of matched) {
    const chip = chips.get(slot.id)
    chips.set(slot.id, { name: slot.name, n: (chip?.n ?? 0) + 1 })
  }
  const failed = photos.filter((p) => sendStates.get(p.key) === "failed").length
  const unfinished = photos.filter(
    (p) => sendStates.get(p.key) === "unfinished"
  ).length
  const refused = photos.filter(
    (p) => sendStates.get(p.key) === "refused"
  ).length
  // A photo whose slot was not saved with it ("sent") fills no slot.
  // Slots, not photos: four photos of one dish fill one slot (§5.4).
  const filled = new Set(
    matched
      .filter(({ photo }) => {
        const state = sendStates.get(photo.key)
        return state !== "refused" && state !== "sent"
      })
      .map(({ slot }) => slot.id)
  ).size
  return (
    <section
      className="grid grid-cols-[minmax(0,1fr)] gap-4 px-3 pt-3"
      data-slot="match-summary"
      aria-live="polite"
    >
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="type-page-title text-ink tabular-nums outline-none"
      >
        {filled > 0 ? MATCH_COPY.filled(filled) : MATCH_COPY.noneFilled}
      </h3>
      <p
        className="flex items-center gap-1 text-label [overflow-wrap:anywhere] text-ink-muted"
        data-slot="match-summary-venue"
      >
        <MapPinSimpleIcon aria-hidden className="size-4 shrink-0" />
        {venueName
          ? MATCH_COPY.summaryVenue(venueName, added)
          : MATCH_COPY.summaryPhotos(added)}
      </p>
      {/* With one photo per slot the rows below already name each one. */}
      {[...chips.values()].some((chip) => chip.n > 1) ? (
        <ul className="flex flex-wrap gap-2" data-slot="match-summary-chips">
          {[...chips].map(([id, chip]) => (
            <li
              key={id}
              className="rounded-round bg-surface-2 px-3 py-1.5 text-label [overflow-wrap:anywhere] text-ink"
            >
              {MATCH_COPY.slotChip(chip.name, chip.n)}
            </li>
          ))}
        </ul>
      ) : null}
      {matched.length > 0 ? (
        <>
          <p className="text-body text-ink">{MATCH_COPY.next}</p>
          <ul className="grid gap-2">
            {matched.map(({ photo, slot }) => {
              const state = sendStates.get(photo.key) ?? null
              return (
                <li
                  key={photo.key}
                  className="flex min-h-15 items-center gap-3 rounded-card bg-surface px-2 py-1.5 edge"
                  data-state={state ?? "sending"}
                >
                  <span
                    className={cn(
                      "relative size-12 shrink-0 overflow-hidden rounded-control bg-media-placeholder",
                      state === "waiting" && "slot-ring-waiting"
                    )}
                  >
                    <Thumb file={photo.file} />
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span className="text-label [overflow-wrap:anywhere]">
                      {slot.name}
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1 font-mono text-mono font-semibold",
                        state === "failed" || state === "unfinished"
                          ? "text-warn-fg"
                          : "text-ink-muted"
                      )}
                    >
                      <StateIcon state={state} />
                      {stateWord(state)}
                      {duplicates?.has(photo.key)
                        ? ` · ${MATCH_COPY.duplicateWord}`
                        : null}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
      {unsure > 0 ? (
        <p className="text-body text-ink" data-slot="match-summary-unsure">
          {MATCH_COPY.unsureLine(unsure)}
        </p>
      ) : null}
      {later > 0 ? (
        <p className="text-body text-ink">{MATCH_COPY.laterLine(later)}</p>
      ) : null}
      {shared > 0 ? (
        <p className="text-body text-ink">{MATCH_COPY.sharedLine(shared)}</p>
      ) : null}
      {failed > 0 ? (
        <Notice tone="negative" role="alert">
          {MATCH_COPY.failedLine(failed)}
        </Notice>
      ) : null}
      {unfinished > 0 ? (
        <Notice tone="negative" role="alert">
          {MATCH_COPY.unfinishedLine(unfinished)}
        </Notice>
      ) : null}
      {refused > 0 ? (
        <Notice tone="negative" role="alert">
          {MATCH_COPY.refusedLine(refused)}
        </Notice>
      ) : null}
      <LinkButton
        href={ALBUM_HREF}
        variant="primary"
        size="lg"
        className="min-h-16 w-full"
        onClick={onClose}
      >
        <ImagesIcon data-icon="inline-start" aria-hidden />
        {MATCH_COPY.seeAlbum}
      </LinkButton>
    </section>
  )
}
