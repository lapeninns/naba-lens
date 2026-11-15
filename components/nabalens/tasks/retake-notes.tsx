"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CameraPlusIcon,
  CheckCircleIcon,
  ImagesIcon,
} from "@phosphor-icons/react/dist/ssr"

import { LeadCard } from "@/components/nabalens/common-room/card"
import { Notice } from "@/components/nabalens/notice"
import { CountBadge, StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import type {
  CoverageResult,
  RetakeNote,
  RetakeNoteRef,
} from "@/lib/server/coverage/types"

import { useAdd, type OpenAddOptions } from "../shell/add-context"
import { formatDate } from "../format"
import { RETAKE_COPY } from "./copy"
import { replacementPath } from "./needs-another-photo-list"
import {
  homeRetakeNotes,
  meRetakeNotes,
  retakeNoteKey,
  retakeNoteTitle,
} from "./retake-notes-model"

// One retake note block (G-3, docs/plans/goals-not-tasks.md, decisions 4, 12
// and 14). Menu notes reshoot with the dish already labelled; coverage
// requests reshoot through their send page. The database decides each note's
// status (my_retake_notes); this only draws it.

const refOf = (note: RetakeNote): RetakeNoteRef => ({
  kind: note.kind,
  noteId: note.noteId,
})

type OnLater = (
  ref: RetakeNoteRef
) => Promise<CoverageResult<{ setAsideAt: string; replayed: boolean }>>

function Thumb({ note }: { note: RetakeNote }) {
  return (
    <span className="relative block aspect-square w-full overflow-hidden rounded-control bg-media-placeholder">
      {note.thumbnailUrl ? (
        // Signed private URLs never go through next/image (see MediaTile).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={note.thumbnailUrl}
          alt={`Your photo: ${retakeNoteTitle(note)}`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </span>
  )
}

function Reason({ note }: { note: RetakeNote }) {
  return (
    <>
      <p className="text-body font-bold break-words whitespace-pre-line text-ink">
        <span className="sr-only">Reason: </span>
        {note.reason?.trim() || RETAKE_COPY.noReason}
      </p>
      <p className="text-meta text-ink-muted">
        {note.askedBy ? `${note.askedBy} · ` : null}
        Asked {formatDate(note.askedAt)}
      </p>
    </>
  )
}

/**
 * Reshoot: the camera with the dish already labelled (menu), or the send
 * page for the request (coverage). Null when nothing can be sent now.
 */
function ReshootAction({
  note,
  variant,
  openAdd,
  tasksPath,
  source = "camera",
  describedBy,
  blocked,
}: {
  note: RetakeNote
  variant: "primary" | "secondary" | "quiet"
  /** Uploads are paused for this account: no Reshoot of either kind. */
  blocked: boolean
  /** Null while uploads are paused or outside the staff layout. */
  openAdd: ((opts?: OpenAddOptions) => void) | null
  tasksPath: string
  source?: "camera" | "library"
  describedBy?: string
}) {
  const title = retakeNoteTitle(note)
  const label =
    note.status === "retaken"
      ? RETAKE_COPY.again
      : source === "library"
        ? RETAKE_COPY.choose
        : RETAKE_COPY.reshoot
  const icon =
    source === "library" ? (
      <ImagesIcon data-icon="inline-start" aria-hidden />
    ) : (
      <CameraPlusIcon data-icon="inline-start" aria-hidden />
    )
  if (!note.canRetake) return null
  if (note.kind === "coverage") {
    // The send page answers the request; paused uploads offer nothing.
    if (source === "library" || blocked) return null
    return (
      <Link
        href={replacementPath(
          tasksPath,
          note.requirement?.id ?? null,
          note.noteId
        )}
        aria-label={`${label}: ${title}`}
        aria-describedby={describedBy}
        className={buttonVariants({ variant })}
      >
        {icon}
        {label}
      </Link>
    )
  }
  const dish = note.dish
  if (!openAdd || !dish) return null
  return (
    <Button
      variant={variant}
      aria-label={`${label}: ${title}`}
      aria-describedby={describedBy}
      // openAdd clicks the camera input inside this click handler.
      onClick={() => openAdd({ source, imagesOnly: true, preset: { ...dish } })}
    >
      {icon}
      {label}
    </Button>
  )
}

function LaterButton({
  note,
  onLater,
  describedBy,
}: {
  note: RetakeNote
  onLater: (note: RetakeNote) => void
  describedBy?: string
}) {
  return (
    <Button
      variant="quiet"
      aria-label={`${RETAKE_COPY.later}: ${retakeNoteTitle(note)}`}
      aria-describedby={describedBy}
      onClick={() => onLater(note)}
    >
      {RETAKE_COPY.later}
    </Button>
  )
}

/** Home: the first note as the lead card (Reshoot is the one blue action). */
function HomeNotes({
  notes,
  openAdd,
  tasksPath,
  onLater,
  blocked,
}: {
  notes: RetakeNote[]
  openAdd: ((opts?: OpenAddOptions) => void) | null
  tasksPath: string
  onLater: (note: RetakeNote) => void
  blocked: boolean
}) {
  const [lead, ...rest] = notes
  const leadId = React.useId()
  if (!lead) return null
  return (
    <div className="grid gap-gutter">
      <LeadCard
        tone="warn"
        aria-labelledby={leadId}
        kicker={RETAKE_COPY.heading}
        chip={<StatusChip state="needs_another_photo" />}
        title={retakeNoteTitle(lead)}
        titleId={leadId}
        media={<Thumb note={lead} />}
        actions={
          // Grey left, blue right (DESIGN.md §5a); stacked, blue last.
          <div className="flex flex-wrap gap-2 *:flex-auto sm:justify-end sm:*:flex-none">
            <LaterButton note={lead} onLater={onLater} describedBy={leadId} />
            <ReshootAction
              note={lead}
              variant="primary"
              openAdd={openAdd}
              tasksPath={tasksPath}
              blocked={blocked}
              describedBy={leadId}
            />
          </div>
        }
      >
        <Reason note={lead} />
      </LeadCard>
      {rest.length > 0 ? (
        <ul
          aria-label={`${RETAKE_COPY.heading}: ${rest.length} more`}
          className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
        >
          {rest.map((note) => (
            <NoteRow
              key={retakeNoteKey(note)}
              note={note}
              openAdd={openAdd}
              tasksPath={tasksPath}
              blocked={blocked}
              onLater={onLater}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** One note as a row: Home's further notes, and every note on Me. */
function NoteRow({
  note,
  openAdd,
  tasksPath,
  onLater,
  library = false,
  blocked,
}: {
  note: RetakeNote
  openAdd: ((opts?: OpenAddOptions) => void) | null
  tasksPath: string
  onLater?: (note: RetakeNote) => void
  library?: boolean
  blocked: boolean
}) {
  const nameId = React.useId()
  const status =
    !note.canRetake && note.status !== "retaken"
      ? note.kind === "menu"
        ? RETAKE_COPY.offMenu
        : RETAKE_COPY.closed
      : null
  const reshoot = (
    <ReshootAction
      note={note}
      variant={note.status === "retaken" ? "quiet" : "secondary"}
      openAdd={openAdd}
      tasksPath={tasksPath}
      blocked={blocked}
      describedBy={nameId}
    />
  )
  const choose =
    library && note.status !== "retaken" ? (
      <ReshootAction
        note={note}
        variant="quiet"
        openAdd={openAdd}
        tasksPath={tasksPath}
        blocked={blocked}
        source="library"
        describedBy={nameId}
      />
    ) : null
  const later =
    onLater && note.status === "open" ? (
      <LaterButton note={note} onLater={onLater} describedBy={nameId} />
    ) : null
  return (
    <li>
      <article
        aria-labelledby={nameId}
        data-retake-status={note.status}
        className="grid grid-cols-[4rem_minmax(0,1fr)] gap-3 p-3"
      >
        <Thumb note={note} />
        <div className="grid min-w-0 content-start gap-1">
          <StatusChip state="needs_another_photo" className="w-fit" />
          <h3
            id={nameId}
            className="text-item-title [overflow-wrap:anywhere] text-ink"
          >
            {retakeNoteTitle(note)}
          </h3>
          <Reason note={note} />
          {status ? (
            <p className="text-body [overflow-wrap:anywhere] text-ink">
              {status}
            </p>
          ) : null}
          {note.status === "retaken" ? (
            <p className="flex items-center gap-1.5 text-body text-ink">
              <CheckCircleIcon aria-hidden className="size-5 text-ok-fg" />
              {RETAKE_COPY.sent}
            </p>
          ) : null}
          {note.status === "set_aside" ? (
            <p className="text-body text-ink-muted">{RETAKE_COPY.setAside}</p>
          ) : null}
        </div>
        {note.canRetake && (later || reshoot) ? (
          <div className="col-span-2 flex flex-wrap gap-2 *:flex-auto sm:*:flex-none">
            {later}
            {reshoot}
            {choose}
          </div>
        ) : null}
      </article>
    </li>
  )
}

/**
 * The retake note block. `home`: open notes that can be retaken, the first as
 * the lead card with Reshoot as the one blue action, each with Later. `me`:
 * every note until it clears, set aside or not, with grey actions (Me's blue
 * is Upload). Renders nothing when there is nothing to show.
 */
export function RetakeNotes({
  notes,
  surface,
  tasksPath = "/staff/tasks",
  uploadBlocked = false,
  onLater,
  focusAfterLaterId,
}: {
  notes: readonly RetakeNote[]
  surface: "home" | "me"
  /**
   * S-2: Later hides the button that had focus, so focus moves here (a
   * heading with tabIndex -1). Defaults to this block's own heading on Me.
   */
  focusAfterLaterId?: string
  tasksPath?: string
  /** Uploads are paused for this account: no camera (the reason shows elsewhere). */
  uploadBlocked?: boolean
  /** Later (Home): the setRetakeNoteAsideAction server action. */
  onLater?: OnLater
}) {
  const router = useRouter()
  const add = useAdd()
  const openAdd = uploadBlocked ? null : add
  const [hidden, setHidden] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [failed, setFailed] = React.useState(false)
  const [announced, setAnnounced] = React.useState("")
  const keyOf = retakeNoteKey
  const focusTarget =
    focusAfterLaterId ?? (surface === "me" ? "better-heading" : undefined)

  const later = onLater
    ? (note: RetakeNote) => {
        const key = keyOf(note)
        setFailed(false)
        setHidden((prev) => new Set(prev).add(key))
        setAnnounced(RETAKE_COPY.laterDone)
        // The card (and its Later button) is gone after this render.
        requestAnimationFrame(() => {
          if (focusTarget) document.getElementById(focusTarget)?.focus()
        })
        void onLater(refOf(note))
          .then((result) => {
            if (!result.ok) throw new Error(result.message)
            router.refresh()
          })
          .catch(() => {
            setHidden((prev) => {
              const next = new Set(prev)
              next.delete(key)
              return next
            })
            setAnnounced("")
            setFailed(true)
          })
      }
    : undefined

  const shown = (
    surface === "home" ? homeRetakeNotes(notes) : meRetakeNotes(notes)
  ).filter((note) => !hidden.has(keyOf(note)))

  const failure = failed ? (
    <Notice tone="attention" role="alert">
      {RETAKE_COPY.laterFailed}
    </Notice>
  ) : null
  // One element at one fixed place in the tree (first in the fragment the
  // block always returns), mounted empty, so the text that Later puts in it
  // is announced even when the block's section goes away.
  const live = (
    <p className="sr-only" aria-live="polite" role="status">
      {announced}
    </p>
  )
  return (
    <>
      {live}
      {retakeBlock()}
    </>
  )

  function retakeBlock() {
    if (surface === "home") {
      if (shown.length === 0) return failure
      return (
        <section aria-label={RETAKE_COPY.heading} className="grid gap-gutter">
          {failure}
          <HomeNotes
            notes={shown}
            openAdd={openAdd}
            tasksPath={tasksPath}
            blocked={uploadBlocked}
            onLater={later ?? (() => undefined)}
          />
        </section>
      )
    }

    if (shown.length === 0) return null
    const waiting = shown.filter(
      (note) => note.status !== "retaken" && note.canRetake
    ).length
    return (
      <section aria-labelledby="better-heading" className="grid gap-3 pt-2">
        <div className="grid gap-1 px-1">
          <h2
            id="better-heading"
            tabIndex={-1}
            className="flex items-center gap-2 rounded-control type-section-title text-ink focus-ring outline-none"
          >
            {RETAKE_COPY.heading}
            <CountBadge
              count={waiting}
              label={waiting === 1 ? "photo" : "photos"}
            />
          </h2>
          <p className="text-body text-ink-muted">{RETAKE_COPY.meIntro}</p>
        </div>
        {failure}
        <ul
          aria-label={RETAKE_COPY.listLabel}
          className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
        >
          {shown.map((note) => (
            <NoteRow
              key={keyOf(note)}
              note={note}
              openAdd={openAdd}
              tasksPath={tasksPath}
              blocked={uploadBlocked}
              onLater={later}
              library
            />
          ))}
        </ul>
      </section>
    )
  }
}
