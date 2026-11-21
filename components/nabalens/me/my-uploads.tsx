"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowUUpLeftIcon,
  FilmStripIcon,
  ImageIcon,
  MegaphoneSimpleIcon,
  PencilSimpleIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import {
  MatchPicker,
  type BoardState,
} from "@/components/nabalens/album/match/match-picker"
import type {
  MatchSlot,
  SharedKind,
} from "@/components/nabalens/album/match/model"
import {
  ReportChangeDialog,
  type ReportSender,
} from "@/components/nabalens/album/report-change-dialog"
import { parseMediaRoute, versioned } from "@/app/_media/preview-recovery"
import { Notice } from "@/components/nabalens/notice"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { StatusChip } from "@/components/nabalens/status-chip"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FormField } from "@/components/ui/field"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import { LinkButton } from "@/components/ui/link-button"
import { Textarea } from "@/components/ui/textarea"
import {
  canLabelUpload,
  datesLine,
  groupUploads,
  LABEL_PHOTO,
  labelPhotoHref,
  OUTCOME_CHIP,
  receiptWord,
  slotPageHref,
  unmatched,
  UPLOAD_SECTIONS,
  uploadActions,
  type MyUpload,
  type MyUploadsPage,
  type UploadSection,
} from "@/lib/staff/my-uploads"
import { REPORT_COPY } from "@/lib/staff/slot-reports"

/*
 * My uploads, the first section of Me (FA-1; spec §6 S4; S2-STAFF). Four
 * sections, chosen with pills that show their counts: Needs attention,
 * Sending, Waiting and Reviewed. Each row shows the photo, its slot, the
 * outcome in staff words (FA-7) with the reviewer's reason, the venue it
 * went to when that is not the current one, and when it was sent and taken.
 * Actions follow the state: Retake opens the slot with the reason (AC17),
 * Label photo if it has no slot, Change slot and Withdraw while it waits
 * (FA-21), and Ask for a correction or removal once it has been checked.
 * Every answer is written beside the row (DESIGN.md §6.7: no toasts).
 */

type Reply<T extends object = Record<never, never>> =
  ({ ok: true } & T) | { ok: false; error: string }

export type MyUploadsActions = {
  loadMore: (cursor: {
    before: string
    beforeId: string
  }) => Promise<Reply<{ page: MyUploadsPage }>>
  withdraw: (assetId: string) => Promise<Reply>
  changeSlot: (input: {
    assetId: string
    expectedRevision: number
    target: MatchSlot["target"] | { kind: "shared"; sharedKind: SharedKind }
  }) => Promise<Reply>
  loadBoard: () => Promise<
    | {
        ok: true
        board: import("@/components/nabalens/album/match/model").MatchBoard
      }
    | { ok: false; message: string }
  >
  requestRemoval: (assetId: string, reason: string) => Promise<Reply>
  report: ReportSender
}

export const MY_UPLOADS_COPY = {
  // Album's words (DESIGN.md §7: never "upload"): the spec's My uploads.
  title: "Your photos",
  sections: "Show",
  noUploads:
    "Nothing sent yet. Photos you add from your gallery appear here with what happened to them.",
  readFailed:
    "Your photos couldn't be loaded. Check your connection and reload the page. Photos you sent are safe.",
  loadMore: "Show older photos",
  detailGone: "This photo is no longer listed. It may have been withdrawn.",
  noSlot: "No slot yet",
  labelAtVenue: (venue: string) =>
    `To label this photo, switch to ${venue} first.`,
  // E4: "I'm not sure" sends it to the manager, never to Match later.
  labelHelpHint: "With your manager, who will choose its slot.",
  // V13: Change slot offers the current venue's slots only.
  otherVenueHint: (venue: string) =>
    `To change its slot, switch to ${venue} first.`,
  // F7: the portfolio's words for a preview that failed twice.
  brokenThumbs: (n: number) =>
    n === 1 ? "1 preview could not load." : `${n} previews could not load.`,
  retryThumbs: "Try again",
  shared: (kinds: string[]) =>
    `Shared photo${kinds.length ? ` · ${kinds.map((k) => k[0]!.toUpperCase() + k.slice(1)).join(", ")}` : ""}`,
  sentTo: (venue: string) => `Sent to ${venue}`,
  duplicate: "Already sent before: it doesn't count twice",
  failed: "This photo couldn't be finished. Add it again from your gallery.",
  sending: "Still being prepared. It appears under Waiting when it's ready.",
  retake: "Retake",
  changeSlot: "Change slot",
  withdraw: "Withdraw",
  correction: REPORT_COPY.photoTitle,
  removal: "Ask to remove",
  removalAsked: "Removal asked for",
  withdrawTitle: "Withdraw this photo?",
  withdrawBody:
    "It leaves the album and your manager won't check it. This can't be undone.",
  withdrawn: "Withdrawn.",
  changed: "Slot changed. It waits for a manager under its new slot.",
  changeTitle: "Change slot",
  removalTitle: "Ask an admin to remove this photo",
  removalBody:
    "It has been checked, so it is kept. An admin decides, and tells you here if they can't remove it.",
  removalReason: "Why should it be removed?",
  removalSent: "Sent to an admin.",
  correctionSent: REPORT_COPY.sent,
} as const

/**
 * Thumbnail recovery (F7), the gallery's rule (app/_media/preview-recovery.ts):
 * the thumb route re-signs on every load, so a first error re-requests it
 * once with a new `?r=`; a second marks it broken, shows the plain icon, and
 * the list says how many could not load with Try again.
 */
type ThumbState = { version: number; broken: boolean }

function useThumbRecovery() {
  const [thumbs, setThumbs] = React.useState<Record<string, ThumbState>>({})
  const failed = React.useCallback((src: string | null) => {
    const route = parseMediaRoute(src)
    if (!route || route.slot !== "thumb") return
    setThumbs((current) => {
      const t = current[route.id] ?? { version: 0, broken: false }
      // A stale or repeated report of the same URL counts once.
      if (t.broken || route.version !== t.version) return current
      const next =
        t.version === 0
          ? { version: 1, broken: false }
          : { version: t.version, broken: true }
      return { ...current, [route.id]: next }
    })
  }, [])
  const onError = React.useCallback<React.ReactEventHandler<HTMLElement>>(
    (event) =>
      failed(
        event.target instanceof Element
          ? event.target.getAttribute("src")
          : null
      ),
    [failed]
  )
  // Images that failed before hydration never reach React's onError.
  const attach = React.useCallback<React.RefCallback<HTMLElement>>(
    (node) => {
      if (!node) return
      for (const img of node.querySelectorAll("img"))
        if (img.complete && img.naturalWidth === 0)
          failed(img.getAttribute("src"))
    },
    [failed]
  )
  const retry = React.useCallback(
    () =>
      setThumbs((current) =>
        Object.fromEntries(
          Object.entries(current).map(([id, t]) => [
            id,
            t.broken ? { version: t.version + 1, broken: false } : t,
          ])
        )
      ),
    []
  )
  const brokenCount = Object.values(thumbs).filter((t) => t.broken).length
  return { thumbs, onError, attach, retry, brokenCount }
}

function Thumb({ item, state }: { item: MyUpload; state?: ThumbState }) {
  const ready = item.uploadState === "ready"
  return (
    <span className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-control bg-plate text-on-stage">
      {ready && item.mediaType === "image" && !state?.broken ? (
        // Signed private URLs never go through next/image (see MediaTile).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={versioned(
            `/api/media/${item.assetId}/thumb`,
            state?.version ?? 0
          )}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : item.mediaType === "video" ? (
        <FilmStripIcon aria-hidden className="size-7" />
      ) : (
        <ImageIcon aria-hidden className="size-7" />
      )}
    </span>
  )
}

/** The photo itself, large, on its own page (DESIGN.md §5e "One photo"). */
function LargePhoto({ item }: { item: MyUpload }) {
  const [broken, setBroken] = React.useState(false)
  const ready = item.uploadState === "ready"
  return (
    <span className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-card bg-plate text-on-stage">
      {ready && item.mediaType === "image" && !broken ? (
        // Signed private URLs never go through next/image (see MediaTile).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={(el) => {
            if (el && el.complete && el.naturalWidth === 0) setBroken(true)
          }}
          src={`/api/media/${item.assetId}/preview`}
          alt=""
          decoding="async"
          onError={() => setBroken(true)}
          className="absolute inset-0 size-full object-contain"
        />
      ) : item.mediaType === "video" ? (
        <FilmStripIcon aria-hidden className="size-10" />
      ) : (
        <ImageIcon aria-hidden className="size-10" />
      )}
    </span>
  )
}

type Open =
  | { kind: "withdraw"; item: MyUpload }
  | { kind: "change"; item: MyUpload }
  | { kind: "removal"; item: MyUpload }
  | { kind: "correction"; item: MyUpload }
  | null

export function MyUploads({
  initial,
  currentVenueId,
  correctionsAsked = [],
  actions,
  headingLevel = 2,
  showTitle = true,
  layout = "list",
}: {
  /** The first page, read on the server; null when it couldn't be read. */
  initial: MyUploadsPage | null
  currentVenueId: string | null
  /** Own photos with an open correction request. */
  correctionsAsked?: string[]
  actions: MyUploadsActions
  headingLevel?: 2 | 3 | 4
  /**
   * False on its own page (`/staff/photos`), whose title already says
   * My photos: the heading stays for screen readers only.
   */
  showTitle?: boolean
  /**
   * detail: one photo on its own page (DESIGN.md §5e "One photo"), shown
   * large with every action as a full-width button; no filters, no paging.
   */
  layout?: "list" | "detail"
}) {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const [items, setItems] = React.useState(initial?.items ?? [])
  const [next, setNext] = React.useState(initial?.next ?? null)
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState<Open>(null)
  const [notes, setNotes] = React.useState<Record<string, string>>({})
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [asked, setAsked] = React.useState(() => new Set(correctionsAsked))
  const Heading = `h${headingLevel}` as "h2"
  const headingId = React.useId()

  // A server refresh (after an action) brings the fresh first page: adopt
  // it while rendering (React's "storing information from previous renders").
  const [seen, setSeen] = React.useState(initial)
  if (seen !== initial) {
    setSeen(initial)
    setItems(initial?.items ?? [])
    setNext(initial?.next ?? null)
  }

  const { groups } = groupUploads(items)
  const {
    thumbs,
    onError: onThumbError,
    attach: attachThumbs,
    retry: retryThumbs,
    brokenCount,
  } = useThumbRecovery()
  const firstNonEmpty =
    UPLOAD_SECTIONS.find((s) => groups[s.key].length > 0)?.key ?? "attention"
  const [section, setSection] = React.useState<UploadSection | null>(null)
  const shown = section ?? firstNonEmpty

  const note = (id: string, text: string) => {
    setNotes((n) => ({ ...n, [id]: text }))
    setErrors((e) => {
      const rest = { ...e }
      delete rest[id]
      return rest
    })
  }
  const fail = (id: string, text: string) =>
    setErrors((e) => ({ ...e, [id]: text }))

  async function run(
    id: string,
    action: () => Promise<Reply>,
    done: string
  ): Promise<boolean> {
    try {
      const result = await action()
      if (!result.ok) {
        fail(id, result.error)
        return false
      }
      note(id, done)
      router.refresh()
      return true
    } catch (cause) {
      fail(id, sessionEnded(cause) ?? REPORT_COPY.failed)
      return false
    }
  }

  async function more() {
    if (!next) return
    setLoading(true)
    try {
      const result = await actions.loadMore(next)
      if (result.ok) {
        setItems((list) => [
          ...list,
          ...result.page.items.filter(
            (i) => !list.some((l) => l.assetId === i.assetId)
          ),
        ])
        setNext(result.page.next)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-3"
      data-slot="my-uploads"
    >
      <Heading
        id={headingId}
        className={showTitle ? "px-1 type-section-title text-ink" : "sr-only"}
      >
        {MY_UPLOADS_COPY.title}
      </Heading>
      {initial === null ? (
        <Notice tone="negative" role="alert">
          {MY_UPLOADS_COPY.readFailed}
        </Notice>
      ) : layout === "detail" ? (
        items[0] ? (
          <ul ref={attachThumbs} onError={onThumbError} className="grid">
            <UploadRow
              detail
              item={items[0]}
              thumb={thumbs[items[0].assetId]}
              currentVenueId={currentVenueId}
              correctionAsked={asked.has(items[0].assetId)}
              note={notes[items[0].assetId] ?? null}
              error={errors[items[0].assetId] ?? null}
              onOpen={setOpen}
            />
          </ul>
        ) : (
          <p role="status" className="text-body text-ink">
            {MY_UPLOADS_COPY.detailGone}
          </p>
        )
      ) : items.length === 0 ? (
        <p className="px-1 text-body text-ink-muted">
          {MY_UPLOADS_COPY.noUploads}
        </p>
      ) : (
        <>
          <PillGroup label={MY_UPLOADS_COPY.sections}>
            {UPLOAD_SECTIONS.map((s) => (
              <FilterPill
                key={s.key}
                selected={shown === s.key}
                aria-pressed={shown === s.key}
                count={groups[s.key].length}
                onClick={() => setSection(s.key)}
              >
                {s.label}
              </FilterPill>
            ))}
          </PillGroup>
          {brokenCount > 0 ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-warn-bg p-3 ps-4 text-body text-ink rail-start-warn"
              data-slot="my-uploads-broken"
            >
              <span className="flex min-w-0 items-start gap-2">
                <WarningCircleIcon
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-warn-fg"
                />
                {MY_UPLOADS_COPY.brokenThumbs(brokenCount)}
              </span>
              <Button variant="secondary" size="sm" onClick={retryThumbs}>
                {MY_UPLOADS_COPY.retryThumbs}
              </Button>
            </div>
          ) : null}
          {groups[shown].length === 0 ? (
            <p className="px-1 text-body text-ink-muted" role="status">
              {UPLOAD_SECTIONS.find((s) => s.key === shown)!.empty}
            </p>
          ) : (
            <ul
              ref={attachThumbs}
              onError={onThumbError}
              className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
              data-section={shown}
            >
              {groups[shown].map((item) => (
                <UploadRow
                  key={item.assetId}
                  item={item}
                  thumb={thumbs[item.assetId]}
                  currentVenueId={currentVenueId}
                  correctionAsked={asked.has(item.assetId)}
                  note={notes[item.assetId] ?? null}
                  error={errors[item.assetId] ?? null}
                  onOpen={setOpen}
                />
              ))}
            </ul>
          )}
          {next ? (
            <Button
              variant="secondary"
              className="justify-self-start"
              loading={loading}
              onClick={more}
            >
              {MY_UPLOADS_COPY.loadMore}
            </Button>
          ) : null}
        </>
      )}

      <AlertDialog
        open={open?.kind === "withdraw"}
        onOpenChange={(o) => !o && setOpen(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{MY_UPLOADS_COPY.withdrawTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {MY_UPLOADS_COPY.withdrawBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const item = open?.kind === "withdraw" ? open.item : null
                setOpen(null)
                if (item)
                  void run(
                    item.assetId,
                    () => actions.withdraw(item.assetId),
                    MY_UPLOADS_COPY.withdrawn
                  )
              }}
            >
              {MY_UPLOADS_COPY.withdraw}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {open?.kind === "change" ? (
        <ChangeSlotDialog
          item={open.item}
          loadBoard={actions.loadBoard}
          onClose={() => setOpen(null)}
          onChoose={async (target) => {
            const item = open.item
            const ok = await run(
              item.assetId,
              () =>
                actions.changeSlot({
                  assetId: item.assetId,
                  expectedRevision: item.labelRevision,
                  target,
                }),
              MY_UPLOADS_COPY.changed
            )
            void ok
            setOpen(null)
          }}
        />
      ) : null}

      {open?.kind === "removal" ? (
        <RemovalDialog
          onClose={() => setOpen(null)}
          send={async (reason) => {
            const result = await actions.requestRemoval(
              open.item.assetId,
              reason
            )
            if (result.ok) {
              note(open.item.assetId, MY_UPLOADS_COPY.removalSent)
              router.refresh()
            }
            return result.ok ? null : result.error
          }}
        />
      ) : null}

      <ReportChangeDialog
        open={open?.kind === "correction"}
        onOpenChange={(o) => !o && setOpen(null)}
        subject={
          open?.kind === "correction"
            ? {
                kind: "photo",
                subjectId: open.item.assetId,
                name: open.item.slots.map((s) => s.name).join(", ") || "Photo",
              }
            : undefined
        }
        send={actions.report}
        onSent={(created, subject) => {
          setAsked((a) => new Set([...a, subject.subjectId]))
          note(
            subject.subjectId,
            created ? MY_UPLOADS_COPY.correctionSent : REPORT_COPY.alreadySent
          )
        }}
      />
    </section>
  )
}

function UploadRow({
  item,
  thumb,
  currentVenueId,
  correctionAsked,
  note,
  error,
  onOpen,
  detail = false,
}: {
  /** One photo on its own page: large, with full-width actions. */
  detail?: boolean
  item: MyUpload
  thumb: ThumbState | undefined
  currentVenueId: string | null
  correctionAsked: boolean
  note: string | null
  error: string | null
  onOpen: (open: Open) => void
}) {
  const can = uploadActions(item, currentVenueId)
  const canLabel = canLabelUpload(item, currentVenueId)
  // V13: it could change slot, but only from the venue it was sent to.
  const otherVenue =
    !can.changeSlot && uploadActions(item).changeSlot && item.venueName
      ? item.venueName
      : null
  const title = item.albumPost?.labels
    ? item.albumPost.labels.map(({ name }) => name).join(", ") ||
      "Unlabelled photo"
    : item.slots.length > 0
      ? item.slots.map((s) => s.name).join(", ")
      : item.sharedKinds.length > 0
        ? MY_UPLOADS_COPY.shared(item.sharedKinds)
        : MY_UPLOADS_COPY.noSlot
  return (
    <li
      className={
        detail ? "grid gap-4" : "grid grid-cols-[auto_minmax(0,1fr)] gap-3 p-3"
      }
      data-slot="my-upload-row"
      data-asset={item.assetId}
    >
      {detail ? (
        <LargePhoto item={item} />
      ) : (
        <Thumb item={item} state={thumb} />
      )}
      <div className={detail ? "grid min-w-0 gap-2" : "grid min-w-0 gap-1.5"}>
        {detail ? (
          <h2 className="type-page-title [overflow-wrap:anywhere] text-ink">
            {title}
          </h2>
        ) : (
          <p className="text-item-title [overflow-wrap:anywhere] text-ink">
            {title}
          </p>
        )}
        {receiptWord(item) ? (
          <StatusChip
            state={item.uploadState === "failed" ? "failed" : "processing"}
            className="w-fit"
          >
            {receiptWord(item)}
          </StatusChip>
        ) : null}
        {item.albumPost &&
        !item.albumPost.removed &&
        detail &&
        item.venueId === currentVenueId ? (
          <div className="flex flex-wrap gap-1.5">
            {item.albumPost.labels?.map(({ kind, id, name }) => (
              <LinkButton
                key={`${kind}:${id}`}
                variant="quiet"
                href={slotPageHref({ kind, slotId: id })}
              >
                Open {name} in Album
              </LinkButton>
            ))}
          </div>
        ) : null}
        {!item.albumPost && item.slots.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {item.slots.map((s) => (
              <li
                key={`${s.kind}:${s.slotId}`}
                className="flex flex-wrap items-center gap-2"
              >
                <StatusChip state={OUTCOME_CHIP[s.outcome]} />
                {detail && item.venueId === currentVenueId ? (
                  <LinkButton variant="quiet" href={slotPageHref(s)}>
                    Open {s.name} in Album
                  </LinkButton>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {item.slots
          .filter((s) => s.outcome === "retake_requested" && s.reason)
          .map((s) => (
            <p
              key={`reason:${s.slotId}`}
              className="text-body [overflow-wrap:anywhere] text-ink"
            >
              <span className="font-semibold text-warn-fg">
                {MY_UPLOADS_COPY.retake}:
              </span>{" "}
              {s.reason}
            </p>
          ))}
        {unmatched(item) && !canLabel && !item.albumPost ? (
          <p className="text-meta text-ink-muted" data-slot="my-upload-no-slot">
            {item.labelHelp
              ? MY_UPLOADS_COPY.labelHelpHint
              : item.venueName
                ? MY_UPLOADS_COPY.labelAtVenue(item.venueName)
                : null}
          </p>
        ) : null}
        {otherVenue ? (
          <p className="text-meta text-ink-muted">
            {MY_UPLOADS_COPY.otherVenueHint(otherVenue)}
          </p>
        ) : null}
        {item.uploadState === "failed" ? (
          <p className="flex items-start gap-1.5 text-body text-warn-fg">
            <WarningCircleIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
            {MY_UPLOADS_COPY.failed}
          </p>
        ) : item.uploadState !== "ready" ? (
          <p className="text-meta text-ink-muted">{MY_UPLOADS_COPY.sending}</p>
        ) : null}
        <p className="text-meta [overflow-wrap:anywhere] text-ink-muted">
          {currentVenueId && item.venueId !== currentVenueId && item.venueName
            ? `${MY_UPLOADS_COPY.sentTo(item.venueName)} · `
            : null}
          {datesLine(item)}
        </p>
        {item.duplicate ? (
          <p className="text-meta text-ink-muted">
            {MY_UPLOADS_COPY.duplicate}
          </p>
        ) : null}
        {item.removalRequested ? (
          <StatusChip tone="pending" className="w-fit">
            {MY_UPLOADS_COPY.removalAsked}
          </StatusChip>
        ) : null}
        {correctionAsked ? (
          <StatusChip tone="pending" className="w-fit">
            {REPORT_COPY.photoTitle}: sent
          </StatusChip>
        ) : null}
        <div
          className={
            detail
              ? "grid gap-2 pt-2 [&>*]:min-h-12 [&>*]:w-full"
              : "flex flex-wrap gap-2 pt-1"
          }
        >
          {can.retake ? (
            <LinkButton
              variant="secondary"
              size="sm"
              href={slotPageHref(can.retake)}
            >
              <ArrowUUpLeftIcon data-icon="inline-start" aria-hidden />
              {MY_UPLOADS_COPY.retake}
            </LinkButton>
          ) : null}
          {canLabel ? (
            <LinkButton
              variant="secondary"
              size="sm"
              href={labelPhotoHref(item.assetId)}
            >
              <PencilSimpleIcon data-icon="inline-start" aria-hidden />
              {LABEL_PHOTO}
            </LinkButton>
          ) : null}
          {can.changeSlot &&
          !item.albumPost?.managerLabelled &&
          !item.albumPost?.removed ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onOpen({ kind: "change", item })}
            >
              <PencilSimpleIcon data-icon="inline-start" aria-hidden />
              {MY_UPLOADS_COPY.changeSlot}
            </Button>
          ) : null}
          {can.correction && !correctionAsked ? (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => onOpen({ kind: "correction", item })}
            >
              <MegaphoneSimpleIcon data-icon="inline-start" aria-hidden />
              {MY_UPLOADS_COPY.correction}
            </Button>
          ) : null}
          {can.removal ? (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => onOpen({ kind: "removal", item })}
            >
              <TrashIcon data-icon="inline-start" aria-hidden />
              {MY_UPLOADS_COPY.removal}
            </Button>
          ) : null}
          {can.withdraw ? (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => onOpen({ kind: "withdraw", item })}
            >
              <TrashIcon data-icon="inline-start" aria-hidden />
              {MY_UPLOADS_COPY.withdraw}
            </Button>
          ) : null}
        </div>
        {note ? (
          <Notice tone="positive" role="status">
            {note}
          </Notice>
        ) : null}
        {error ? (
          <Notice tone="negative" role="alert">
            {error}
          </Notice>
        ) : null}
      </div>
    </li>
  )
}

function ChangeSlotDialog({
  item,
  loadBoard,
  onClose,
  onChoose,
}: {
  item: MyUpload
  loadBoard: MyUploadsActions["loadBoard"]
  onClose: () => void
  onChoose: (
    target: MatchSlot["target"] | { kind: "shared"; sharedKind: SharedKind }
  ) => Promise<void>
}) {
  const [board, setBoard] = React.useState<BoardState>({ state: "loading" })
  const [attempt, setAttempt] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    let live = true
    void loadBoard()
      .then((r) => {
        if (live)
          setBoard(
            r.ok
              ? { state: "ready", board: r.board }
              : { state: "error", message: r.message }
          )
      })
      .catch(() => live && setBoard({ state: "error", message: "" }))
    return () => {
      live = false
    }
  }, [loadBoard, attempt])
  const choose = async (
    target: MatchSlot["target"] | { kind: "shared"; sharedKind: SharedKind }
  ) => {
    setBusy(true)
    try {
      await onChoose(target)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{MY_UPLOADS_COPY.changeTitle}</DialogTitle>
          <DialogDescription>
            {item.slots.map((s) => s.name).join(", ")}
          </DialogDescription>
        </DialogHeader>
        <MatchPicker
          board={board}
          onRetryBoard={() => {
            setBoard({ state: "loading" })
            setAttempt((n) => n + 1)
          }}
          current={null}
          last={null}
          taken={new Set()}
          // Its own slot is never offered: choosing it changes nothing.
          exclude={new Set(item.slots.map((s) => `${s.kind}:${s.slotId}`))}
          busy={busy}
          headingLevel={3}
          onMatch={(slot) => void choose(slot.target)}
          onShared={(kind) => void choose({ kind: "shared", sharedKind: kind })}
        />
      </DialogContent>
    </Dialog>
  )
}

function RemovalDialog({
  onClose,
  send,
}: {
  onClose: () => void
  send: (reason: string) => Promise<string | null>
}) {
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (reason.trim().length < 3) {
              setError("Say why in a few words.")
              return
            }
            setPending(true)
            setError(null)
            try {
              const problem = await send(reason.trim())
              if (problem) setError(problem)
              else onClose()
            } catch {
              setError(REPORT_COPY.failed)
            } finally {
              setPending(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{MY_UPLOADS_COPY.removalTitle}</DialogTitle>
            <DialogDescription>{MY_UPLOADS_COPY.removalBody}</DialogDescription>
          </DialogHeader>
          <FormField label={MY_UPLOADS_COPY.removalReason} error={error}>
            <Textarea
              value={reason}
              maxLength={500}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <DialogFooter showCloseButton>
            <Button type="submit" variant="primary" loading={pending}>
              {REPORT_COPY.send.replace("your manager", "an admin")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
