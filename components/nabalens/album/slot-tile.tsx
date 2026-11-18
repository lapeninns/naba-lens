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
import {
  OPTIONAL_SLOT_WORD,
  SLOT_MARK_WORDS,
  type SlotState,
} from "@/lib/album/model"
import { cn } from "@/lib/utils"

/*
 * One slot in a venue's album (DESIGN.md §4, §5), drawn as v2 SubjectCard
 * (D10): a 4:3 photo box, the name under it, then the state mark. A slot is anything that
 * needs a photo: a dish or drink on the active menu, an amenity, an area.
 * Its state is drawn by a frame, an icon and a word, never by colour alone,
 * and no two states share a frame:
 *
 *   needed    dashed edge on paper, + Add            opens the gallery
 *   sending   the photo, Sending 40% / Saved on this phone
 *   waiting   the photo, ring-waiting inset, ↑ Waiting
 *   retake    the photo, ring-retake inset, ↩ Retake
 *   accepted  the photo, a positive mark, ✓ In the album
 *   check-due the photo, ok-half ring, ⟲ Needs checking (FA-11: a manager
 *             confirms it is still right; not counted as filled)
 *   not-here  dotted edge over hatching, Not here
 *
 * `optional` (FA-51: a packaged item without Photo wanted) changes only an
 * empty tile: a plain solid edge-strong line instead of Needed's reserved dashed one,
 * + Add, and the word Optional. With a photo it draws its state as usual.
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
  /** FA-51: an optional slot; an empty one reads Optional, not Needed. */
  optional?: boolean
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

// v2 StatusChip look for the mark under the name (`nl-chip`): a 28px pill,
// caption at 600 with a 16px icon. Album's words (SLOT_MARK_WORDS) stay.
const MARK =
  "inline-flex max-w-full min-h-7 items-center gap-1 rounded-round border border-transparent py-0.5 pr-2.5 pl-2 text-chip [&_svg]:size-4 [&_svg]:shrink-0"

function StateMark({
  state,
  progress,
  offline,
}: Pick<SlotTileProps, "state" | "progress"> & { offline: boolean }) {
  switch (state) {
    case "sending":
      return (
        <span className={cn(MARK, "bg-info-bg font-mono text-info-fg")}>
          {offline ? (
            <CloudArrowUpIcon aria-hidden />
          ) : (
            <ArrowUpIcon aria-hidden weight="bold" />
          )}
          {sendingWord(progress, offline)}
        </span>
      )
    case "waiting":
      return (
        <span className={cn(MARK, "bg-info-bg text-info-fg")}>
          <ArrowUpIcon aria-hidden weight="bold" />
          {SLOT_MARK_WORDS.waiting}
        </span>
      )
    case "retake":
      return (
        <span className={cn(MARK, "bg-warn-bg text-warn-fg")}>
          <ArrowUUpLeftIcon aria-hidden weight="bold" />
          {SLOT_MARK_WORDS.retake}
        </span>
      )
    case "check-due":
      return (
        <span className={cn(MARK, "bg-warn-bg text-warn-fg")}>
          <ClockCounterClockwiseIcon aria-hidden weight="bold" />
          {SLOT_MARK_WORDS["check-due"]}
        </span>
      )
    case "accepted":
      return (
        <span className={cn(MARK, "bg-ok-bg text-ok-fg")}>
          <CheckIcon aria-hidden weight="bold" />
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
  optional = false,
  className,
}: SlotTileProps) {
  const emptyOptional = optional && state === "needed"
  // An offline sending tile shows "Saved on this phone", so its name says so too.
  const label = `${name}: ${
    state === "sending" && offline
      ? "saved on this phone"
      : emptyOptional
        ? OPTIONAL_SLOT_WORD.toLowerCase()
        : STATE_WORDS[state]
  }`
  const hasPhoto = state !== "needed" && state !== "not-here"

  // v2 SubjectCard (`nl-subject`, D10): the whole tile is one target; the
  // 4:3 photo box on top, the name under it, then one state mark.
  const frame = cn(
    "group/slot flex w-full min-w-0 flex-col gap-2 rounded-card text-start text-ink",
    (href || onSelect) && "cursor-pointer focus-ring",
    className
  )

  // The photo box draws the slot's frame (DESIGN.md §4): a dashed edge when
  // needed, a plain edge when optional, dotted over hatching when not here,
  // and the inset rings over a photo.
  const box = cn(
    "relative grid aspect-4/3 w-full place-items-center overflow-hidden rounded-card",
    state === "needed" && !emptyOptional && "slot-needed bg-surface",
    emptyOptional && "bg-surface edge-strong",
    state === "not-here" && "slot-not-here bg-surface text-ink-muted",
    hasPhoto && "bg-media-placeholder"
  )

  const picture: React.ReactNode = hasPhoto ? (
    <>
      {/* A tile with no photo yet (one being prepared) shows the
          placeholder fill alone, not a "photo unavailable" message. */}
      {photoSrc ? (
        <Photo
          src={photoSrc}
          alt=""
          ratio="4/3"
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
    </>
  ) : state === "needed" ? (
    <span className="flex items-center gap-1 text-label text-accent-text">
      <PlusIcon aria-hidden weight="bold" className="size-5" />
      Add
    </span>
  ) : (
    <>
      {/* Hatching on its own layer: cn() would merge bg-hatch away beside
          the bg-surface fill. */}
      <span aria-hidden className="absolute inset-0 bg-hatch" />
      <span className="relative rounded-round bg-surface px-2 text-label">
        Not here
      </span>
    </>
  )

  const body: React.ReactNode = (
    <>
      <span className={box}>{picture}</span>
      <span className="line-clamp-2 text-label [overflow-wrap:anywhere]">
        {name}
      </span>
      {hasPhoto ? (
        <span className="max-w-full min-w-0 self-start">
          <StateMark state={state} progress={progress} offline={offline} />
        </span>
      ) : emptyOptional ? (
        <span className={cn(MARK, "self-start bg-surface-2 text-ink")}>
          {OPTIONAL_SLOT_WORD}
        </span>
      ) : null}
    </>
  )

  if (href)
    return (
      <Link
        href={href}
        aria-label={label}
        data-slot="slot-tile"
        data-state={state}
        data-optional={optional || undefined}
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
        data-optional={optional || undefined}
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
      data-optional={optional || undefined}
      className={frame}
    >
      {body}
    </div>
  )
}

export { SlotTile }
