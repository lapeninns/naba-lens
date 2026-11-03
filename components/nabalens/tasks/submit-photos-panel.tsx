"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowClockwiseIcon,
  CameraIcon,
  PaperPlaneTiltIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import { LoadMoreButton } from "../load-more-button"
import { EmptyState } from "../empty-state"
import { Notice } from "../notice"
import { useOnline } from "../offline-notice"
import type { UploadLimits } from "../types"
import { UploadDialog } from "../upload-dialog"
import type { Uploader } from "../upload-queue"
import { failureCopy, NETWORK_FAILURE, plural, type FailureCopy } from "./copy"
import { PhotoPicker } from "./photo-picker"
import { intentKey, useRequestIntent } from "./request-intent"
import type {
  AssetIneligibleReason,
  SubmitPhotosInput,
  SubmitPhotosResult,
  SubmittablePhoto,
  SubmittablePhotosInput,
  SubmittablePhotosResult,
} from "./types"

type Outcome =
  | {
      kind: "sent"
      /** Newly sent (not already live on this task). */
      sent: number
      skipped: number
      /** Nothing new: a replay, or every photo was already sent here. */
      alreadySent: boolean
      /**
       * Taken when the send starts: the refresh after a replacement closes
       * the request, so the props no longer say a photo was replaced.
       */
      replaced: boolean
      reviewerName: string | null
    }
  | { kind: "failed"; copy: FailureCopy }

type SubmitPhotosPanelProps = {
  /** The task, or null for a monthly-only submission (no task). */
  requirementId: string | null
  /** The "needs another photo" item this send answers, if any. */
  replacesSubmissionId?: string | null
  /** Who asked for the replacement; named in the sent message. */
  reviewerName?: string | null
  /** The task's title, for the heading; null in monthly mode. */
  taskTitle?: string | null
  /** The venue photos must be taken at, named when nothing can be sent. */
  venueName?: string | null
  /** The first page of photos, as loaded by the page. */
  initialPhotos: SubmittablePhotosResult
  /** Changes when a global Add upload completes while this picker is open. */
  refreshSignal?: number
  loadPhotos: (
    input: SubmittablePhotosInput
  ) => Promise<SubmittablePhotosResult>
  submit: (input: SubmitPhotosInput) => Promise<SubmitPhotosResult>
  /** The existing upload transport (reserve -> transfer -> finalise). */
  uploader: Uploader
  /** MEDIA_LIMITS: the batch cap also caps one submission. */
  limits: UploadLimits
  /** Re-read the page after a conflict (router.refresh). */
  onReload: () => void
  signInHref: string
}

type PhotoList = {
  photos: SubmittablePhoto[]
  nextCursor: string | null
  error: string | null
  errorSource: "first" | "more" | null
}

function initialState(result: SubmittablePhotosResult): PhotoList {
  return result.ok
    ? {
        photos: result.items,
        nextCursor: result.nextCursor,
        error: null,
        errorSource: null,
      }
    : {
        photos: [],
        nextCursor: null,
        error: failureCopy(result).message,
        errorSource: "first",
      }
}

/**
 * Capture or choose own ready photos and send them for review. Uploads go
 * through the existing pipeline (UploadDialog) and newly ready photos are
 * selected automatically. Each send carries one request ID per intent, so a
 * retry after a dropped connection replays instead of sending twice.
 */
export function SubmitPhotosPanel({
  requirementId,
  taskTitle = null,
  venueName = null,
  replacesSubmissionId = null,
  reviewerName = null,
  initialPhotos,
  refreshSignal,
  loadPhotos,
  submit,
  uploader,
  limits,
  onReload,
  signInHref,
}: SubmitPhotosPanelProps) {
  const monthly = requirementId === null
  const maxSelected = limits.maxBatchFiles
  const online = useOnline()
  const intent = useRequestIntent()
  const [list, setList] = React.useState(() => initialState(initialPhotos))
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const [flagged, setFlagged] = React.useState<
    ReadonlyMap<string, AssetIneligibleReason>
  >(new Map())
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [outcome, setOutcome] = React.useState<Outcome | null>(null)
  const [uploadNote, setUploadNote] = React.useState<string | null>(null)
  const inFlight = React.useRef(false)
  const loadingPhotos = React.useRef(false)
  const queuedReload = React.useRef<Set<string> | null>(null)
  const selectedRef = React.useRef(selected)
  const mounted = React.useRef(false)

  React.useLayoutEffect(() => {
    selectedRef.current = selected
  }, [selected])

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queuedReload.current = null
    }
  }, [])

  const reloadFirstPage = React.useCallback(
    async function reloadFirstPage(select: string[] = []) {
      if (loadingPhotos.current) {
        queuedReload.current ??= new Set()
        for (const id of select) queuedReload.current.add(id)
        return
      }
      queuedReload.current = null
      loadingPhotos.current = true
      try {
        const result = await loadPhotos({ requirementId, cursor: null })
        if (!mounted.current) return
        if (!result.ok) {
          setList((l) => ({
            ...l,
            error: failureCopy(result).message,
            errorSource: "first",
          }))
          return
        }
        const listed = new Set(result.items.map((p) => p.assetId))
        const selectedIds = new Set(selectedRef.current)
        // Keep selected photos from older pages visible while the fresh
        // page supplies the latest eligibility for every photo it includes.
        setList((current) => ({
          photos: [
            ...result.items,
            ...current.photos.filter(
              (p) => selectedIds.has(p.assetId) && !listed.has(p.assetId)
            ),
          ],
          nextCursor: result.nextCursor,
          error: null,
          errorSource: null,
        }))
        setFlagged((current) =>
          current.size === 0
            ? current
            : new Map([...current].filter(([id]) => !listed.has(id)))
        )
        if (select.length === 0) return
        const ready = new Set(
          result.items.filter((p) => p.eligible).map((p) => p.assetId)
        )
        const picked = select.filter((id) => ready.has(id))
        setSelected((current) => {
          const next = [...current]
          for (const id of picked) {
            if (next.length >= maxSelected) break
            if (!next.includes(id)) next.push(id)
          }
          return next
        })
        const waiting = select.length - picked.length
        setUploadNote(
          [
            picked.length
              ? `${plural(picked.length, "new photo", "new photos")} selected.`
              : null,
            waiting
              ? `${plural(waiting, "new photo isn't", "new photos aren't")} ready to send yet.`
              : null,
          ]
            .filter(Boolean)
            .join(" ")
        )
      } catch {
        if (mounted.current)
          setList((l) => ({
            ...l,
            error: NETWORK_FAILURE.message,
            errorSource: "first",
          }))
      } finally {
        loadingPhotos.current = false
        const queued = queuedReload.current
        queuedReload.current = null
        if (queued !== null && mounted.current) {
          void reloadFirstPage(Array.from(queued))
        }
      }
    },
    [loadPhotos, requirementId, maxSelected]
  )

  const lastRefreshSignal = React.useRef(refreshSignal)
  React.useEffect(() => {
    if (refreshSignal === lastRefreshSignal.current) return
    lastRefreshSignal.current = refreshSignal
    void reloadFirstPage()
  }, [refreshSignal, reloadFirstPage])

  async function loadMore() {
    if (!list.nextCursor || loadingPhotos.current) return
    loadingPhotos.current = true
    setLoadingMore(true)
    try {
      const result = await loadPhotos({
        requirementId,
        cursor: list.nextCursor,
      })
      if (!mounted.current) return
      if (result.ok) {
        setList((l) => {
          const seen = new Set(l.photos.map((p) => p.assetId))
          return {
            photos: [
              ...l.photos,
              ...result.items.filter((p) => !seen.has(p.assetId)),
            ],
            nextCursor: result.nextCursor,
            error: null,
            errorSource: null,
          }
        })
      } else {
        setList((l) => ({
          ...l,
          error: failureCopy(result).message,
          errorSource: "more",
        }))
      }
    } catch {
      if (mounted.current)
        setList((l) => ({
          ...l,
          error: NETWORK_FAILURE.message,
          errorSource: "more",
        }))
    } finally {
      loadingPhotos.current = false
      if (mounted.current) {
        setLoadingMore(false)
        if (queuedReload.current !== null) {
          void reloadFirstPage(Array.from(queuedReload.current))
        }
      }
    }
  }

  function toggle(assetId: string) {
    setOutcome(null)
    setSelected((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : current.length >= maxSelected
          ? current
          : [...current, assetId]
    )
  }

  async function send() {
    if (inFlight.current || selected.length === 0 || !online) return
    inFlight.current = true
    const assetIds = selected
    const replaced = replacesSubmissionId !== null
    const reviewer = reviewerName
    const key = intentKey(requirementId, assetIds, replacesSubmissionId)
    const requestId = intent.idFor(key)
    setSending(true)
    setOutcome(null)
    setUploadNote(null)
    let result: SubmitPhotosResult
    try {
      result = await submit({
        requestId,
        requirementId,
        assetIds,
        ...(replacesSubmissionId ? { replacesSubmissionId } : {}),
      })
    } catch {
      // Same selection, same request ID on retry: never sent twice.
      setOutcome({ kind: "failed", copy: NETWORK_FAILURE })
      return
    } finally {
      inFlight.current = false
      setSending(false)
    }

    if (result.ok) {
      intent.settle(key)
      setSelected([])
      setFlagged(new Map(result.skipped.map((s) => [s.assetId, s.reason])))
      const fresh = result.submitted.filter((p) => !p.reused).length
      setOutcome({
        kind: "sent",
        sent: fresh,
        skipped: result.skipped.length,
        alreadySent: result.replayed || fresh === 0,
        replaced,
        reviewerName: reviewer,
      })
      // Sent photos now read "Already sent for this task".
      void reloadFirstPage()
      return
    }

    const copy = failureCopy(result)
    if (copy.action !== "retry") intent.settle(key)
    if (result.code === "asset_ineligible" && result.assetErrors?.length) {
      const errors = result.assetErrors
      setFlagged((current) => {
        const next = new Map(current)
        for (const e of errors) next.set(e.assetId, e.reason)
        return next
      })
      setSelected((current) =>
        current.filter((id) => !errors.some((e) => e.assetId === id))
      )
    }
    setOutcome({ kind: "failed", copy })
  }

  const count = selected.length
  const full = count >= maxSelected
  const nothingEligible =
    list.photos.length > 0 && !list.photos.some((p) => p.eligible)

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-section-title-touch text-ink md:text-section-title">
        {monthly || !taskTitle ? "Send photos" : `Send photos to ${taskTitle}`}
      </h2>

      {nothingEligible ? (
        <Notice tone="plain">
          None of your photos can be sent for this task.
          {venueName ? ` Take a new one at ${venueName}.` : ""}
        </Notice>
      ) : null}

      {full ? (
        <Notice tone="attention">
          You can send up to {maxSelected} at a time.
        </Notice>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          size="touch"
          variant={nothingEligible ? "primary" : "secondary"}
          onClick={() => setUploadOpen(true)}
        >
          <CameraIcon data-icon="inline-start" aria-hidden />
          Take a photo
        </Button>
        <p className="text-meta-touch text-ink-muted md:text-meta">
          New photos are selected for you once they&apos;re ready.
        </p>
      </div>

      <div
        aria-live="polite"
        className="text-body-touch empty:hidden md:text-body-sm"
      >
        {uploadNote ? <p>{uploadNote}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-item-title-touch text-ink md:text-item-title">
          Or choose from your photos
        </h3>
        <p className="text-meta-touch text-ink-muted md:text-meta">
          {monthly
            ? "Photos you upload and send this month count toward your target once accepted."
            : "Photos from earlier months can still count for this task."}{" "}
          Only ready photos can be sent; photos still processing or that failed
          to upload don&apos;t count.
        </p>
      </div>

      {list.photos.length > 0 ? (
        <PhotoPicker
          photos={list.photos}
          selected={selected}
          onToggle={toggle}
          maxSelected={maxSelected}
          flagged={flagged}
          monthly={monthly}
        />
      ) : list.error ? null : (
        <EmptyState
          inline
          title={monthly ? "No photos from this month yet." : "No photos yet."}
          description="Take a photo to get started."
        />
      )}

      {loadingMore ? (
        <SkeletonRegion
          label="Loading photos…"
          className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"
        >
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} shape="tile" />
          ))}
        </SkeletonRegion>
      ) : null}

      <LoadMoreButton
        hasMore={list.nextCursor !== null}
        loading={loadingMore}
        error={list.error}
        onLoadMore={() =>
          list.errorSource === "first"
            ? void reloadFirstPage()
            : void loadMore()
        }
      />

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-col gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <OutcomeMessage
          outcome={outcome}
          onRetry={() => void send()}
          onReload={onReload}
          signInHref={signInHref}
          retrying={sending || !online}
          replacing={replacesSubmissionId !== null}
        />
        {!sending ? (
          <p className="text-meta-touch text-ink-muted md:text-meta">
            {replacesSubmissionId
              ? count > 0
                ? `${count} selected · it replaces the earlier photo`
                : null
              : `${count} selected · up to ${maxSelected}`}
          </p>
        ) : null}
        <Button
          size="touch"
          onClick={() => void send()}
          disabled={count === 0 || sending || !online}
          aria-busy={sending}
          className="sm:self-start"
        >
          {sending ? (
            <SpinnerGapIcon
              data-icon="inline-start"
              className="motion-safe:animate-spin"
              aria-hidden
            />
          ) : (
            <PaperPlaneTiltIcon data-icon="inline-start" aria-hidden />
          )}
          {sending
            ? "Sending…"
            : replacesSubmissionId
              ? "Send another photo"
              : count === 0
                ? "Select photos to send"
                : `Send ${plural(count, "photo", "photos")}`}
        </Button>
      </div>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        uploader={uploader}
        limits={limits}
        imagesOnly
        onReady={(ids) => void reloadFirstPage(ids)}
      />
    </div>
  )
}

function OutcomeMessage({
  outcome,
  onRetry,
  onReload,
  signInHref,
  retrying,
  replacing,
}: {
  outcome: Outcome | null
  onRetry: () => void
  onReload: () => void
  signInHref: string
  retrying: boolean
  replacing: boolean
}) {
  if (!outcome) return null
  if (outcome.kind === "sent" && outcome.replaced && !outcome.alreadySent) {
    return (
      <div
        role="status"
        className="flex flex-col gap-1 text-body-touch md:text-body-sm"
      >
        <p className="font-medium text-positive">
          Your new photo is waiting for review
        </p>
        <p>
          Sent. {outcome.reviewerName ?? "Your reviewer"} reviews it next. Your
          earlier photo stays in Photos and on your profile.
        </p>
      </div>
    )
  }
  if (outcome.kind === "sent") {
    return (
      <div
        role="status"
        className="flex flex-col gap-1 text-body-touch md:text-body-sm"
      >
        <p className="font-medium text-positive">
          {outcome.alreadySent
            ? "These photos were already sent. Nothing was sent twice."
            : `Sent ${plural(outcome.sent, "photo", "photos")} for review.`}
        </p>
        {outcome.skipped > 0 ? (
          <p>
            {plural(outcome.skipped, "photo wasn't", "photos weren't")} sent.
            See the reason under each one.
          </p>
        ) : null}
        {!outcome.alreadySent ? (
          <p className="text-muted-foreground">
            They&apos;re already in your portfolio and Explore. Review only
            decides whether they count.
          </p>
        ) : null}
      </div>
    )
  }
  const { copy } = outcome
  const retry = copy.action === "retry"
  const action =
    copy.action === "retry" ? (
      <Button
        variant="secondary"
        size="touch"
        onClick={onRetry}
        disabled={retrying}
      >
        <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
        Try again
      </Button>
    ) : copy.action === "reload" ? (
      <Button variant="secondary" size="touch" onClick={onReload}>
        <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
        Reload
      </Button>
    ) : copy.action === "sign_in" ? (
      <Link
        href={signInHref}
        className={buttonVariants({ variant: "secondary", size: "touch" })}
      >
        Sign in
      </Link>
    ) : undefined
  return (
    <Notice
      tone="negative"
      role="alert"
      title={
        retry
          ? replacing
            ? "We couldn't send your photo"
            : "We couldn't send your photos"
          : undefined
      }
      action={action}
    >
      {retry
        ? "Check your connection and try again. Nothing is sent twice."
        : copy.message}
    </Notice>
  )
}
