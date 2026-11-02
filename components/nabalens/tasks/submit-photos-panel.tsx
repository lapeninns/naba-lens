"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowClockwiseIcon,
  CameraIcon,
  PaperPlaneTiltIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"

import { LoadMoreButton } from "../load-more-button"
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
    }
  | { kind: "failed"; copy: FailureCopy }

type SubmitPhotosPanelProps = {
  /** The task, or null for a monthly-only submission (no task). */
  requirementId: string | null
  /** The "needs another photo" item this send answers, if any. */
  replacesSubmissionId?: string | null
  /** The first page of photos, as loaded by the page. */
  initialPhotos: SubmittablePhotosResult
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
}

function initialState(result: SubmittablePhotosResult): PhotoList {
  return result.ok
    ? { photos: result.items, nextCursor: result.nextCursor, error: null }
    : { photos: [], nextCursor: null, error: failureCopy(result).message }
}

/**
 * Capture or choose own ready photos and send them for review. Uploads go
 * through the existing pipeline (UploadDialog) and newly ready photos are
 * selected automatically. Each send carries one request ID per intent, so a
 * retry after a dropped connection replays instead of sending twice.
 */
export function SubmitPhotosPanel({
  requirementId,
  replacesSubmissionId = null,
  initialPhotos,
  loadPhotos,
  submit,
  uploader,
  limits,
  onReload,
  signInHref,
}: SubmitPhotosPanelProps) {
  const monthly = requirementId === null
  const maxSelected = limits.maxBatchFiles
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

  const reloadFirstPage = React.useCallback(
    async (select: string[] = []) => {
      let result: SubmittablePhotosResult
      try {
        result = await loadPhotos({ requirementId, cursor: null })
      } catch {
        setList((l) => ({ ...l, error: NETWORK_FAILURE.message }))
        return
      }
      if (!result.ok) {
        setList((l) => ({ ...l, error: failureCopy(result).message }))
        return
      }
      setList({
        photos: result.items,
        nextCursor: result.nextCursor,
        error: null,
      })
      // The fresh listing is authoritative for the photos it includes.
      const listed = new Set(result.items.map((p) => p.assetId))
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
    },
    [loadPhotos, requirementId, maxSelected]
  )

  async function loadMore() {
    if (!list.nextCursor) return
    setLoadingMore(true)
    try {
      const result = await loadPhotos({
        requirementId,
        cursor: list.nextCursor,
      })
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
          }
        })
      } else {
        setList((l) => ({ ...l, error: failureCopy(result).message }))
      }
    } catch {
      setList((l) => ({ ...l, error: NETWORK_FAILURE.message }))
    } finally {
      setLoadingMore(false)
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
    if (inFlight.current || selected.length === 0) return
    inFlight.current = true
    const assetIds = selected
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          size="touch"
          variant="outline"
          onClick={() => setUploadOpen(true)}
        >
          <CameraIcon data-icon="inline-start" aria-hidden />
          Take or upload photos
        </Button>
        <p className="text-sm text-muted-foreground">
          New photos are selected for you once they&apos;re ready.
        </p>
      </div>

      <div aria-live="polite" className="text-sm empty:hidden">
        {uploadNote ? <p>{uploadNote}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Or choose from your photos</h3>
        <p className="text-sm text-muted-foreground">
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
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {monthly
            ? "No photos from this month yet. Take or upload one to get started."
            : "No photos yet. Take or upload one to get started."}
        </p>
      )}

      <LoadMoreButton
        hasMore={list.nextCursor !== null}
        loading={loadingMore}
        error={list.error}
        onLoadMore={() =>
          list.photos.length === 0 && list.error
            ? void reloadFirstPage()
            : void loadMore()
        }
      />

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-col gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <OutcomeMessage
          outcome={outcome}
          onRetry={() => void send()}
          onReload={onReload}
          signInHref={signInHref}
          retrying={sending}
        />
        <Button
          size="touch"
          onClick={() => void send()}
          disabled={count === 0 || sending}
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
            : count === 0
              ? "Select photos to send"
              : `Send ${plural(count, "photo", "photos")} for review`}
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
}: {
  outcome: Outcome | null
  onRetry: () => void
  onReload: () => void
  signInHref: string
  retrying: boolean
}) {
  if (!outcome) return null
  if (outcome.kind === "sent") {
    return (
      <div role="status" className="flex flex-col gap-1 text-sm">
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
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-col gap-2 text-destructive">
        <p>{copy.message}</p>
        {copy.action === "retry" ? (
          <Button
            variant="outline"
            size="touch"
            onClick={onRetry}
            disabled={retrying}
            className="self-start"
          >
            <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
            Try again
          </Button>
        ) : copy.action === "reload" ? (
          <Button
            variant="outline"
            size="touch"
            onClick={onReload}
            className="self-start"
          >
            <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
            Reload
          </Button>
        ) : copy.action === "sign_in" ? (
          <Link
            href={signInHref}
            className={buttonVariants({
              variant: "outline",
              size: "touch",
              className: "self-start",
            })}
          >
            Sign in
          </Link>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
