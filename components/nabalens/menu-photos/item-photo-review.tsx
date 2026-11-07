"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowCounterClockwiseIcon,
  CameraRotateIcon,
  CheckIcon,
  StarIcon,
} from "@phosphor-icons/react"

import { failureText, needsRefresh } from "@/components/nabalens/coverage/copy"
import { SelfReviewBadge } from "@/components/nabalens/coverage/coverage-badges"
import {
  CoverageNotice,
  type Notice,
} from "@/components/nabalens/coverage/coverage-notice"
import {
  EvidencePreviewButton,
  EvidenceThumb,
} from "@/components/nabalens/coverage/evidence-image"
import {
  ReasonDialog,
  type ReasonOutcome,
} from "@/components/nabalens/coverage/reason-dialog"
import { firstName } from "@/components/nabalens/coverage/submission-card"
import { REPORTED } from "@/components/nabalens/coverage/use-coverage-action"
import { useRequestIds } from "@/components/nabalens/coverage/use-request-id"
import { EmptyState } from "@/components/nabalens/empty-state"
import { LoadMoreButton } from "@/components/nabalens/load-more-button"
import { formatDateTime } from "@/components/nabalens/menus/copy"
import { Notice as NoticeBox } from "@/components/nabalens/notice"
import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"

import type {
  CoverageFailure,
  CoverageResult,
  ItemPhotoCandidate,
  Page,
  PrimaryItemPhoto,
  ReviewedItemPhoto,
  WithdrawnItemPhoto,
} from "@/lib/server/coverage/types"

import { ITEM_PHOTO_STATE_LABEL, ITEM_REVIEW_COPY, waitingFor } from "./copy"

export type ReviewItemPhotoInput = {
  requestId: string
  assetId: string
  itemId: string
  variantId: string | null
  decision: "accept" | "better_photo"
  expectedRevision: number
  reason?: string
  makePrimary?: boolean
}

export type WithdrawItemPhotoInput = {
  requestId: string
  photoId: string
  expectedRevision: number
  reason: string
}

export type SetPrimaryItemPhotoInput = {
  requestId: string
  photoId: string
  expectedRevision: number
}

export type ItemPhotoHandlers = {
  review: (
    input: ReviewItemPhotoInput
  ) => Promise<CoverageResult<{ photo: ReviewedItemPhoto; replayed: boolean }>>
  withdraw: (
    input: WithdrawItemPhotoInput
  ) => Promise<CoverageResult<{ photo: WithdrawnItemPhoto; replayed: boolean }>>
  setPrimary: (
    input: SetPrimaryItemPhotoInput
  ) => Promise<CoverageResult<{ photo: PrimaryItemPhoto; replayed: boolean }>>
}

export type LoadCandidatesHandler = (
  cursor: string
) => Promise<CoverageResult<Page<ItemPhotoCandidate>>>

const NETWORK_ERROR =
  "Could not reach the server. Check your connection and try again; the photo will not be reviewed twice."

type Dialog =
  | { kind: "better"; candidate: ItemPhotoCandidate }
  | { kind: "undo"; candidate: ItemPhotoCandidate }

type Action = "accept" | "better" | "undo" | "primary"

/** Labelled photos grouped by dish, in the order they arrive (oldest first). */
function groupByItem(items: ItemPhotoCandidate[]) {
  const groups: {
    item: ItemPhotoCandidate["item"]
    candidates: ItemPhotoCandidate[]
  }[] = []
  const byId = new Map<string, (typeof groups)[number]>()
  for (const c of items) {
    const group = byId.get(c.item.id)
    if (group) group.candidates.push(c)
    else {
      const next = { item: c.item, candidates: [c] }
      byId.set(c.item.id, next)
      groups.push(next)
    }
  }
  return groups
}

/**
 * The reviewer's view of labelled menu photos: per photo the dish, variant,
 * upload venue, who took it and how long it has waited. Accept a photo for
 * its dish (optionally as the main photo), ask for a better one with a reason,
 * undo an acceptance with a reason, or change the main photo. Each decision
 * carries the dish's revision, so two reviewers deciding the same dish never
 * overwrite each other: the second sees the server's conflict message and the
 * page re-reads. A retried click reuses its request key and is not applied
 * twice.
 */
export function ItemPhotoReview({
  initial,
  venueName,
  now,
  handlers,
  onLoadMore,
  onStale,
  itemHref,
  emptyTitle = ITEM_REVIEW_COPY.emptyQueue,
}: {
  initial: Page<ItemPhotoCandidate>
  /** The upload venue: candidates are always photos uploaded there. */
  venueName: string
  /** Render time (ISO), so waiting ages match between server and browser. */
  now: string
  /** Omit for a read-only list. */
  handlers?: ItemPhotoHandlers
  onLoadMore?: LoadCandidatesHandler
  /** Re-read the page after a stale or refused change. */
  onStale?: () => void
  /** Link from each dish to all its photos (the queue view). */
  itemHref?: (itemId: string) => string
  emptyTitle?: string
}) {
  const [seed, setSeed] = React.useState(initial)
  const [items, setItems] = React.useState(initial.items)
  const [cursor, setCursor] = React.useState(initial.nextCursor)
  if (seed !== initial) {
    setSeed(initial)
    setItems(initial.items)
    setCursor(initial.nextCursor)
  }
  const [pending, setPending] = React.useState<{
    labelId: string
    action: Action
  } | null>(null)
  const [itemErrors, setItemErrors] = React.useState<Record<string, string>>({})
  const [makePrimary, setMakePrimary] = React.useState<Record<string, boolean>>(
    {}
  )
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [dialog, setDialog] = React.useState<Dialog | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const noticeRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const focusNoticeRef = React.useRef(false)
  const intents = useRequestIds()

  React.useEffect(() => {
    if (!focusNoticeRef.current) return
    focusNoticeRef.current = false
    noticeRef.current?.focus()
  }, [notice])

  /** Every photo of the dish now carries the dish's new revision. */
  function updateItem(
    itemId: string,
    revision: number,
    change: (c: ItemPhotoCandidate) => ItemPhotoCandidate = (c) => c
  ) {
    setItems((current) =>
      current.map((c) =>
        c.item.id === itemId ? change({ ...c, itemRevision: revision }) : c
      )
    )
  }

  function clearError(labelId: string) {
    setItemErrors((current) => {
      const next = { ...current }
      delete next[labelId]
      return next
    })
  }

  /**
   * One write with its request key. A stale revision or a decision someone
   * else made first shows the server's message and re-reads the page.
   */
  async function run<T extends object>(
    candidate: ItemPhotoCandidate,
    action: Action,
    payload: Record<string, unknown>,
    call: (requestId: string) => Promise<CoverageResult<T>>,
    onSuccess: (result: { ok: true } & T) => string
  ): Promise<ReasonOutcome> {
    const scope = `item-photo:${action}:${candidate.labelId}`
    const requestId = intents.requestIdFor(scope, payload)
    setPending({ labelId: candidate.labelId, action })
    clearError(candidate.labelId)
    try {
      const result = await call(requestId)
      if (!result.ok) {
        if (result.code !== "unavailable") intents.settle(scope)
        if (needsRefresh(result)) {
          // The refresh may change the card. Buttons without a dialog move
          // focus here; the reason dialog moves it itself when it closes.
          focusNoticeRef.current = action === "accept" || action === "primary"
          setNotice({ tone: "warning", text: conflictText(result, candidate) })
          onStale?.()
          return REPORTED
        }
        const text = failureText(result)
        setItemErrors((current) => ({ ...current, [candidate.labelId]: text }))
        return {
          ok: false,
          error: text,
          fieldError: result.fieldErrors?.reason,
        }
      }
      intents.settle(scope)
      focusNoticeRef.current = action === "accept" || action === "primary"
      setNotice({ tone: "success", text: onSuccess(result) })
      return { ok: true }
    } catch {
      setItemErrors((current) => ({
        ...current,
        [candidate.labelId]: NETWORK_ERROR,
      }))
      return { ok: false, error: NETWORK_ERROR }
    } finally {
      setPending(null)
    }
  }

  function accept(candidate: ItemPhotoCandidate) {
    if (!handlers) return
    const primary = makePrimary[candidate.labelId] === true
    const payload = {
      assetId: candidate.asset.id,
      itemId: candidate.item.id,
      variantId: candidate.variant?.variantId ?? null,
      decision: "accept" as const,
      expectedRevision: candidate.itemRevision,
      makePrimary: primary,
    }
    return run(
      candidate,
      "accept",
      payload,
      (requestId) => handlers.review({ requestId, ...payload }),
      (result) => {
        const photo = result.photo
        updateItem(candidate.item.id, photo.itemRevision, (c) =>
          c.labelId === candidate.labelId
            ? {
                ...c,
                photo: {
                  id: photo.photoId,
                  state: "accepted",
                  isPrimary: photo.isPrimary,
                },
              }
            : photo.isPrimary && c.photo
              ? { ...c, photo: { ...c.photo, isPrimary: false } }
              : c
        )
        return `Accepted for ${candidate.item.name}.${photo.isPrimary ? " It's the main photo." : ""}${photo.selfReview ? " Recorded as a self-review." : ""}`
      }
    )
  }

  function askBetter(candidate: ItemPhotoCandidate, reason: string) {
    if (!handlers) return Promise.resolve(REPORTED)
    const payload = {
      assetId: candidate.asset.id,
      itemId: candidate.item.id,
      variantId: candidate.variant?.variantId ?? null,
      decision: "better_photo" as const,
      expectedRevision: candidate.itemRevision,
      reason,
    }
    return run(
      candidate,
      "better",
      payload,
      (requestId) => handlers.review({ requestId, ...payload }),
      (result) => {
        const photo = result.photo
        updateItem(candidate.item.id, photo.itemRevision, (c) =>
          c.labelId === candidate.labelId
            ? {
                ...c,
                photo: {
                  id: photo.photoId,
                  state: "better_photo_requested",
                  isPrimary: false,
                },
              }
            : c
        )
        return `Asked ${candidate.self ? "yourself" : firstName(candidate.uploader.displayName)} for a better photo of ${candidate.item.name}.${photo.selfReview ? " Recorded as a self-review." : ""}`
      }
    )
  }

  function undo(candidate: ItemPhotoCandidate, reason: string) {
    if (!handlers || !candidate.photo) return Promise.resolve(REPORTED)
    const payload = {
      photoId: candidate.photo.id,
      expectedRevision: candidate.itemRevision,
      reason,
    }
    return run(
      candidate,
      "undo",
      payload,
      (requestId) => handlers.withdraw({ requestId, ...payload }),
      (result) => {
        const photo = result.photo
        const wasPrimary = candidate.photo?.isPrimary === true
        updateItem(candidate.item.id, photo.itemRevision, (c) =>
          c.labelId === candidate.labelId
            ? { ...c, photo: null }
            : c.photo && wasPrimary
              ? {
                  ...c,
                  photo: {
                    ...c.photo,
                    isPrimary: photo.newPrimaryPhotoId === c.photo.id,
                  },
                }
              : c
        )
        return `Acceptance undone for ${candidate.item.name}. The photo stays in Photos and on ${candidate.self ? "your" : `${firstName(candidate.uploader.displayName)}'s`} profile.`
      }
    )
  }

  function setPrimary(candidate: ItemPhotoCandidate) {
    if (!handlers || !candidate.photo) return
    const payload = {
      photoId: candidate.photo.id,
      expectedRevision: candidate.itemRevision,
    }
    return run(
      candidate,
      "primary",
      payload,
      (requestId) => handlers.setPrimary({ requestId, ...payload }),
      (result) => {
        updateItem(candidate.item.id, result.photo.itemRevision, (c) =>
          c.photo
            ? {
                ...c,
                photo: {
                  ...c.photo,
                  isPrimary: c.photo.id === result.photo.photoId,
                },
              }
            : c
        )
        return `This is now the main photo of ${candidate.item.name}.`
      }
    )
  }

  async function loadMore() {
    if (!onLoadMore || !cursor) return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await onLoadMore(cursor)
      if (!result.ok) {
        setLoadError(failureText(result))
        return
      }
      setItems((current) => {
        const seen = new Set(current.map((c) => c.labelId))
        return [...current, ...result.items.filter((c) => !seen.has(c.labelId))]
      })
      setCursor(result.nextCursor)
    } catch {
      setLoadError("More photos could not load. Try again.")
    } finally {
      setLoading(false)
    }
  }

  const busy = pending !== null
  const subject = dialog?.candidate ?? null

  return (
    <div className="grid gap-4">
      <CoverageNotice
        ref={noticeRef}
        notice={notice}
        onDismiss={() => setNotice(null)}
      />
      {items.length === 0 ? (
        <EmptyState
          variant={
            emptyTitle === ITEM_REVIEW_COPY.emptyQueue ? "done" : "filtered"
          }
          title={emptyTitle}
          inline
        />
      ) : (
        <div
          ref={listRef}
          tabIndex={-1}
          className="@container grid gap-6 outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          {groupByItem(items).map((group) => {
            const headingId = `item-photos-${group.item.id}`
            return (
              <section
                key={group.item.id}
                aria-labelledby={headingId}
                className="grid gap-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <h2
                      id={headingId}
                      className="font-display text-section-title [overflow-wrap:anywhere] text-ink"
                    >
                      {group.item.name}
                    </h2>
                    <p className="text-meta text-ink-muted">
                      {group.item.sectionName}
                    </p>
                  </div>
                  {itemHref ? (
                    <Link
                      href={itemHref(group.item.id)}
                      aria-describedby={headingId}
                      className={buttonVariants({
                        variant: "link",
                        size: "sm",
                      })}
                    >
                      {ITEM_REVIEW_COPY.allPhotosOfDish}
                    </Link>
                  ) : null}
                </div>
                <ul
                  aria-label={`Photos of ${group.item.name}`}
                  className="grid gap-(--gutter)"
                >
                  {group.candidates.map((candidate) => (
                    <li key={candidate.labelId}>
                      <CandidateCard
                        candidate={candidate}
                        venueName={venueName}
                        now={now}
                        error={itemErrors[candidate.labelId]}
                        actions={
                          handlers ? (
                            <CandidateActions
                              candidate={candidate}
                              busy={busy}
                              pending={
                                pending?.labelId === candidate.labelId
                                  ? pending.action
                                  : null
                              }
                              makePrimary={
                                makePrimary[candidate.labelId] === true
                              }
                              onMakePrimaryChange={(value) =>
                                setMakePrimary((current) => ({
                                  ...current,
                                  [candidate.labelId]: value,
                                }))
                              }
                              onAccept={() => void accept(candidate)}
                              onAskBetter={() =>
                                setDialog({ kind: "better", candidate })
                              }
                              onUndo={() =>
                                setDialog({ kind: "undo", candidate })
                              }
                              onSetPrimary={() => void setPrimary(candidate)}
                            />
                          ) : null
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          {onLoadMore ? (
            <LoadMoreButton
              hasMore={!!cursor}
              loading={loading}
              error={loadError}
              onLoadMore={() => void loadMore()}
              shownCount={items.length}
            />
          ) : null}
        </div>
      )}
      <ReasonDialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
        title={
          dialog?.kind === "undo"
            ? ITEM_REVIEW_COPY.undo
            : ITEM_REVIEW_COPY.askBetter
        }
        label="Reason"
        help={
          subject
            ? dialog?.kind === "undo"
              ? `Say why this photo no longer counts for ${subject.item.name}.`
              : `${subject.self ? "You see" : `${firstName(subject.uploader.displayName)} sees`} this with the photo. Say what a better photo needs.`
            : undefined
        }
        emptyError={
          dialog?.kind === "undo"
            ? "Add a reason for undoing the acceptance."
            : "Add a reason. Say what a better photo needs."
        }
        note={
          subject
            ? `The photo stays in Photos and on ${subject.self ? "your" : `${firstName(subject.uploader.displayName)}'s`} profile.`
            : undefined
        }
        confirmLabel={
          dialog?.kind === "undo"
            ? ITEM_REVIEW_COPY.undo
            : ITEM_REVIEW_COPY.askBetter
        }
        confirmIcon={
          dialog?.kind === "undo" ? (
            <ArrowCounterClockwiseIcon data-icon="inline-start" aria-hidden />
          ) : (
            <CameraRotateIcon data-icon="inline-start" aria-hidden />
          )
        }
        destructive={dialog?.kind === "undo"}
        pendingLabel="Saving…"
        onConfirm={async (reason) => {
          if (!dialog) return { ok: false, error: "Choose a photo first." }
          return dialog.kind === "undo"
            ? undo(dialog.candidate, reason)
            : askBetter(dialog.candidate, reason)
        }}
        reportFocus={() => noticeRef.current ?? listRef.current}
        reportFocusOnSuccess
      >
        {subject ? (
          <div className="flex items-center gap-3">
            <EvidenceThumb
              src={subject.asset.thumbnailUrl}
              className="aspect-square w-16 shrink-0 rounded-control"
            />
            <p className="min-w-0 text-body">
              <strong className="font-bold [overflow-wrap:anywhere] text-ink">
                {subject.item.name}
                {subject.variant ? ` · ${subject.variant.name}` : null}
              </strong>
              <br />
              <span className="text-ink-muted">
                {subject.self ? "You" : subject.uploader.displayName} · uploaded{" "}
                {formatDateTime(subject.uploadedAt)}
              </span>
            </p>
          </div>
        ) : null}
      </ReasonDialog>
    </div>
  )
}

/**
 * What a reviewer reads after a conflict: the server's own message for a
 * decision that no longer applies (not labelled, not on the menu, already
 * decided), or that someone else changed this dish first.
 */
function conflictText(
  failure: CoverageFailure,
  candidate: ItemPhotoCandidate
): string {
  if (failure.code === "revision_conflict")
    return `Someone else changed the photos of ${candidate.item.name} a moment ago. The latest decisions are shown; check them and try again if you still need to.`
  return failure.message
}

function CandidateCard({
  candidate,
  venueName,
  now,
  error,
  actions,
}: {
  candidate: ItemPhotoCandidate
  venueName: string
  now: string
  error?: string
  actions?: React.ReactNode
}) {
  const { uploader, photo } = candidate
  const waited = photo ? null : waitingFor(candidate.uploadedAt, now)
  return (
    <article
      aria-label={`${candidate.item.name}: photo by ${uploader.displayName}`}
      className="grid gap-4 rounded-card bg-surface p-4 shadow-card @min-[40rem]:grid-cols-[minmax(0,280px)_minmax(0,1fr)]"
    >
      <EvidencePreviewButton
        thumbnailUrl={candidate.asset.thumbnailUrl}
        previewUrl={candidate.asset.previewUrl}
        label={`Photo by ${uploader.displayName}`}
        description={candidate.item.name}
      />
      <div className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {photo ? (
            // §3 shapes: accepted is the filled tick square; a better photo
            // asked for is the warn pill; a recheck is the dashed pill.
            photo.state === "accepted" ? (
              <StatusChip state="accepted">
                {ITEM_PHOTO_STATE_LABEL[photo.state]}
              </StatusChip>
            ) : photo.state === "better_photo_requested" ? (
              <StatusChip state="needs_another_photo">
                {ITEM_PHOTO_STATE_LABEL[photo.state]}
              </StatusChip>
            ) : (
              <StatusChip tone="pending">
                {ITEM_PHOTO_STATE_LABEL[photo.state]}
              </StatusChip>
            )
          ) : (
            <StatusChip state="submitted">
              {ITEM_REVIEW_COPY.waiting}
            </StatusChip>
          )}
          {photo?.isPrimary ? (
            <StatusChip tone="neutral">
              <StarIcon aria-hidden />
              {ITEM_REVIEW_COPY.primary}
            </StatusChip>
          ) : null}
          {candidate.self ? <SelfReviewBadge /> : null}
        </div>
        <dl className="grid gap-1.5 text-body">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">Dish</dt>
            <dd className="font-bold [overflow-wrap:anywhere] text-ink">
              {candidate.item.name}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">Variant</dt>
            <dd className="font-bold [overflow-wrap:anywhere] text-ink">
              {candidate.variant?.name ??
                (candidate.variantRemoved
                  ? ITEM_REVIEW_COPY.variantGone
                  : "Any")}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">Uploaded at</dt>
            <dd className="font-bold [overflow-wrap:anywhere] text-ink">
              {venueName}
            </dd>
          </div>
        </dl>
        <div className="flex min-w-0 items-center gap-3">
          <ProfileAvatar name={uploader.displayName} />
          <span className="grid min-w-0">
            <span className="text-label [overflow-wrap:anywhere] text-ink">
              {candidate.self ? "You" : uploader.displayName}
              {!uploader.active ? (
                <span className="font-normal text-ink-muted">
                  {" "}
                  · no longer active
                </span>
              ) : null}
            </span>
            <span className="text-meta text-ink-muted tabular-nums">
              Uploaded {formatDateTime(candidate.uploadedAt)}
              {waited ? ` · waiting ${waited}` : null}
            </span>
          </span>
        </div>
        {candidate.self && actions && !photo ? (
          <NoticeBox tone="attention">{ITEM_REVIEW_COPY.selfNote}</NoticeBox>
        ) : null}
        {actions}
        {error ? (
          <p
            role="alert"
            className="text-body font-semibold [overflow-wrap:anywhere] text-warn-fg"
          >
            {error}
          </p>
        ) : null}
      </div>
    </article>
  )
}

function CandidateActions({
  candidate,
  busy,
  pending,
  makePrimary,
  onMakePrimaryChange,
  onAccept,
  onAskBetter,
  onUndo,
  onSetPrimary,
}: {
  candidate: ItemPhotoCandidate
  /** Any decision is in flight: every button waits (no double decisions). */
  busy: boolean
  pending: Action | null
  makePrimary: boolean
  onMakePrimaryChange: (value: boolean) => void
  onAccept: () => void
  onAskBetter: () => void
  onUndo: () => void
  onSetPrimary: () => void
}) {
  const id = React.useId()
  const state = candidate.photo?.state ?? null
  // A recheck whose variant left the menu can only be withdrawn: review
  // refuses a variant the active menu no longer offers.
  const variantGone = candidate.variantRemoved && state === "needs_recheck"
  const acceptable = state !== "accepted" && !variantGone
  const askable = (state === null || state === "needs_recheck") && !variantGone
  return (
    <div className="grid gap-3">
      {variantGone ? (
        <p className="text-body text-ink-muted">
          {ITEM_REVIEW_COPY.variantRemoved}
        </p>
      ) : null}
      {acceptable ? (
        <label
          htmlFor={`${id}-primary`}
          className="flex min-h-11 cursor-pointer items-center gap-3 text-body"
        >
          <input
            id={`${id}-primary`}
            type="checkbox"
            checked={makePrimary}
            disabled={busy}
            onChange={(e) => onMakePrimaryChange(e.currentTarget.checked)}
            className="size-6 shrink-0 accent-select focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
          />
          {ITEM_REVIEW_COPY.makePrimaryOnAccept}
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2 @max-[40rem]:*:flex-auto">
        {acceptable ? (
          <Button
            size="touch"
            variant="primary"
            disabled={busy}
            aria-busy={pending === "accept" || undefined}
            onClick={onAccept}
          >
            <CheckIcon data-icon="inline-start" aria-hidden />
            {pending === "accept" ? "Saving…" : ITEM_REVIEW_COPY.accept}
          </Button>
        ) : null}
        {askable ? (
          <Button
            size="touch"
            variant="secondary"
            disabled={busy}
            onClick={onAskBetter}
          >
            <CameraRotateIcon data-icon="inline-start" aria-hidden />
            {ITEM_REVIEW_COPY.askBetter}
          </Button>
        ) : null}
        {state === "accepted" && !candidate.photo?.isPrimary ? (
          <Button
            size="touch"
            variant="secondary"
            disabled={busy}
            aria-busy={pending === "primary" || undefined}
            onClick={onSetPrimary}
          >
            <StarIcon data-icon="inline-start" aria-hidden />
            {pending === "primary" ? "Saving…" : ITEM_REVIEW_COPY.makePrimary}
          </Button>
        ) : null}
        {state === "accepted" || variantGone ? (
          <Button
            size="touch"
            variant="secondary"
            disabled={busy}
            onClick={onUndo}
          >
            <ArrowCounterClockwiseIcon data-icon="inline-start" aria-hidden />
            {ITEM_REVIEW_COPY.undo}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
