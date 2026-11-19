"use client"

import * as React from "react"
import Link from "next/link"
import { ImagesIcon, MapPinSimpleIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { useOnline } from "@/components/nabalens/offline-notice"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { slotPageHref } from "@/lib/staff/my-uploads"

import { MATCH_COPY as C } from "./copy"
import { MatchPicker } from "./match-picker"
import {
  MatchThumb,
  retryable,
  stateWord,
  type MatchOutcome,
  type MatchPhoto,
  type MatchScreenProps,
  type SendState,
} from "./match-screen"

type Assignment = { outcome: MatchOutcome; note?: string }

function destination(outcome?: MatchOutcome) {
  switch (outcome?.kind) {
    case "slot":
      return { key: outcome.slot.id, name: outcome.slot.name }
    case "unsure":
      return { key: "unsure", name: C.unsureWord }
    case "shared":
      return { key: outcome.shared, name: C.sharedKind(outcome.shared) }
    case "later":
      return { key: "later", name: C.matchLater }
    default:
      return { key: "unmatched", name: C.trayUnmatched }
  }
}

/** A batch presentation of Match, using the same picker and upload queue (DESIGN.md §6.1a). */
export function MatchTray({
  open,
  photos,
  outcomes,
  sendStates,
  progress,
  onRetry,
  board,
  onRetryBoard,
  current,
  last,
  notice,
  busySlots,
  venueName,
  venuesMixed,
  recent,
  duplicates,
  onDecide,
  onClose,
  lockedSlot,
  onAddMore,
}: MatchScreenProps & {
  lockedSlot?: MatchOutcome
  onAddMore?: () => void
}) {
  const [selection, setSelection] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [assignments, setAssignments] = React.useState<
    ReadonlyMap<string, Assignment>
  >(() => new Map())
  const [picking, setPicking] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  const searchRef = React.useRef<HTMLInputElement>(null)
  const titleRef = React.useRef<HTMLHeadingElement>(null)
  const online = useOnline()
  const receipt = photos.length === outcomes.size
  const editable = photos.filter((photo) => !outcomes.has(photo.key))
  const unassigned = editable.filter((photo) => !assignments.has(photo.key))
  const selected = editable.filter((photo) => selection.has(photo.key))
  const allocated = editable.length - unassigned.length
  const groups = new Map<string, { name: string; photos: MatchPhoto[] }>()
  for (const photo of editable) {
    const { key, name } = destination(assignments.get(photo.key)?.outcome)
    const group = groups.get(key) ?? { name, photos: [] }
    group.photos.push(photo)
    groups.set(key, group)
  }
  const title = receipt
    ? lockedSlot?.kind === "slot"
      ? lockedSlot.slot.name
      : C.trayReceipt
    : C.trayTitle
  const target = lockedSlot?.kind === "slot" ? lockedSlot.slot.target : null
  const slotHref = target
    ? slotPageHref({
        kind: target.kind,
        slotId: target.kind === "dish" ? target.itemId : target.subjectId,
      })
    : null
  const taken = new Set([
    ...(busySlots?.keys() ?? []),
    ...[...assignments.values()].flatMap(({ outcome }) =>
      outcome.kind === "slot" ? [outcome.slot.id] : []
    ),
  ])

  const assign = (outcome: MatchOutcome, note?: string) => {
    setAssignments((before) => {
      const next = new Map(before)
      for (const photo of selected) next.set(photo.key, { outcome, note })
      return next
    })
    setAnnouncement(`${selected.length} matched · ${destination(outcome).name}`)
    setSelection(new Set())
    setPicking(false)
  }
  const send = () => {
    for (const photo of editable) {
      const assignment = assignments.get(photo.key)
      onDecide(
        photo.key,
        assignment?.outcome ?? { kind: "later" },
        assignment?.note
      )
    }
    titleRef.current?.focus()
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
        data-slot="match-tray"
        className="grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] bg-canvas"
      >
        <header className="flex flex-wrap items-end justify-between gap-x-2 border-b border-line bg-surface px-4 py-3">
          <div className="grid min-w-0 gap-1">
            <DialogTitle
              ref={titleRef}
              tabIndex={-1}
              className="p-0 [overflow-wrap:anywhere]"
            >
              {title}
            </DialogTitle>
            {!venuesMixed && venueName ? (
              <p className="flex items-center gap-1 text-meta text-ink-muted">
                <MapPinSimpleIcon aria-hidden className="size-4 shrink-0" />
                {C.venueLine(venueName)}
              </p>
            ) : null}
          </div>
          {!receipt ? (
            <div className="ml-auto flex shrink-0 items-center">
              {onAddMore ? (
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  className="min-h-12"
                  onClick={onAddMore}
                >
                  Add more
                </Button>
              ) : null}
              <Button
                type="button"
                variant="quiet"
                size="sm"
                className="min-h-12"
                aria-label={C.closeRest}
                onClick={onClose}
              >
                Close
              </Button>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
          {notice ? (
            <Notice tone="attention" className="mb-4">
              {notice}
            </Notice>
          ) : null}
          {receipt ? (
            <Receipt
              photos={photos}
              outcomes={outcomes}
              states={sendStates}
              progress={progress}
              online={online}
              duplicates={duplicates}
              onRetry={onRetry}
            />
          ) : (
            <div className="grid gap-6">
              {[...groups].map(([key, group]) => (
                <section
                  key={key}
                  aria-label={group.name}
                  className="grid gap-2"
                >
                  <div className="flex min-h-12 items-center justify-between gap-2">
                    <h3 className="text-section-title font-bold [overflow-wrap:anywhere]">
                      {group.name} · {group.photos.length}
                    </h3>
                    {key !== "unmatched" ? (
                      <Button
                        type="button"
                        variant="quiet"
                        className="min-h-12"
                        aria-label={`Change ${group.name}`}
                        onClick={() => {
                          setSelection(
                            new Set(group.photos.map((photo) => photo.key))
                          )
                          setPicking(true)
                        }}
                      >
                        Change
                      </Button>
                    ) : null}
                  </div>
                  <ul className="grid grid-cols-2 gap-3">
                    {group.photos.map((photo) => (
                      <li key={photo.key} className="min-w-0">
                        <label className="relative grid cursor-pointer gap-1 rounded-card border border-line bg-surface p-1.5 focus-ring-within has-checked:border-accent">
                          <span className="aspect-square overflow-hidden rounded-control bg-media-placeholder">
                            <MatchThumb file={photo.file} />
                          </span>
                          <span className="absolute top-1.5 right-1.5 grid size-12 place-items-center rounded-control bg-surface">
                            <input
                              type="checkbox"
                              className="size-5 accent-accent"
                              checked={selection.has(photo.key)}
                              aria-label={photo.file.name}
                              aria-describedby={`${photo.key}-destination`}
                              onChange={(event) => {
                                const checked = event.currentTarget.checked
                                setSelection((before) => {
                                  const next = new Set(before)
                                  if (checked) next.add(photo.key)
                                  else next.delete(photo.key)
                                  return next
                                })
                              }}
                            />
                          </span>
                          <span className="min-w-0 truncate px-1 text-meta">
                            {photo.file.name}
                          </span>
                          <span
                            id={`${photo.key}-destination`}
                            className="sr-only"
                          >
                            {group.name}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <footer className="grid gap-2 border-t border-line bg-surface px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {receipt ? (
            <div className="grid gap-2 sm:flex sm:justify-end">
              {lockedSlot?.kind === "slot" && onAddMore ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-12"
                  onClick={onAddMore}
                >
                  Add more photos
                </Button>
              ) : null}
              {slotHref ? (
                <Link
                  href={slotHref}
                  className={cn(
                    buttonVariants({ variant: "quiet" }),
                    "min-h-12"
                  )}
                  onClick={onClose}
                >
                  View slot
                </Link>
              ) : null}
              <Button
                type="button"
                variant="primary"
                className="min-h-12"
                onClick={onClose}
              >
                Done
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <p role="status" className="text-meta text-ink-muted">
                  {selected.length
                    ? C.traySelected(selected.length)
                    : C.traySelect}
                  <span className="sr-only"> {announcement}</span>
                </p>
                <Button
                  type="button"
                  variant="quiet"
                  className="min-h-12"
                  onClick={() =>
                    setSelection(
                      selected.length
                        ? new Set()
                        : new Set(
                            (unassigned.length ? unassigned : editable).map(
                              (photo) => photo.key
                            )
                          )
                    )
                  }
                >
                  {selected.length
                    ? "Clear"
                    : allocated > 0 && unassigned.length > 0
                      ? "Select all unmatched"
                      : "Select all"}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-12 whitespace-normal"
                  disabled={!selected.length}
                  onClick={() => setPicking(true)}
                >
                  {C.trayChoose}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-12 whitespace-normal"
                  disabled={!selected.length}
                  onClick={() => assign({ kind: "unsure" })}
                >
                  {C.trayAsk}
                </Button>
              </div>
              <Button
                type="button"
                variant="primary"
                className="min-h-13 whitespace-normal"
                disabled={!allocated}
                onClick={send}
              >
                <ImagesIcon aria-hidden />
                {allocated
                  ? C.traySend(allocated, unassigned.length)
                  : "Match photos to send"}
              </Button>
            </>
          )}
        </footer>

        <Dialog open={picking} onOpenChange={setPicking}>
          <DialogContent
            initialFocus={searchRef}
            className="grid gap-4 overflow-y-auto overscroll-contain"
          >
            <DialogTitle>{C.trayChoose}</DialogTitle>
            <MatchPicker
              board={board}
              onRetryBoard={onRetryBoard}
              current={current}
              last={last}
              recent={recent}
              taken={taken}
              traySearchRef={searchRef}
              onMatch={(slot) => assign({ kind: "slot", slot })}
              onShared={(shared) => assign({ kind: "shared", shared })}
              onUnsure={(note) => assign({ kind: "unsure" }, note)}
            />
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

function Receipt({
  photos,
  outcomes,
  states,
  progress,
  online,
  duplicates,
  onRetry,
}: {
  photos: readonly MatchPhoto[]
  outcomes: ReadonlyMap<string, MatchOutcome>
  states: ReadonlyMap<string, SendState>
  progress?: ReadonlyMap<string, number>
  online: boolean
  duplicates?: ReadonlySet<string>
  onRetry?: (key: string) => void
}) {
  const rows = photos.map((photo) => ({
    photo,
    outcome: outcomes.get(photo.key),
    state: states.get(photo.key) ?? "sending",
  }))
  const forReview = rows.filter(
    ({ outcome, state }) =>
      state === "waiting" &&
      (outcome?.kind === "slot" || outcome?.kind === "unsure")
  ).length
  const otherSent =
    rows.filter(({ state }) => state === "waiting" || state === "sent").length -
    forReview
  const sending = rows.filter(
    ({ state }) => state === "sending" || state === "checking"
  ).length
  const failed = rows.filter(
    ({ state }) =>
      retryable(state) || state === "unprocessable" || state === "refused"
  ).length
  const heading = [
    forReview ? C.trayForReview(forReview) : null,
    otherSent ? `${otherSent} saved` : null,
    sending
      ? online
        ? C.traySending(sending)
        : C.savedHeading(sending)
      : null,
    failed === 1
      ? "1 needs attention"
      : failed
        ? `${failed} need attention`
        : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <section data-slot="match-summary" className="grid gap-3">
      <h3 role="status" className="type-section-title text-ink">
        {heading || "No photos sent"}
      </h3>
      <ul className="grid gap-2">
        {rows.map(({ photo, outcome, state }) => {
          const name = destination(outcome).name
          const shown = !online && state === "sending" ? "offline" : state
          const word =
            state === "waiting" &&
            (outcome?.kind === "later" || outcome?.kind === "shared")
              ? "Saved"
              : stateWord(shown, progress?.get(photo.key))
          return (
            <li
              key={photo.key}
              data-state={shown}
              className="flex min-h-16 items-center gap-2 rounded-card border border-line bg-surface p-2"
            >
              <span className="size-12 shrink-0 overflow-hidden rounded-control bg-media-placeholder">
                <MatchThumb file={photo.file} />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-label [overflow-wrap:anywhere]">
                  {name}
                </span>
                <span className="truncate text-meta text-ink-muted">
                  {photo.file.name}
                </span>
                <span
                  className={cn(
                    "text-meta font-semibold",
                    retryable(state) ? "text-warn-fg" : "text-ink"
                  )}
                  data-slot="match-row-state"
                >
                  {word}
                  {duplicates?.has(photo.key) ? ` · ${C.duplicateWord}` : null}
                </span>
              </span>
              {onRetry && retryable(state) ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-12 shrink-0"
                  aria-label={`Retry ${photo.file.name}`}
                  onClick={() => onRetry(photo.key)}
                >
                  {C.retry}
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
