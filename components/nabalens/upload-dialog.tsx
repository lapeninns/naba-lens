"use client"

import * as React from "react"
import {
  ArrowClockwiseIcon,
  CheckIcon,
  FileIcon,
  FilmStripIcon,
  HourglassIcon,
  ImageIcon,
  PlusIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react"
import type { Icon } from "@phosphor-icons/react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import type {
  ContributionGroupMember,
  ContributionGroupView,
} from "@/lib/knowledge/contract"
import { guardBeforeUnload } from "@/lib/upload/before-unload"
import { forgetCapture } from "@/lib/upload/capture-session"
import { unconfirmedMessage } from "@/lib/upload/uploader"
import { cn } from "@/lib/utils"

import { Notice } from "./notice"
import { PhotoSourceActions, photoInputProps } from "./photo-source"
import { ENTRY_COPY } from "./shell/entry-copy"
import { useLeaveGuard } from "./shell/leave-guard"
import {
  SignInAgainSheet,
  useSessionGuard,
  useSignedInAgain,
} from "./session-guard"
import { useClaimSignIn } from "./session-guard-host"
import type { UploadLimits } from "./types"
import {
  LABELS_LOST,
  LABELS_NOT_SAVED,
  useUploadLabels,
  type LabelView,
  type UploadLabels,
} from "./upload-label-drafts"
import {
  guessMediaKind,
  type QueueItem,
  type QueuePause,
  type QueueSummary,
  type RejectedFile,
  SessionExpiredError,
  SIGNED_OUT_MESSAGE,
  STALLED_PROCESSING_MS,
  STILL_PROCESSING_MS,
  type Uploader,
  type UploadPurpose,
} from "./upload-queue"
import { useStillWaiting } from "./use-still-waiting"
import { useObjectUrl, useUploadQueue } from "./use-upload-queue"

type UploadDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Injected transfer function; the page wires it to the real upload routes. */
  uploader: Uploader
  /** Pass MEDIA_LIMITS from lib/config/media.ts. */
  limits: UploadLimits
  /** Called when files became ready (not while signed out), with how many. */
  onUploaded?: (count: number) => void
  /**
   * Called once per file as soon as THAT file is ready (only files whose
   * uploader reported an asset ID): one asset ID and its picked File, so an
   * owner can tell its own. A slow file never holds back the others. Return
   * false when the screen that picked it is gone: the file stays listed as
   * saved but not added there, until the person has seen it.
   */
  onReady?: (assetIds: string[], files: File[]) => boolean | void
  /**
   * Optional labels in the sheet ("What's in these photos?"): sent by asset
   * ID as soon as each file is reserved, and on the photo once it is ready.
   */
  labels?: UploadLabels
  /**
   * Start uploading as soon as files are picked (Add). Default false: the
   * person taps "Upload N files" (screens with their own dialog).
   */
  startOnPick?: boolean
  /**
   * Closing while files upload hides the queue and lets them carry on (the
   * owner stays mounted; Add shows the queue again). Default false: closing
   * is refused until the run ends or is cancelled.
   */
  keepRunningWhenClosed?: boolean
  /**
   * Counts unfinished uploads, files whose labels are still saving, and files
   * that need the person (failed, or labels refused).
   */
  onBusyChange?: (busy: UploadBusy) => void
  /** Offer the camera-capture input as an enhancement. Default true. */
  allowCamera?: boolean
  /**
   * Accept photos only; videos are rejected with a reason. Default false. It
   * applies to files added while it is set, so a shared queue can take photos
   * for a task screen and videos from Me.
   */
  imagesOnly?: boolean
  /**
   * Files already picked elsewhere (the Add sheet or Add's own picker). Each
   * new array is queued once while the dialog is open.
   */
  initialFiles?: File[]
  /** Called when files are picked, here or as `initialFiles` (not on cancel). */
  onPick?: (files: File[]) => void
  /**
   * Why these files are uploaded. "amenity" keeps them out of the
   * organisation community (amenity evidence). Default "general".
   */
  purpose?: UploadPurpose
  /** Each file's purpose when one queue holds both (Add). Default `purpose`. */
  purposeOf?: (file: File) => UploadPurpose
  /**
   * The server assets this queue holds and has not finished (reserved, not
   * yet saved), whenever they change: any other upload of the person's that
   * the server still has uploading has stopped.
   */
  onHoldsChange?: (assetIds: string[]) => void
  /**
   * Called once per file that ends without becoming ready, and why: it
   * failed, was cancelled, or was removed (or cleared) from the queue.
   */
  onUnfinished?: (file: File, reason: UploadUnfinishedReason) => void
  /** Called once per file when the server has reserved it, with its asset ID. */
  onReserved?: (file: File, assetId: string) => void
  /**
   * The set a file was picked into (several photos of one subject, B02-05),
   * or null: a set whose files have all ended gets one notice, with a line
   * for each file that didn't finish.
   */
  setOf?: (file: File) => PhotoSetRef | null
  /** The footer's "Add more", when the next pick joins a set. */
  addMoreLabel?: string
  /**
   * B05-01e: the server's view of a settled set, which its notice is worded
   * from. Null: the set has no group or the read failed, so the notice is
   * worded from this queue, as before.
   */
  readSet?: (setId: string) => Promise<ContributionGroupView | null>
  /**
   * B05-01e with OD-B5-01-9: a set member this tab doesn't hold, worded from
   * this device's capture journal (what finalise said); null: "Didn't
   * finish".
   */
  memberLine?: (assetId: string) => string | null
  /**
   * B05-01d: Replace beside Retry, on a photo of a set that the server has
   * as failed or removed.
   */
  replace?: SetReplace
  /** Once per file the server could not process (failed there for good). */
  onServerFailed?: (file: File, assetId: string) => void
  /**
   * Shown above the pickers while no file is queued (B05-05, J2: Add's
   * uploads that didn't finish in an earlier tab, and the probe line).
   */
  idle?: React.ReactNode
}

/** Where a replacement asked for from a row stands. */
export type ReplaceState =
  | { kind: "pending"; with: string }
  | { kind: "replaced" }
  /** The same photo was picked again: it resumes, nothing is replaced. */
  | { kind: "same" }
  /** `at`: when it was refused (ms), so only a later read offers it again. */
  | { kind: "refused"; message: string; at: number }

export type SetReplace = {
  /** `file` was picked to replace `item`'s photo in its set. */
  start: (item: QueueItem, file: File) => void
  /**
   * The replacement `file` won't be reserved after all (not added, removed,
   * failed for good, or the queue was cleared): the old row is as it was.
   */
  abandon: (file: File) => void
  stateOf: (item: QueueItem) => ReplaceState | null
}

/** A set of files picked together, and the subject its notice names. */
export type PhotoSetRef = { id: string; subject: string }

export type SetNotice = { id: string; text: string; unfinished: string[] }

/** How long a set read that failed waits before it is asked once more. */
export const SET_READ_AGAIN_MS = 3_000
/** After a photo's stoppedAt, how long before its set is read again. */
export const STOPPED_MARGIN_MS = 5_000

/** The server's read of a settled set: undefined while it is on its way. */
export type SetRead = (
  setId: string
) => ContributionGroupView | null | undefined

const SAVED_STATES = ["ready", "processing"]
const ACTIVE_STATUSES = ["selected", "queued", "uploading", "processing"]

/**
 * B05-01e: a set's notice from the server's read. Members replaced by
 * another are left out; `{n}` counts members ready or processing; each other
 * member gets a line, with what this tab's row says when it still holds the
 * file, otherwise "Didn't finish". Undefined: the read can't word it (a
 * member without its state), so the queue's notice is used.
 */
export function serverSetNotice(
  id: string,
  subject: string,
  view: ContributionGroupView,
  lineOf: (assetId: string) => string | null
): SetNotice | null | undefined {
  const replaced = new Set(
    view.members.flatMap((m) => (m.replacesAssetId ? [m.replacesAssetId] : []))
  )
  const members: ContributionGroupMember[] = view.members.filter(
    (m) => !replaced.has(m.assetId)
  )
  if (members.some((m) => !m.technical)) return undefined
  const saved = members.filter((m) => SAVED_STATES.includes(m.technical!))
  if (saved.length === 0) return null
  return {
    id,
    text: ENTRY_COPY.setSaved(saved.length, subject),
    unfinished: members
      .filter((m) => !SAVED_STATES.includes(m.technical!))
      .map((m) => lineOf(m.assetId) ?? ENTRY_COPY.setDidntFinish),
  }
}

/**
 * One notice per set of two or more files once none is still saving: how
 * many were saved, then each file that didn't finish with what its row says.
 * A set with nothing saved has no notice; its rows say why. With `server`,
 * the notice is the server's (B05-01e): none while its read is on its way,
 * and this queue's only when the read failed. `skip`: rows that are no
 * longer the set's (replaced by another photo).
 */
export function setNotices(
  items: readonly QueueItem[],
  setOf: (file: File) => PhotoSetRef | null,
  detailOf: (item: QueueItem) => string | null,
  options: {
    server?: SetRead
    skip?: (item: QueueItem) => boolean
    /** Rows still waiting on something (a replacement): not settled yet. */
    busy?: (item: QueueItem) => boolean
    /** A member no row here holds: this device's journal line, if any. */
    memberLine?: (assetId: string) => string | null
  } = {}
): SetNotice[] {
  const sets = new Map<string, { subject: string; items: QueueItem[] }>()
  for (const item of items) {
    if (options.skip?.(item)) continue
    const set = setOf(item.file)
    if (!set) continue
    const entry = sets.get(set.id) ?? { subject: set.subject, items: [] }
    entry.items.push(item)
    sets.set(set.id, entry)
  }
  const notices: SetNotice[] = []
  for (const [id, set] of sets) {
    if (
      set.items.some(
        (item) => ACTIVE_STATUSES.includes(item.status) || options.busy?.(item)
      )
    )
      continue
    const lineOf = (item: QueueItem) => {
      const detail = detailOf(item)
      return detail ? `${item.file.name}: ${detail}` : item.file.name
    }
    if (options.server) {
      const view = options.server(id)
      if (view === undefined) continue
      if (view) {
        const notice = serverSetNotice(id, set.subject, view, (assetId) => {
          const held = items.find((item) => item.assetId === assetId)
          return held ? lineOf(held) : (options.memberLine?.(assetId) ?? null)
        })
        if (notice) {
          // Rows of the set that never became members (refused or failed
          // before the server reserved them, or not joined): the server
          // doesn't know them, this tab does.
          const members = new Set(view.members.map((m) => m.assetId))
          for (const item of set.items)
            if (
              item.status !== "done" &&
              (!item.assetId || !members.has(item.assetId))
            )
              notice.unfinished.push(lineOf(item))
          notices.push(notice)
        }
        // The server's read words the set, even with one row in this tab.
        if (notice !== undefined) continue
      }
    }
    if (set.items.length < 2) continue
    const saved = set.items.filter((item) => item.status === "done").length
    if (saved === 0) continue
    notices.push({
      id,
      text: ENTRY_COPY.setSaved(saved, set.subject),
      unfinished: set.items
        .filter((item) => item.status !== "done")
        .map(lineOf),
    })
  }
  return notices
}

/** Why a queued file never became ready. */
export type UploadUnfinishedReason = "failed" | "cancelled" | "removed"

export type UploadBusy = {
  active: number
  failed: number
  stopped: number
  /** Files whose labels are not on the photo yet (and need nobody). */
  labels?: number
  /** Files whose labels the server refused or could not take. */
  attention?: number
}

/** The row's one state word (C5). */
type RowWord = "Saved" | "Saving…" | "Needs attention"

const WORD_LOOK: Record<RowWord, { icon: Icon; tone: string }> = {
  Saved: { icon: CheckIcon, tone: "text-ok-fg" },
  "Saving…": { icon: HourglassIcon, tone: "text-ink" },
  "Needs attention": { icon: WarningCircleIcon, tone: "text-warn-fg" },
}

/** "Saving 3 photos"; files when a video is among them. */
function sheetTitle(items: readonly QueueItem[]) {
  const n = items.length
  const noun = items.every((i) => i.kind === "image")
    ? n === 1
      ? "photo"
      : "photos"
    : n === 1
      ? "file"
      : "files"
  return `Saving ${n} ${noun}`
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

export const STILL_PROCESSING =
  "Still processing; this can take up to 2 minutes; you can leave this screen."
export const STILL_SAVING_LABELS = "Still saving; keep this page open."

/**
 * True once `ms` have passed since `since` (null: not started). Timed from
 * the queue's own clock, so a row shown again later is already past it.
 */
function useAfter(since: number | null, ms: number) {
  const [passed, setPassed] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (since === null) return
    const timer = window.setTimeout(
      () => setPassed(since),
      Math.max(0, since + ms - Date.now())
    )
    return () => window.clearTimeout(timer)
  }, [since, ms])
  return since !== null && passed === since
}

/**
 * The footer of a screen's own dialog (no labels): what is uploaded, then what
 * is still going on. Offline, running files are "waiting"; after a sign-out,
 * unfinished ones are "stopped".
 */
function legacyStatus(summary: QueueSummary, pause: QueuePause) {
  const running =
    summary.active === 0
      ? null
      : pause === "offline" || (pause && summary.active === summary.waiting)
        ? `${summary.active} waiting`
        : `${summary.active} in progress`
  return [
    `${summary.done} uploaded`,
    running,
    summary.failed ? `${summary.failed} failed` : null,
    summary.stopped ? `${summary.stopped} stopped` : null,
    summary.cancelled ? `${summary.cancelled} cancelled` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/**
 * A file saved after the screen that picked it closed (C4 onReady false): a
 * task screen's photo is in the portfolio, a check's evidence is not.
 */
export function notAddedText(purpose: UploadPurpose) {
  return purpose === "amenity"
    ? "Saved. Not added to the check: its screen was closed."
    : "Saved to your portfolio. Not added to the task: its screen was closed."
}

/** "This file can't be used: {reason}." */
function cannotUse(reason: string | null) {
  const why = (reason ?? "it could not be processed").replace(/[.\s]+$/, "")
  return `This file can't be used: ${why}.`
}

type RowState = {
  word: RowWord | null
  /** After the word on the same line ("· Onion Bhaji · …"). */
  suffix: string | null
  detail: string | null
}

function rowState(
  item: QueueItem,
  labels: LabelView,
  pause: QueuePause,
  notAdded: string | null = null
): RowState {
  const percent = Math.round(item.progress * 100)
  switch (item.status) {
    case "selected":
      return { word: null, suffix: null, detail: "Ready to upload" }
    case "queued":
      return {
        word: "Saving…",
        suffix: null,
        detail: pause === "offline" ? "Waiting for a signal" : "Waiting",
      }
    case "uploading":
      return { word: "Saving…", suffix: null, detail: `Uploading ${percent}%` }
    case "processing":
      return { word: "Saving…", suffix: null, detail: "Processing" }
    case "cancelled":
      return { word: "Needs attention", suffix: null, detail: "Cancelled" }
    case "failed":
      return {
        word: "Needs attention",
        suffix: null,
        detail: item.stopped
          ? item.error
          : item.retryable === false && !item.refused
            ? cannotUse(item.error)
            : item.error,
      }
    case "done":
      break
  }
  switch (labels.kind) {
    case "none":
      return {
        word: "Saved",
        suffix: null,
        detail: notAdded,
      }
    case "saved":
      return {
        word: "Saved",
        // Only a photo with a food or drinks dish goes to a manager: videos
        // and other sections never enter review, so they keep their dish
        // names without the promise.
        suffix:
          labels.names.length === 0
            ? null
            : item.kind === "image" && labels.review
              ? `${labels.names.join(", ")} · waiting for manager review`
              : labels.names.join(", "),
        detail: null,
      }
    case "retry":
      return {
        word: "Needs attention",
        suffix: null,
        detail: labels.signedOut ? SIGNED_OUT_MESSAGE : LABELS_NOT_SAVED,
      }
    case "attention":
      return { word: "Needs attention", suffix: null, detail: labels.message }
    default:
      return { word: "Saving…", suffix: null, detail: "Saving labels" }
  }
}

/** Icon for a file that was not added, from its reason. */
function rejectedIcon(file: RejectedFile): Icon {
  const kind = guessMediaKind({ name: file.name, type: "" } as File)
  return kind === "video"
    ? FilmStripIcon
    : kind === "image"
      ? ImageIcon
      : FileIcon
}

function mb(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

function FileThumb({ item }: { item: QueueItem }) {
  const url = useObjectUrl(item.kind === "image" ? item.file : null)
  const [failed, setFailed] = React.useState(false)
  const Icon = item.kind === "video" ? FilmStripIcon : ImageIcon
  return (
    <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-control bg-media-placeholder text-ink-muted">
      {url && !failed ? (
        // Local object URL preview; HEIC and similar fall back to the icon.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon className="size-6" aria-hidden />
      )}
    </span>
  )
}

function QueueRow({
  item,
  state,
  labels,
  onRemove,
  onCancel,
  onRetry,
  onRetryLabels,
  onFixLabels,
  onReplace,
  replaceState,
}: {
  item: QueueItem
  state: RowState
  labels: LabelView
  onRemove: () => void
  onCancel: () => void
  onRetry: () => void
  onRetryLabels: () => void
  onFixLabels: () => void
  /** B05-01d: offered when the server will take a replacement. */
  onReplace?: () => void
  replaceState?: ReplaceState | null
}) {
  const percent = Math.round(item.progress * 100)
  const statusId = `${item.id}-status`
  const look = state.word ? WORD_LOOK[state.word] : null
  const StatusIcon = look?.icon
  // Slow is said: a long finalise, then Retry once the server would take
  // its claim over; a label save with no answer yet.
  const processingSince =
    item.status === "processing" ? (item.processingAt ?? null) : null
  const processingLong = useAfter(processingSince, STILL_PROCESSING_MS)
  const processingStalled = useAfter(processingSince, STALLED_PROCESSING_MS)
  const labelsSlow = useStillWaiting(
    item.status === "done" && labels.kind === "saving"
  )
  const replaceNote =
    replaceState?.kind === "pending"
      ? ENTRY_COPY.replacing(replaceState.with)
      : replaceState?.kind === "same"
        ? ENTRY_COPY.replaceSame
        : replaceState?.kind === "refused"
          ? replaceState.message
          : null
  const detail = replaceNote
    ? replaceNote
    : processingStalled
      ? unconfirmedMessage(item.kind)
      : processingLong
        ? STILL_PROCESSING
        : labelsSlow
          ? STILL_SAVING_LABELS
          : state.detail
  const replacing = replaceState?.kind === "pending"
  const retryable =
    !replacing &&
    ((item.status === "failed" && item.retryable !== false) ||
      item.status === "cancelled" ||
      processingStalled)
  const removable =
    item.status === "selected" ||
    item.status === "failed" ||
    item.status === "cancelled"
  return (
    <li
      data-row-id={item.id}
      className="flex min-w-0 flex-wrap items-center gap-3 rounded-card bg-surface p-3 shadow-card"
      aria-describedby={statusId}
    >
      <FileThumb item={item} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p
          title={item.file.name}
          className="line-clamp-2 text-label [overflow-wrap:anywhere] text-ink"
        >
          {item.file.name}
        </p>
        <p
          id={statusId}
          // Takes focus when the action pressed in this row goes away.
          tabIndex={-1}
          className={cn(
            "font-mono text-meta-strong [overflow-wrap:anywhere] tabular-nums outline-none",
            look?.tone ?? "text-ink-muted"
          )}
        >
          {StatusIcon ? (
            <StatusIcon
              aria-hidden
              weight="bold"
              className="me-1.5 inline size-[18px] -translate-y-px align-middle"
            />
          ) : null}
          {[state.word, state.suffix].filter(Boolean).join(" · ")}
        </p>
        {detail ? (
          <p className="text-body [overflow-wrap:anywhere] text-ink-muted">
            {detail}
          </p>
        ) : null}
        {item.status === "uploading" || item.status === "processing" ? (
          <Progress
            value={item.status === "processing" ? null : percent}
            // The value carries the percentage; a name that changed with it
            // would be read twice and keep changing.
            aria-label={item.file.name}
            tone="neutral"
            className="mt-1.5"
          />
        ) : null}
        {labels.kind === "lost" ? (
          <p className="text-body text-ink-muted">
            <span className="text-ink">Labels: </span>
            {LABELS_LOST}
          </p>
        ) : null}
        {labels.kind === "retry" && item.status === "done" ? (
          <Button
            variant="row-link"
            size="touch"
            className="justify-self-start"
            onClick={onRetryLabels}
            aria-label={`Retry labels for ${item.file.name}`}
          >
            Retry labels
          </Button>
        ) : labels.kind === "attention" && item.status === "done" ? (
          <Button
            variant="row-link"
            size="touch"
            className="justify-self-start"
            onClick={onFixLabels}
            aria-label={`Fix labels for ${item.file.name}`}
          >
            Fix labels
          </Button>
        ) : null}
      </div>
      <div
        className={cn(
          "flex shrink-0 items-center gap-1",
          // Below 400 px two actions leave the name a sliver: own line.
          (retryable || onReplace) &&
            "max-[25rem]:basis-full max-[25rem]:justify-end"
        )}
      >
        {item.status === "queued" || item.status === "uploading" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            aria-label={`Cancel ${item.file.name}`}
          >
            Cancel
          </Button>
        ) : null}
        {retryable ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRetry}
            aria-label={`Retry ${item.file.name}`}
          >
            <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
            Retry
          </Button>
        ) : null}
        {onReplace && !replacing ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onReplace}
            aria-label={ENTRY_COPY.replaceLabel(item.file.name)}
          >
            {ENTRY_COPY.replace}
          </Button>
        ) : null}
        {removable ? (
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={onRemove}
            aria-label={`Remove ${item.file.name}`}
          >
            <XIcon aria-hidden />
          </Button>
        ) : null}
      </div>
    </li>
  )
}

export function UploadDialog({
  open,
  onOpenChange,
  uploader,
  limits,
  onUploaded,
  onReady,
  labels: labelsConfig,
  startOnPick = false,
  keepRunningWhenClosed = false,
  onBusyChange,
  allowCamera = true,
  imagesOnly = false,
  initialFiles,
  onPick,
  purpose = "general",
  purposeOf,
  onHoldsChange,
  onUnfinished,
  onReserved,
  setOf,
  addMoreLabel = "Add more",
  readSet,
  memberLine,
  replace,
  onServerFailed,
  idle,
}: UploadDialogProps) {
  const guard = useSessionGuard()
  const isSignedIn = guard?.isSignedIn
  // Check the session before each attempt and after a failure, so an ended
  // session stops the file (and pauses the rest) instead of failing it with a
  // transport error.
  const upload = React.useMemo<Uploader>(() => {
    const send: Uploader =
      purpose === "general"
        ? uploader
        : (file, context) => uploader(file, { ...context, purpose })
    if (!isSignedIn) return send
    return async (file, context) => {
      if (!(await isSignedIn())) throw new SessionExpiredError()
      try {
        return await send(file, context)
      } catch (error) {
        if (
          !context.signal.aborted &&
          !(error instanceof SessionExpiredError) &&
          !(await isSignedIn())
        )
          throw new SessionExpiredError()
        throw error
      }
    }
  }, [uploader, isSignedIn, purpose])
  const queue = useUploadQueue({ upload, limits })
  const { items, summary, isActive, pause } = queue
  const labels = useUploadLabels(items, labelsConfig, pause !== null, open)
  const views = new Map(items.map((item) => [item.id, labels.view(item)]))
  const viewOf = (item: QueueItem) => views.get(item.id) ?? { kind: "none" }
  const unstoredLabels = items.filter((item) => labels.unstored(item)).length
  const savingLabels = items.filter(
    (item) => viewOf(item).kind === "saving"
  ).length
  const labelTrouble = items.filter((item) => {
    const kind = viewOf(item).kind
    return item.status === "done" && (kind === "retry" || kind === "attention")
  }).length

  const [panelPending, setPanelPending] = React.useState(false)
  // Labels changed in the field that the sheet does not hold yet (chosen
  // while the menu loads, or a choice not finished) are lost on leaving too.
  const unsavedLabels = Math.max(unstoredLabels, panelPending ? 1 : 0)

  // Processing files finish on the server whether the person stays or not.
  const processing = items.filter((i) => i.status === "processing").length
  useLeaveGuard(
    summary.active - processing,
    queue.cancelAll,
    unsavedLabels,
    processing
  )

  const holds = items
    .filter((i) => i.assetId && i.status !== "done")
    .map((i) => i.assetId!)
    .join(" ")
  React.useEffect(() => {
    onHoldsChange?.(holds ? holds.split(" ") : [])
  }, [holds, onHoldsChange])
  // Each file once, as soon as the server has reserved it.
  const reservedSeen = React.useRef(new Set<string>())
  React.useEffect(() => {
    if (!onReserved) return
    for (const item of items) {
      if (!item.assetId || reservedSeen.current.has(item.id)) continue
      reservedSeen.current.add(item.id)
      onReserved(item.file, item.assetId)
    }
  }, [items, onReserved])
  const unstoredRef = React.useRef(unsavedLabels)
  React.useEffect(() => {
    unstoredRef.current = unsavedLabels
  })
  // Reload or tab close would lose labels the server does not have yet.
  React.useEffect(() => guardBeforeUnload(() => unstoredRef.current > 0), [])

  // Files saved after the screen that picked them closed: id -> seen.
  const [unattached, setUnattached] = React.useState<
    ReadonlyMap<string, boolean>
  >(new Map())
  const unseen = [...unattached.values()].filter((seen) => !seen).length
  // Set as soon as a file is found unattached, before `unseen` catches up a
  // render later: the hidden queue must not clear it in between.
  const unseenComing = React.useRef(false)
  React.useEffect(() => {
    if (unseen > 0) unseenComing.current = false
  }, [unseen])
  React.useEffect(() => {
    if (!open || unseen === 0) return
    // Shown now: once seen, Done may clear them.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnattached(
      (current) => new Map([...current.keys()].map((id) => [id, true]))
    )
  }, [open, unseen])

  const { active, failed, stopped } = summary
  const busyLabels = items.filter(
    (item) => item.status === "done" && viewOf(item).kind === "saving"
  ).length
  const needsPerson = labelTrouble + unseen
  React.useEffect(() => {
    onBusyChange?.({
      active,
      failed,
      stopped,
      ...(busyLabels ? { labels: busyLabels } : {}),
      ...(needsPerson ? { attention: needsPerson } : {}),
    })
  }, [active, failed, stopped, busyLabels, needsPerson, onBusyChange])
  const signedOut = pause === "signed-out"
  // A label save refused because the session ended, even with every upload
  // finished (so the queue itself is not paused).
  const needsSignIn = signedOut || labels.signedOut
  const [signInOpen, setSignInOpen] = React.useState(false)

  // Show E7 over the queue when the session ends; it stays reachable from
  // "Sign in again" after "Not now".
  const wasSignedOut = React.useRef(false)
  React.useEffect(() => {
    if (needsSignIn && !wasSignedOut.current && guard) {
      // Opening the sheet follows the queue's external state.
      setSignInOpen(true)
      if (!open) onOpenChange(true)
    }
    wasSignedOut.current = needsSignIn
  }, [needsSignIn, guard, open, onOpenChange])

  const { resume } = queue
  function signedInAgain() {
    setSignInOpen(false)
    if (signedOut) resume()
    labels.retrySignedOut()
  }
  useSignedInAgain(needsSignIn, isSignedIn, signedInAgain)
  // Only while its own Sign in again shows: after "Not now", or with the sheet
  // closed, an action refused for the ended session opens the page's.
  useClaimSignIn(signInOpen && open && !!guard)
  const [rejected, setRejected] = React.useState<RejectedFile[]>([])
  const [closeBlocked, setCloseBlocked] = React.useState(false)
  const [fixing, setFixing] = React.useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)
  // A new panel (fresh from each file's labels) after "Fix labels" saved.
  const [panelKey, setPanelKey] = React.useState(0)
  const [discards, setDiscards] = React.useState(0)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const cameraInput = React.useRef<HTMLInputElement>(null)
  const limitsId = React.useId()
  const listRef = React.useRef<HTMLUListElement>(null)
  const titleRef = React.useRef<HTMLHeadingElement>(null)
  // The row whose first action (or status, after Fix labels) takes focus on
  // the next render or when the sheet shows again.
  const focusRow = React.useRef<string | null>(null)
  const statusAfterFix = React.useRef<string | null>(null)
  React.useEffect(() => {
    const id = focusRow.current
    if (!id) return
    focusRow.current = null
    const row = rowOf(id)
    ;(row?.querySelector("button") ?? row)?.focus()
  })

  function rowOf(id: string) {
    return Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-row-id]") ?? []
    ).find((row) => row.dataset.rowId === id)
  }

  /** The row is about to go: focus the next row's first action, or the title. */
  function focusPast(id: string) {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-row-id]") ?? []
    )
    const at = rows.findIndex((row) => row.dataset.rowId === id)
    const next = at < 0 ? undefined : (rows[at + 1] ?? rows[at - 1])
    ;(next?.querySelector("button") ?? titleRef.current)?.focus()
  }

  /** The pressed action goes away but the row stays: focus its status. */
  function focusStatus(id: string) {
    document.getElementById(`${id}-status`)?.focus()
  }

  // Report each file as soon as it is ready; a slow video holds back nothing.
  const reported = React.useRef(new Set<string>())
  React.useEffect(() => {
    // A refresh while signed out would send the page to /login; wait.
    if (signedOut) return
    const fresh = items.filter(
      (i) => i.status === "done" && !reported.current.has(i.id)
    )
    if (fresh.length === 0) return
    for (const item of fresh) reported.current.add(item.id)
    onUploaded?.(fresh.length)
    if (!onReady) return
    const gone = fresh.filter(
      (item) => item.assetId && onReady([item.assetId], [item.file]) === false
    )
    if (gone.length === 0) return
    // The screen that picked them closed: keep them listed until seen.
    unseenComing.current = true
    setUnattached((current) => {
      const next = new Map(current)
      for (const item of gone) next.set(item.id, false)
      return next
    })
  }, [signedOut, items, onUploaded, onReady])

  // Each file that ends without becoming ready, once, and why.
  const ended = React.useRef(new Set<string>())
  const unfinished = React.useCallback(
    (item: QueueItem, reason: UploadUnfinishedReason) => {
      if (item.status === "done" || ended.current.has(item.id)) return
      ended.current.add(item.id)
      onUnfinished?.(item.file, reason)
    },
    [onUnfinished]
  )
  React.useEffect(() => {
    for (const item of items)
      if (item.status === "failed" || item.status === "cancelled")
        unfinished(item, item.status)
      // Retried: a later failure is told again.
      else if (ACTIVE_STATUSES.includes(item.status))
        ended.current.delete(item.id)
  }, [items, unfinished])

  // B05-01e: each settled set read from the server, by what it settled as.
  const [setReads, setSetReads] = React.useState<
    ReadonlyMap<
      string,
      { signature: string; view: ContributionGroupView | null; at: number }
    >
  >(new Map())
  const asked = React.useRef(new Map<string, string>())
  // The 3 s re-read of each set, by the signature it was for: cleared when
  // the set changes (a row retried or gone) or on unmount.
  const again = React.useRef(
    new Map<string, { signature: string; timer: number }>()
  )
  React.useEffect(() => {
    const timers = again.current
    return () => {
      for (const { timer } of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])
  // S15: a set is read again when one of its photos becomes stopped on the
  // server; each wake makes a new signature, so a new read.
  const [wakes, setWakes] = React.useState<ReadonlyMap<string, number>>(
    new Map()
  )
  const wake = React.useCallback(
    (id: string) =>
      setWakes((current) =>
        new Map(current).set(id, (current.get(id) ?? 0) + 1)
      ),
    []
  )
  const setSignatures = new Map<
    string,
    { signature: string; settled: boolean }
  >()
  if (setOf && readSet)
    for (const item of items) {
      const set = setOf(item.file)
      if (!set) continue
      const entry = setSignatures.get(set.id) ?? {
        signature: `#${wakes.get(set.id) ?? 0};`,
        settled: true,
      }
      entry.signature += `${item.id}:${item.status}:${
        replace?.stateOf(item)?.kind ?? ""
      };`
      if (
        ACTIVE_STATUSES.includes(item.status) ||
        replace?.stateOf(item)?.kind === "pending"
      )
        entry.settled = false
      setSignatures.set(set.id, entry)
    }
  const settledSets = [...setSignatures]
    .filter(([, entry]) => entry.settled)
    .map(([id, entry]) => `${id}=${entry.signature}`)
    .join("|")
  const allSets = [...setSignatures]
    .map(([id, entry]) => `${id}=${entry.signature}`)
    .join("|")
  React.useEffect(() => {
    const now = new Map(
      allSets
        ? allSets.split("|").map((pair) => {
            const at = pair.indexOf("=")
            return [pair.slice(0, at), pair.slice(at + 1)] as const
          })
        : []
    )
    for (const [id, entry] of again.current)
      if (now.get(id) !== entry.signature) {
        window.clearTimeout(entry.timer)
        again.current.delete(id)
      }
  }, [allSets])
  React.useEffect(() => {
    if (!readSet || !settledSets) return
    for (const pair of settledSets.split("|")) {
      const at = pair.indexOf("=")
      const id = pair.slice(0, at)
      const signature = pair.slice(at + 1)
      if (asked.current.get(id) === signature) continue
      asked.current.set(id, signature)
      window.clearTimeout(again.current.get(id)?.timer)
      again.current.delete(id)
      // A read that failed is asked once more a little later; meanwhile,
      // and if that fails too, the queue words the set.
      const ask = (retry: boolean) =>
        void readSet(id)
          .catch(() => null)
          .then((view) => {
            if (asked.current.get(id) !== signature) return
            setSetReads((current) =>
              new Map(current).set(id, { signature, view, at: Date.now() })
            )
            if (!view && retry)
              again.current.set(id, {
                signature,
                timer: window.setTimeout(() => {
                  again.current.delete(id)
                  ask(false)
                }, SET_READ_AGAIN_MS),
              })
          })
      ask(true)
    }
  }, [readSet, settledSets])
  const serverRead: SetRead = (id) => {
    const entry = setReads.get(id)
    const now = setSignatures.get(id)
    return entry && now && entry.signature === now.signature
      ? entry.view
      : undefined
  }
  // S15: when to read each set again: the earliest stoppedAt of a member
  // still uploading on the server, not yet stopped, whose row didn't finish
  // here (failed, stopped or cancelled). A timer fires then (with a margin);
  // coming back to the page past it reads at once.
  const wakeAts: string[] = []
  for (const [id, now] of setSignatures) {
    const entry = setReads.get(id)
    if (!entry?.view || entry.signature !== now.signature) continue
    const replaced = new Set(
      entry.view.members.flatMap((m) =>
        m.replacesAssetId ? [m.replacesAssetId] : []
      )
    )
    let at = Infinity
    for (const m of entry.view.members) {
      if (m.technical !== "uploading" || m.stopped || !m.stoppedAt) continue
      if (replaced.has(m.assetId)) continue
      const row = items.find((i) => i.assetId === m.assetId)
      if (!row || (row.status !== "failed" && row.status !== "cancelled"))
        continue
      const when = Date.parse(m.stoppedAt)
      if (Number.isFinite(when)) at = Math.min(at, when)
    }
    // A read taken after stoppedAt that still says not stopped (this clock
    // is ahead of the server's): try again a minute after it, not at once.
    if (Number.isFinite(at))
      wakeAts.push(`${id}@${at > entry.at ? at : entry.at + 60_000}`)
  }
  const wakeKey = wakeAts.join("|")
  React.useEffect(() => {
    if (!wakeKey) return
    const due = wakeKey.split("|").map((pair) => {
      const at = pair.lastIndexOf("@")
      return { id: pair.slice(0, at), at: Number(pair.slice(at + 1)) }
    })
    const timers = due.map(({ id, at }) =>
      window.setTimeout(
        () => wake(id),
        Math.min(2 ** 31 - 1, Math.max(0, at - Date.now()) + STOPPED_MARGIN_MS)
      )
    )
    const back = () => {
      if (document.visibilityState === "hidden") return
      for (const { id, at } of due) if (at <= Date.now()) wake(id)
    }
    document.addEventListener("visibilitychange", back)
    window.addEventListener("focus", back)
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", back)
      window.removeEventListener("focus", back)
    }
  }, [wakeKey, wake])
  /** The latest read of a row's set, settled or not. */
  const readOf = (item: QueueItem) => {
    const set = setOf?.(item.file)
    return set ? setReads.get(set.id) : undefined
  }
  const memberOf = (item: QueueItem) => {
    const view = readOf(item)?.view
    if (!view || !item.assetId) return null
    const replaced = view.members.some(
      (m) => m.replacesAssetId === item.assetId
    )
    const member = view.members.find((m) => m.assetId === item.assetId)
    return member && !replaced ? member : null
  }
  // B05-01d: Replace where the server will take it: a member it has as
  // failed, removed or stopped, not replaced yet, on a row that didn't
  // finish here (failed or stopped in this tab, or cancelled). After a
  // refusal, only a read taken since may offer it again.
  const canReplace = (item: QueueItem) => {
    if (!replace) return false
    if (item.status !== "failed" && item.status !== "cancelled") return false
    const state = replace.stateOf(item)
    if (state && state.kind !== "refused") return false
    if (state?.kind === "refused" && !((readOf(item)?.at ?? 0) > state.at))
      return false
    const member = memberOf(item)
    return (
      member?.technical === "failed" ||
      member?.technical === "removed" ||
      member?.stopped === true
    )
  }
  const replaceInput = React.useRef<HTMLInputElement>(null)
  const replaceTarget = React.useRef<string | null>(null)
  // Replacement files picked here -> the row each replaces.
  const replacementOf = React.useRef(new Map<File, string>())
  const abandonReplacement = (file: File) => {
    if (!replacementOf.current.delete(file)) return
    replace?.abandon(file)
  }
  function pickReplacement(item: QueueItem) {
    replaceTarget.current = item.id
    replaceInput.current?.click()
  }
  function replacementPicked(input: HTMLInputElement) {
    const file = input.files?.[0]
    const target = items.find((item) => item.id === replaceTarget.current)
    replaceTarget.current = null
    input.value = ""
    if (!file || !target || !replace) return
    replace.start(target, file)
    replacementOf.current.set(file, target.id)
    focusStatus(target.id)
    // Not taken (too large, empty, the batch is full): the card above says
    // why, and the old row is as it was.
    if (addFiles([file], null) === 0) abandonReplacement(file)
  }
  // A replacement that failed for good before its swap ends it; one that
  // can be retried keeps it, so its retry still swaps in.
  React.useEffect(() => {
    for (const item of items)
      if (
        replacementOf.current.has(item.file) &&
        item.status === "failed" &&
        item.retryable === false
      )
        abandonReplacement(item.file)
    // abandonReplacement only reads refs and the replace prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])
  // A replaced row is no longer the set's: it leaves the list.
  const replacedRows = items
    .filter((item) => replace?.stateOf(item)?.kind === "replaced")
    .map((item) => item.id)
    .join(" ")
  React.useEffect(() => {
    if (!replacedRows) return
    for (const id of replacedRows.split(" ")) {
      const item = items.find((i) => i.id === id)
      if (!item) continue
      // Focus in the row, or already dropped, goes to the replacement's row.
      const replacement = items.find(
        (i) => replacementOf.current.get(i.file) === id
      )
      const active = document.activeElement
      const row = rowOf(id)
      if (
        replacement &&
        (!active ||
          active === document.body ||
          active === replaceInput.current ||
          row?.contains(active))
      )
        focusRow.current = replacement.id
      else if (row?.contains(active)) focusPast(id)
      if (replacement) replacementOf.current.delete(replacement.file)
      remove(item)
    }
    // remove only touches the queue and this component's refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replacedRows])
  // Each file the server could not process, once.
  const serverFailedSeen = React.useRef(new Set<string>())
  React.useEffect(() => {
    if (!onServerFailed) return
    for (const item of items) {
      if (
        item.status !== "failed" ||
        item.retryable !== false ||
        item.refused ||
        !item.assetId ||
        serverFailedSeen.current.has(item.id)
      )
        continue
      serverFailedSeen.current.add(item.id)
      onServerFailed(item.file, item.assetId)
    }
  }, [items, onServerFailed])

  const queuedInitial = React.useRef<File[] | null>(null)
  React.useEffect(() => {
    if (!open || !initialFiles?.length) return
    if (queuedInitial.current === initialFiles) return
    queuedInitial.current = initialFiles
    addFiles(initialFiles, null)
  })

  /** Queues picked files; returns how many the queue took. */
  function addFiles(
    list: FileList | File[] | null,
    input: HTMLInputElement | null
  ): number {
    if (!list || list.length === 0) return 0
    const files = Array.from(list)
    onPick?.(files)
    const notPhotos: RejectedFile[] = []
    const accepted = imagesOnly
      ? files.filter((file) => {
          const kind = guessMediaKind(file)
          if (kind === "image") return true
          notPhotos.push({
            name: file.name,
            reason:
              kind === "video"
                ? "Only photos can be added here. Upload videos from your portfolio."
                : "This file type is not supported. Use JPEG, PNG, WebP or HEIC.",
          })
          return false
        })
      : files
    const result = queue.add(accepted)
    setRejected([...notPhotos, ...result.rejected])
    setCloseBlocked(false)
    if (startOnPick && result.added > 0) queue.start()
    // Allow picking the same file again after removing it.
    if (input) input.value = ""
    return result.added
  }

  function remove(item: QueueItem) {
    abandonReplacement(item.file)
    // Removed here: its capture journal entry goes (OD-B5-05-7).
    if (item.status !== "done") forgetCapture(item.file)
    unfinished(item, "removed")
    labels.discard(item)
    reported.current.delete(item.id)
    queue.remove(item.id)
  }

  const forget = (ids: Iterable<string>) =>
    setUnattached((current) => {
      const next = new Map(current)
      for (const id of ids) next.delete(id)
      return next
    })

  /** Nothing left for anyone to do: every file is saved with its labels. */
  const finished = items.every(
    (item) =>
      item.status === "done" && ["none", "saved"].includes(viewOf(item).kind)
  )

  function clearQueue() {
    for (const file of [...replacementOf.current.keys()])
      abandonReplacement(file)
    for (const item of items)
      if (item.status !== "done") forgetCapture(item.file)
    for (const item of items) unfinished(item, "removed")
    ended.current.clear()
    reservedSeen.current.clear()
    queue.reset()
    labels.reset()
    reported.current.clear()
    forget([...unattached.keys()])
    setRejected([])
    setCloseBlocked(false)
    setPanelPending(false)
  }

  function handleOpenChange(next: boolean) {
    if (!next && panelPending && !confirmDiscard) {
      setConfirmDiscard(true)
      return
    }
    if (!next && keepRunningWhenClosed && !finished) {
      // Done is always available: whatever is still saving carries on.
      setRejected([])
      onOpenChange(false)
      return
    }
    if (!next && isActive) {
      setCloseBlocked(true)
      return
    }
    if (!next) clearQueue()
    onOpenChange(next)
  }

  // Hidden and all saved: clear the queue, so Add starts afresh.
  const settledHidden =
    !open && startOnPick && keepRunningWhenClosed && items.length > 0
  React.useEffect(() => {
    if (!settledHidden || !finished || unseen > 0 || unseenComing.current)
      return
    // The queue (an external store) finished while hidden.
    clearQueue()
    // clearQueue only touches the queue and this component's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledHidden, finished, unseen])

  const started = items.some((i) => i.status !== "selected")
  const settled = started && !isActive && summary.selected === 0
  const retryableFailed = items.filter(
    (i) => i.status === "failed" && !i.stopped && i.retryable !== false
  ).length
  const fixItem = fixing ? items.find((i) => i.id === fixing) : undefined
  const fix = fixItem ? labels.fixDraft(fixItem) : null
  const labelItems = labels.labelable
  const disabledIds = labelItems
    .filter((i) => i.status === "failed" && i.retryable === false)
    .map((i) => i.id)

  const saved = items.filter(
    (i) => i.status === "done" && ["none", "saved"].includes(viewOf(i).kind)
  ).length
  const notices = setOf
    ? setNotices(
        items,
        setOf,
        (item) => rowState(item, viewOf(item), pause).detail,
        {
          ...(readSet ? { server: serverRead } : {}),
          skip: (item) => replace?.stateOf(item)?.kind === "replaced",
          busy: (item) => replace?.stateOf(item)?.kind === "pending",
          ...(memberLine ? { memberLine } : {}),
        }
      )
    : []
  const attention = items.filter(
    (i) =>
      i.status === "failed" ||
      i.status === "cancelled" ||
      (i.status === "done" && ["retry", "attention"].includes(viewOf(i).kind))
  ).length
  const saving = items.length - saved - attention - summary.selected
  const status = !started
    ? summary.selected > 0
      ? `${summary.selected} ready · up to ${limits.maxBatchFiles} at a time`
      : null
    : !startOnPick
      ? legacyStatus(summary, pause)
      : [
          `${saved} saved`,
          saving > 0
            ? pause === "offline"
              ? `${saving} waiting`
              : `${saving} saving`
            : null,
          attention > 0 ? `${attention} need attention` : null,
        ]
          .filter(Boolean)
          .join(" · ")

  const uploadDialog = (
    <Dialog open={open && fixing === null} onOpenChange={handleOpenChange}>
      <DialogContent
        className="md:max-w-lg"
        initialFocus={() => {
          const id = statusAfterFix.current
          statusAfterFix.current = null
          return (id && document.getElementById(`${id}-status`)) || true
        }}
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
            {startOnPick && items.length > 0
              ? sheetTitle(items)
              : imagesOnly
                ? "Upload photos"
                : "Upload photos or videos"}
          </DialogTitle>
          <DialogDescription id={limitsId}>
            {imagesOnly ? (
              <>
                Up to {limits.maxBatchFiles} photos at a time, each up to{" "}
                {mb(limits.maxPhotoBytes)} (JPEG, PNG, WebP, HEIC).
              </>
            ) : (
              <>
                Up to {limits.maxBatchFiles} files at a time. Photos up to{" "}
                {mb(limits.maxPhotoBytes)} (JPEG, PNG, WebP, HEIC), videos up to{" "}
                {mb(limits.maxVideoBytes)} (MP4, MOV, WebM).
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {items.length === 0 && idle ? idle : null}
        <div className={cn(items.length > 0 && startOnPick && "hidden")}>
          <PhotoSourceActions
            layout="row"
            // One blue button per screen: once files are queued, the footer
            // action is the primary and choosing more goes grey.
            libraryVariant={items.length > 0 ? "secondary" : "primary"}
            describedBy={limitsId}
            onChoose={(source) =>
              (source === "library" ? fileInput : cameraInput).current?.click()
            }
            cameraHidden={!allowCamera}
          />
          <input
            ref={fileInput}
            {...photoInputProps("library", { imagesOnly })}
            className="sr-only"
            tabIndex={-1}
            aria-label={
              imagesOnly ? "Choose photos" : "Choose photos or videos"
            }
            onChange={(e) => addFiles(e.currentTarget.files, e.currentTarget)}
          />
          {allowCamera ? (
            <input
              ref={cameraInput}
              {...photoInputProps("camera", { imagesOnly })}
              className="sr-only"
              tabIndex={-1}
              aria-label={imagesOnly ? "Take a photo" : "Take a photo or video"}
              onChange={(e) => addFiles(e.currentTarget.files, e.currentTarget)}
            />
          ) : null}
        </div>

        {rejected.length > 0 ? (
          // A warn card: what wasn't added, then each file with its reason.
          <div
            role="alert"
            className="grid gap-2 rounded-card bg-surface p-3 ps-4 shadow-[var(--elevation-card),inset_4px_0_0_var(--warn-fg)]"
          >
            <p className="flex items-center gap-2 font-display text-section-title text-ink">
              <WarningCircleIcon
                aria-hidden
                weight="bold"
                className="size-6 shrink-0 text-warn-fg"
              />
              {rejected.length === 1
                ? "1 file was not added"
                : `${rejected.length} files were not added`}
            </p>
            <ul className="grid list-none divide-y divide-line rounded-card border border-line">
              {rejected.map((r, i) => {
                const FileKind = rejectedIcon(r)
                return (
                  <li
                    key={`${r.name}-${i}`}
                    className="flex min-w-0 items-start gap-3 p-3"
                  >
                    <span
                      aria-hidden
                      className="grid size-11 shrink-0 place-items-center rounded-round bg-warn-bg text-warn-fg"
                    >
                      <FileKind className="size-5" />
                    </span>
                    <span className="min-w-0 text-body [overflow-wrap:anywhere] text-ink-muted">
                      <span className="block text-label text-ink">
                        {r.name}
                        <span className="sr-only">:</span>
                      </span>{" "}
                      {r.reason}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        {signedOut ? (
          <Notice tone="negative" title="You were signed out">
            Nothing is sent twice. We&apos;ll email you a sign-in link and code
            and keep this page.
          </Notice>
        ) : pause === "offline" && isActive ? (
          <Notice tone="attention" role="status">
            Waiting for a signal. Keep this page open; nothing is sent twice.
          </Notice>
        ) : !pause && isActive ? (
          <Notice>
            {keepRunningWhenClosed
              ? "You can leave this screen. We'll finish in the background while this page stays open."
              : "Keep this page open while files upload."}
          </Notice>
        ) : null}

        {items.length > 0 ? (
          // Each file as a white row on the grey canvas (Common Room queue).
          <ul
            ref={listRef}
            aria-label="Files"
            className="-mx-1 grid gap-2 rounded-card bg-bg p-1.5"
          >
            {items.map((item) => {
              const view = viewOf(item)
              return (
                <QueueRow
                  key={item.id}
                  item={item}
                  state={rowState(
                    item,
                    view,
                    pause,
                    unattached.has(item.id)
                      ? notAddedText(purposeOf?.(item.file) ?? purpose)
                      : null
                  )}
                  labels={view}
                  onRemove={() => {
                    focusPast(item.id)
                    forget([item.id])
                    remove(item)
                  }}
                  onCancel={() => {
                    // Started on pick: a cancelled file just leaves the list;
                    // otherwise it stays, with Retry in place of Cancel.
                    if (startOnPick) focusPast(item.id)
                    else focusRow.current = item.id
                    unfinished(item, "cancelled")
                    queue.cancel(item.id)
                    if (startOnPick) remove(item)
                  }}
                  onRetry={() => {
                    focusStatus(item.id)
                    queue.retry(item.id)
                  }}
                  onRetryLabels={() => {
                    focusStatus(item.id)
                    labels.retry(item.id)
                  }}
                  onFixLabels={() => {
                    statusAfterFix.current = item.id
                    setFixing(item.id)
                  }}
                  onReplace={
                    canReplace(item) ? () => pickReplacement(item) : undefined
                  }
                  replaceState={replace?.stateOf(item) ?? null}
                />
              )
            })}
          </ul>
        ) : null}

        {labelsConfig && labelItems.length > 0 ? (
          <React.Fragment key={`${panelKey}-${labels.version}`}>
            {labelsConfig.renderPanel({
              items: labelItems,
              initial: labels.initial,
              disabledIds,
              settledIds: labels.settledIds,
              onChange: labels.change,
              onPendingChange: setPanelPending,
              discards,
            })}
          </React.Fragment>
        ) : null}

        <div aria-live="polite" className="grid gap-1 text-body">
          {closeBlocked && isActive ? (
            <p className="flex items-start gap-2 font-semibold text-warn-fg">
              <WarningCircleIcon
                aria-hidden
                className="mt-0.5 size-5 shrink-0"
              />
              <span>
                Uploads are still running. Keep this open, or cancel them first.
              </span>
            </p>
          ) : null}
          {savingLabels > 0 ? (
            <p className="text-ink-muted">
              {plural(savingLabels, "photo", "photos")} still saving labels
            </p>
          ) : null}
          {/* Replacement outcomes, said once (the row shows them too). */}
          {items.map((item) => {
            const state = replace?.stateOf(item)
            const said =
              state?.kind === "refused"
                ? state.message
                : state?.kind === "same"
                  ? ENTRY_COPY.replaceSame
                  : null
            return said ? (
              <p key={`replace-${item.id}`} className="sr-only">
                {`${item.file.name}: ${said}`}
              </p>
            ) : null
          })}
          {notices.map((notice) => (
            <div key={notice.id} className="grid gap-1">
              <p className="text-ink">{notice.text}</p>
              {notice.unfinished.length > 0 ? (
                <ul className="grid gap-0.5 [overflow-wrap:anywhere] text-ink-muted">
                  {notice.unfinished.map((line, i) => (
                    <li key={`${notice.id}-${i}`}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>

        {/* Sticky, as in the label editor: on phones the actions stay in
            reach below long rows and the labels panel. */}
        <DialogFooter className="sticky bottom-0 mx-0 mb-0 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] md:mx-0 md:mb-0 md:pb-4">
          {items.length > 0 && status ? (
            <p
              role="status"
              className="font-mono text-meta-strong text-ink-muted tabular-nums md:mr-auto md:self-center"
            >
              {status}
            </p>
          ) : null}
          {needsSignIn ? (
            guard ? (
              <Button
                variant="secondary"
                size="touch"
                onClick={() => setSignInOpen(true)}
              >
                Sign in again
              </Button>
            ) : (
              <a
                href="/login"
                target="_blank"
                rel="noopener"
                className={buttonVariants({
                  variant: "secondary",
                  size: "touch",
                })}
              >
                Sign in again
              </a>
            )
          ) : null}
          {summary.selected > 0 ? (
            <>
              <Button
                variant="secondary"
                size="touch"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                size="touch"
                onClick={() => {
                  setRejected([])
                  queue.start()
                }}
              >
                <UploadSimpleIcon data-icon="inline-start" aria-hidden />
                Upload {summary.selected}{" "}
                {summary.selected === 1 ? "file" : "files"}
              </Button>
            </>
          ) : (
            <>
              {isActive && !keepRunningWhenClosed ? (
                <Button
                  variant="secondary"
                  size="touch"
                  onClick={queue.cancelAll}
                >
                  Cancel all
                </Button>
              ) : null}
              {items.length > 0 ? (
                <Button
                  variant="secondary"
                  size="touch"
                  onClick={() => fileInput.current?.click()}
                >
                  <PlusIcon data-icon="inline-start" aria-hidden />
                  {addMoreLabel}
                </Button>
              ) : null}
              {!startOnPick && settled && retryableFailed > 0 ? (
                <Button
                  variant="secondary"
                  size="touch"
                  onClick={queue.retryFailed}
                >
                  <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
                  Retry {retryableFailed} failed
                </Button>
              ) : null}
              <Button size="touch" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </>
          )}
        </DialogFooter>
        <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard these labels?</AlertDialogTitle>
              <AlertDialogDescription className="text-ink">
                Uploads carry on; only these labels are discarded.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button
                variant="outline"
                size="touch"
                onClick={() => {
                  setPanelPending(false)
                  setConfirmDiscard(false)
                  setPanelKey((key) => key + 1)
                  setDiscards((n) => n + 1)
                  if (keepRunningWhenClosed && !finished) onOpenChange(false)
                  else if (!isActive) {
                    clearQueue()
                    onOpenChange(false)
                  }
                }}
              >
                Discard labels
              </Button>
              <AlertDialogCancel variant="primary" size="touch">
                Keep labelling
              </AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {replace ? (
          <input
            ref={replaceInput}
            {...photoInputProps("library", { imagesOnly })}
            multiple={false}
            data-replace-input=""
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose a photo to replace it"
            onChange={(e) => replacementPicked(e.currentTarget)}
          />
        ) : null}
        {guard ? (
          <SignInAgainSheet
            open={signInOpen}
            onOpenChange={setSignInOpen}
            guard={guard}
            done={summary.done}
            stopped={summary.stopped}
            onSignedIn={signedInAgain}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )

  return (
    <>
      {uploadDialog}
      {labelsConfig && fixItem && fix && fixItem.assetId
        ? labelsConfig.renderFix({
            item: fixItem,
            assetId: fixItem.assetId,
            draft: fix.draft,
            labels: fix.labels,
            problem: fix.problem,
            onClose: () => setFixing(null),
            onSave: async (input) => {
              const result = await labels.fix(fixItem, input)
              if (result.ok) {
                setPanelKey((key) => key + 1)
                setFixing(null)
              }
              return result
            },
          })
        : null}
    </>
  )
}
