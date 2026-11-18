import {
  ArrowUUpLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  CloudArrowUpIcon,
  PlusIcon,
} from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"
import type * as React from "react"

import { Photo } from "@/components/ui/photo"
import { SLOT_MARK_WORDS, type SlotState } from "@/lib/album/model"
import { cn } from "@/lib/utils"

/*
 * One slot in a venue's album (DESIGN.md §4, §5). A slot is anything that
 * needs a photo: a dish or drink on the active menu, an amenity, an area.
 * Its state is drawn by a frame, an icon and a word, never by colour alone,
 * and no two states share a frame:
 *
 *   needed    dashed edge on paper, + Add            opens the gallery
 *   sending   the photo, Sending 40% / Saved on this phone
 *   waiting   the photo, ring-waiting inset, ↑ Waiting
 *   retake    the photo, ring-retake inset, ↩ Retake
 *   accepted  the photo, green square mark, ✓ In the album
 *   check-due the photo, ok-waiting ring, ⟲ Needs checking (FA-11: a manager
 *             confirms it is still right; not counted as filled)
 *   not-here  dotted edge over hatching, Not here
 *
 * The whole tile is one target: a link when `href` is given, else a button
 * when `onSelect` is, else plain content. Its accessible name says the slot
 * and its state in words ("Guinness, pint: needed").
 */

export type { SlotState }

type SlotTileProps = {
  /** The slot's name: "Guinness, pint", "Darts board", "Bar counter". */
  name: string
  state: SlotState
  /** The slot's current photo. Ignored for needed and not-here. */
  photoSrc?: string
  /** Upload progress, 0 to 100, while sending. */
  progress?: number
  /** While sending: the photo is held on the phone until the signal returns. */
  offline?: boolean
  /** Where the tile goes: the gallery for a needed slot, else the slot. */
  href?: string
  /** Used when there is no href. */
  onSelect?: () => void
  className?: string
}

const STATE_WORDS: Record<SlotState, string> = {
  needed: "needed",
  sending: "sending",
  waiting: "waiting for review",
  retake: "needs another photo",
  accepted: "in the album",
  "check-due": "needs checking",
  "not-here": "not here",
}

/**
 * The Sending word (DESIGN.md §4: "Sending 40%", Saved on this phone without
 * a signal), shared with Match's rows (X6) so the words live here once.
 */
export function sendingWord(progress: number | undefined, offline = false) {
  if (offline) return "Saved on this phone"
  if (progress === undefined) return "Sending"
  return `Sending ${Math.round(Math.min(100, Math.max(0, progress)))}%`
}

function StateMark({
  state,
  progress,
  offline,
}: Pick<SlotTileProps, "state" | "progress"> & { offline: boolean }) {
  switch (state) {
    case "sending":
      return (
        <span className="inline-flex max-w-full items-start gap-1 rounded-square bg-surface px-1.5 py-0.5 text-caption leading-tight font-bold text-ink tabular-nums">
          {offline ? (
            <CloudArrowUpIcon aria-hidden className="mt-px size-4 shrink-0" />
          ) : null}
          {sendingWord(progress, offline)}
        </span>
      )
    case "waiting":
      return (
        <span className="inline-flex max-w-full items-center gap-0.5 rounded-round bg-surface px-1.5 text-caption leading-tight font-bold text-ink">
          <ArrowUpIcon aria-hidden weight="bold" className="size-4" />
          {SLOT_MARK_WORDS.waiting}
        </span>
      )
    case "retake":
      return (
        <span className="inline-flex max-w-full items-center gap-0.5 rounded-round bg-warn-bg px-1.5 text-caption leading-tight font-bold text-warn-fg">
          <ArrowUUpLeftIcon aria-hidden weight="bold" className="size-4" />
          {SLOT_MARK_WORDS.retake}
        </span>
      )
    case "check-due":
      return (
        <span className="inline-flex max-w-full items-center gap-0.5 rounded-round bg-surface px-1.5 text-caption leading-tight font-bold text-ink">
          <ClockCounterClockwiseIcon
            aria-hidden
            weight="bold"
            className="size-4"
          />
          {SLOT_MARK_WORDS["check-due"]}
        </span>
      )
    case "accepted":
      return (
        <span className="inline-flex max-w-full items-start gap-1 rounded-square bg-ok-fg px-1.5 py-0.5 text-caption leading-tight font-bold text-on-ok">
          <CheckIcon
            aria-hidden
            weight="bold"
            className="mt-px size-4 shrink-0"
          />
          {SLOT_MARK_WORDS.accepted}
        </span>
      )
    default:
      return null
  }
}

function SlotTile({
  name,
  state,
  photoSrc,
  progress,
  offline = false,
  href,
  onSelect,
  className,
}: SlotTileProps) {
  // An offline sending tile shows "Saved on this phone", so its name says so too.
  const label = `${name}: ${
    state === "sending" && offline ? "saved on this phone" : STATE_WORDS[state]
  }`
  const hasPhoto = state !== "needed" && state !== "not-here"

  const frame = cn(
    "group/slot relative flex aspect-square w-full flex-col overflow-hidden rounded-card text-start",
    state === "needed" && "justify-between slot-needed bg-surface p-2 text-ink",
    state === "not-here" &&
      "justify-end slot-not-here bg-surface p-2 text-ink-muted",
    hasPhoto && "bg-media-placeholder",
    (href || onSelect) && "cursor-pointer focus-ring",
    className
  )

  const body: React.ReactNode = hasPhoto ? (
    <>
      {/* A tile with no photo yet (one being prepared) shows the
          placeholder fill alone, not a "photo unavailable" message. */}
      {photoSrc ? (
        <Photo
          src={photoSrc}
          alt=""
          ratio="1/1"
          radius="none"
          className="absolute inset-0"
        />
      ) : null}
      {/* The ring sits over the photo so it reads on any picture. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-card",
          state === "waiting" && "slot-ring-waiting",
          state === "retake" && "slot-ring-retake",
          state === "check-due" && "slot-ring-check"
        )}
      />
      <span className="relative flex h-full min-h-0 flex-col justify-between gap-1 p-1.5">
        <span className="max-w-full min-w-0 self-start">
          <StateMark state={state} progress={progress} offline={offline} />
        </span>
        <span className="line-clamp-2 rounded-square bg-plate px-1.5 py-0.5 text-caption leading-tight font-bold text-on-stage">
          {name}
        </span>
      </span>
    </>
  ) : state === "needed" ? (
    <>
      <span className="flex items-center gap-1 font-bold text-accent-text">
        <PlusIcon aria-hidden weight="bold" className="size-6" />
        Add
      </span>
      <span className="line-clamp-3 text-label leading-tight">{name}</span>
    </>
  ) : (
    <>
      {/* Hatching on its own layer: cn() would merge bg-hatch away beside
          the bg-surface fill. */}
      <span aria-hidden className="absolute inset-0 bg-hatch" />
      <span className="relative text-label">Not here</span>
      <span className="relative line-clamp-2 text-caption leading-tight">
        {name}
      </span>
    </>
  )

  if (href)
    return (
      <Link
        href={href}
        aria-label={label}
        data-slot="slot-tile"
        data-state={state}
        className={frame}
      >
        {body}
      </Link>
    )
  if (onSelect)
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-label={label}
        data-slot="slot-tile"
        data-state={state}
        className={frame}
      >
        {body}
      </button>
    )
  return (
    <div
      role="group"
      aria-label={label}
      data-slot="slot-tile"
      data-state={state}
      className={frame}
    >
      {body}
    </div>
  )
}

export { SlotTile }
