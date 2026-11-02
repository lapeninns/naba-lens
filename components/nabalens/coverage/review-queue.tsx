"use client"

import * as React from "react"
import { CheckIcon, CameraIcon } from "@phosphor-icons/react"

import { EmptyState } from "@/components/nabalens/empty-state"
import { LoadMoreButton } from "@/components/nabalens/load-more-button"
import { Button } from "@/components/ui/button"

import { CoverageNotice, type Notice } from "./coverage-notice"
import { failureText, needsRefresh, SHARING_COPY } from "./copy"
import { EvidenceThumb } from "./evidence-image"
import { ReasonDialog, type ReasonOutcome } from "./reason-dialog"
import { SubmissionCard, isOwnPhoto } from "./submission-card"
import type {
  CoverageResult,
  Page,
  ReviewDecision,
  ReviewedSubmission,
  SubmissionView,
} from "./types"
import { REPORTED } from "./use-coverage-action"
import { useRequestIds } from "./use-request-id"

export type ReviewInput = {
  requestId: string
  submissionId: string
  expectedRevision: number
  decision: ReviewDecision
  reason?: string
}

export type ReviewHandler = (
  input: ReviewInput
) => Promise<
  CoverageResult<{ submission: ReviewedSubmission; replayed: boolean }>
>

export type LoadSubmissionsHandler = (
  cursor: string
) => Promise<CoverageResult<Page<SubmissionView>>>

const NETWORK_ERROR =
  "Could not reach the server. Check your connection and try again; the photo will not be reviewed twice."

/**
 * Review queue for one venue: accept, or ask for another photo with a reason.
 * Each decision carries the revision the reviewer saw, so a decision someone
 * else made first is reported (and the list refreshed) instead of overwritten.
 */
export function ReviewQueue({
  initial,
  viewerId,
  onReview,
  onLoadMore,
  onStale,
  emptyTitle = "Nothing to review.",
  emptyDescription = "Submitted photos appear here, oldest first.",
}: {
  initial: Page<SubmissionView>
  viewerId: string
  /** Omit for a read-only list. */
  onReview?: ReviewHandler
  onLoadMore?: LoadSubmissionsHandler
  /** Re-read the page after a stale or refused change (successful writes re-render it). */
  onStale?: () => void
  emptyTitle?: string
  emptyDescription?: string
}) {
  const [seed, setSeed] = React.useState(initial)
  const [items, setItems] = React.useState(initial.items)
  const [cursor, setCursor] = React.useState(initial.nextCursor)
  if (seed !== initial) {
    setSeed(initial)
    setItems(initial.items)
    setCursor(initial.nextCursor)
  }
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [itemErrors, setItemErrors] = React.useState<Record<string, string>>({})
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [asking, setAsking] = React.useState<SubmissionView | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const noticeRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLUListElement>(null)
  const focusNoticeRef = React.useRef(false)
  const intents = useRequestIds()

  React.useEffect(() => {
    if (!focusNoticeRef.current) return
    focusNoticeRef.current = false
    noticeRef.current?.focus()
  }, [notice])

  /** Shows the decision straight away; the refresh that follows brings the full record. */
  function applyDecision(
    submission: SubmissionView,
    reviewed: ReviewedSubmission,
    decision: ReviewDecision,
    reason: string | undefined
  ) {
    const updated: SubmissionView = {
      ...submission,
      state: reviewed.state,
      revision: reviewed.revision,
      decision: {
        decision,
        reason: reason ?? null,
        decidedAt: new Date().toISOString(),
        decidedBy: { id: viewerId, displayName: null },
        selfReview: reviewed.selfReview,
        lateAcceptance: false,
      },
    }
    setItems((current) =>
      current.map((item) => (item.id === updated.id ? updated : item))
    )
  }

  async function decide(
    submission: SubmissionView,
    decision: ReviewDecision,
    reason?: string
  ): Promise<ReasonOutcome> {
    if (!onReview) return { ok: false, error: "Reviewing is not available." }
    const scope = `review:${submission.id}`
    const payload = {
      submissionId: submission.id,
      expectedRevision: submission.revision,
      decision,
      reason: reason ?? null,
    }
    const requestId = intents.requestIdFor(scope, payload)
    setPendingId(submission.id)
    setItemErrors((current) => {
      const next = { ...current }
      delete next[submission.id]
      return next
    })
    try {
      const result = await onReview({
        requestId,
        submissionId: submission.id,
        expectedRevision: submission.revision,
        decision,
        ...(reason ? { reason } : {}),
      })
      if (!result.ok) {
        if (result.code !== "unavailable") intents.settle(scope)
        const text = failureText(result)
        if (needsRefresh(result)) {
          // The refresh may remove the card. Accept has no dialog, so focus
          // moves here; the reason dialog moves it itself when it closes.
          focusNoticeRef.current = decision === "accept"
          setNotice({ tone: "warning", text })
          onStale?.()
          return REPORTED
        }
        setItemErrors((current) => ({ ...current, [submission.id]: text }))
        return {
          ok: false,
          error: text,
          fieldError: result.fieldErrors?.reason,
        }
      }
      intents.settle(scope)
      applyDecision(submission, result.submission, decision, reason)
      // The card's buttons are gone now (see the refresh branch above).
      focusNoticeRef.current = decision === "accept"
      const name = submission.author.displayName
      setNotice({
        tone: "success",
        text:
          decision === "accept"
            ? `Accepted ${isOwnPhoto(submission, viewerId) ? "your" : `${name}’s`} photo${result.submission.selfReview ? " (recorded as self-review)" : ""}.`
            : `Asked ${isOwnPhoto(submission, viewerId) ? "yourself" : name} for another photo.`,
      })
      return { ok: true }
    } catch {
      setItemErrors((current) => ({
        ...current,
        [submission.id]: NETWORK_ERROR,
      }))
      return { ok: false, error: NETWORK_ERROR }
    } finally {
      setPendingId(null)
    }
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
        const seen = new Set(current.map((item) => item.id))
        return [
          ...current,
          ...result.items.filter((item) => !seen.has(item.id)),
        ]
      })
      setCursor(result.nextCursor)
    } catch {
      setLoadError("More photos could not load. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-4">
      <CoverageNotice
        ref={noticeRef}
        notice={notice}
        onDismiss={() => setNotice(null)}
      />
      {items.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          {onReview ? (
            <p className="max-w-prose text-sm text-muted-foreground">
              {SHARING_COPY}
            </p>
          ) : null}
          <ul
            ref={listRef}
            tabIndex={-1}
            aria-label="Photos"
            className="grid gap-4 outline-none sm:grid-cols-2 lg:grid-cols-3"
          >
            {items.map((submission) => {
              const busy = pendingId === submission.id
              const canDecide =
                !!onReview &&
                submission.state === "submitted" &&
                !submission.archived
              return (
                <li key={submission.id}>
                  <SubmissionCard
                    submission={submission}
                    viewerId={viewerId}
                    className="h-full"
                    actions={
                      canDecide ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          {/* A deleted photo cannot count; it can only be replaced. */}
                          {submission.asset.available ? (
                            <Button
                              size="touch"
                              className="sm:flex-1"
                              disabled={pendingId !== null}
                              aria-busy={busy || undefined}
                              onClick={() => void decide(submission, "accept")}
                            >
                              <CheckIcon data-icon="inline-start" aria-hidden />
                              {busy ? "Saving…" : "Accept"}
                            </Button>
                          ) : null}
                          <Button
                            size="touch"
                            variant="outline"
                            className="sm:flex-1"
                            disabled={pendingId !== null}
                            onClick={() => setAsking(submission)}
                          >
                            <CameraIcon data-icon="inline-start" aria-hidden />
                            Needs another photo
                          </Button>
                        </div>
                      ) : null
                    }
                    footer={
                      itemErrors[submission.id] ? (
                        <p role="alert" className="text-sm text-negative">
                          {itemErrors[submission.id]}
                        </p>
                      ) : null
                    }
                  />
                </li>
              )
            })}
          </ul>
          {onLoadMore ? (
            <LoadMoreButton
              hasMore={!!cursor}
              loading={loading}
              error={loadError}
              onLoadMore={loadMore}
              shownCount={items.length}
            />
          ) : null}
        </>
      )}
      <ReasonDialog
        open={!!asking}
        onOpenChange={(open) => {
          if (!open) setAsking(null)
        }}
        title="Ask for another photo"
        description={
          asking
            ? `${asking.author.displayName} sees your reason and can submit a replacement. This photo stays in their portfolio.`
            : undefined
        }
        label="Reason"
        help="Say what the next photo needs, for example the angle, lighting or what is missing."
        confirmLabel="Ask for another photo"
        pendingLabel="Saving…"
        onConfirm={async (reason) => {
          if (!asking) return { ok: false, error: "Choose a photo first." }
          return decide(asking, "needs_another_photo", reason)
        }}
        reportFocus={() => noticeRef.current ?? listRef.current}
        reportFocusOnSuccess
      >
        {asking ? (
          <EvidenceThumb
            src={asking.asset.thumbnailUrl}
            className="mx-auto max-w-48"
          />
        ) : null}
      </ReasonDialog>
    </div>
  )
}
