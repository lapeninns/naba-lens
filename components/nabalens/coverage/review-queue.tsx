"use client"

import * as React from "react"
import { CameraRotateIcon, CheckIcon } from "@phosphor-icons/react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { EmptyState } from "@/components/nabalens/empty-state"
import { LoadMoreButton } from "@/components/nabalens/load-more-button"
import { formatDateTime } from "@/components/nabalens/menus/copy"
import { Button } from "@/components/ui/button"

import { CoverageNotice, type Notice } from "./coverage-notice"
import { failureText, needsRefresh, periodKeyLabel } from "./copy"
import { EvidenceThumb } from "./evidence-image"
import { ReasonDialog, type ReasonOutcome } from "./reason-dialog"
import { SubmissionCard, firstName, isOwnPhoto } from "./submission-card"
import type {
  CoverageResult,
  Page,
  PeriodKey,
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

export const REVIEW_EMPTY_COPY =
  "Nothing to review. New photos appear here as they're sent."

/** The reply was lost: the decision may be saved. The request id is kept. */
const NETWORK_ERROR =
  "We couldn't confirm the decision was saved. Check your connection, then try again or refresh to see if it was. The photo won't be reviewed twice."

/** The photo's author as running text: "Priya" or, for your own photo, "you". */
function whoTook(submission: SubmissionView, viewerId: string) {
  return isOwnPhoto(submission, viewerId)
    ? { name: "You", sees: "You see", possessive: "your" }
    : {
        name: firstName(submission.author.displayName),
        sees: `${firstName(submission.author.displayName)} sees`,
        possessive: `${firstName(submission.author.displayName)}'s`,
      }
}

/**
 * Review queue for one venue: accept, or ask for another photo with a reason.
 * Review decides whether a photo counts, never whether it is shared. Each
 * decision carries the revision the reviewer saw, so a decision someone else
 * made first is reported (and the list refreshed) instead of overwritten.
 */
export function ReviewQueue({
  initial,
  viewerId,
  currentPeriod,
  onReview,
  onLoadMore,
  onStale,
  emptyTitle = REVIEW_EMPTY_COPY,
  emptyDescription,
}: {
  initial: Page<SubmissionView>
  viewerId: string
  /** This month, so older photos say which month they count for. */
  currentPeriod?: PeriodKey
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
  const sessionEnded = useSessionEndedCatch()
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
          const reviewedFirst =
            result.code === "revision_conflict" ||
            result.code === "state_conflict"
          setNotice({
            tone: "warning",
            text: reviewedFirst
              ? `Someone else reviewed ${whoTook(submission, viewerId).possessive} photo a moment ago. The latest decision is shown.`
              : text,
          })
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
      const own = isOwnPhoto(submission, viewerId)
      const acceptedText = submission.completionTarget
        ? "Accepted."
        : `Accepted. It counts for ${periodKeyLabel(submission.period)}, the month it was sent.`
      setNotice({
        tone: "success",
        text:
          decision === "accept"
            ? `${acceptedText}${result.submission.selfReview ? " Recorded as a self-review." : ""}`
            : `Asked ${own ? "yourself" : firstName(submission.author.displayName)} for another photo.${result.submission.selfReview ? " Recorded as a self-review." : ""}`,
      })
      return { ok: true }
    } catch (cause) {
      const text = sessionEnded(cause) ?? NETWORK_ERROR
      setItemErrors((current) => ({ ...current, [submission.id]: text }))
      return { ok: false, error: text }
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
    } catch (cause) {
      sessionEnded(cause)
      setLoadError("More photos could not load. Try again.")
    } finally {
      setLoading(false)
    }
  }

  const decidable = (submission: SubmissionView) =>
    !!onReview && submission.state === "submitted" && !submission.archived
  // Only the oldest photo waiting for a decision gets the primary Accept.
  const oldestId = items
    .filter(decidable)
    .reduce<SubmissionView | null>(
      (oldest, item) =>
        !oldest || item.submittedAt < oldest.submittedAt ? item : oldest,
      null
    )?.id
  const asker = asking ? whoTook(asking, viewerId) : null

  return (
    <div className="grid min-w-0 gap-(--gutter)">
      <CoverageNotice
        ref={noticeRef}
        notice={notice}
        onDismiss={() => setNotice(null)}
      />
      {items.length === 0 ? (
        <EmptyState
          variant={emptyTitle === REVIEW_EMPTY_COPY ? "done" : "filtered"}
          title={emptyTitle}
          description={emptyDescription}
          inline
        />
      ) : (
        <>
          <ul
            ref={listRef}
            tabIndex={-1}
            aria-label="Photos"
            className="@container grid w-full max-w-(--size-feed) gap-(--gutter) outline-none"
          >
            {items.map((submission) => {
              const busy = pendingId === submission.id
              return (
                <li key={submission.id}>
                  <SubmissionCard
                    submission={submission}
                    viewerId={viewerId}
                    currentPeriod={currentPeriod}
                    actions={
                      decidable(submission) ? (
                        <div className="grid gap-2 pt-1">
                          {/* A deleted photo cannot count; it can only be replaced. */}
                          {submission.asset.available ? (
                            <Button
                              size="touch"
                              variant={
                                submission.id === oldestId
                                  ? "primary"
                                  : "secondary"
                              }
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
                            variant="secondary"
                            disabled={pendingId !== null}
                            onClick={() => setAsking(submission)}
                          >
                            <CameraRotateIcon
                              data-icon="inline-start"
                              aria-hidden
                            />
                            Ask for another photo
                          </Button>
                        </div>
                      ) : null
                    }
                    footer={
                      itemErrors[submission.id] ? (
                        <p
                          role="alert"
                          className="text-body font-semibold text-warn-fg"
                        >
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
        label="Reason"
        help={
          asker
            ? `${asker.sees} this with the photo. Say what to change.`
            : undefined
        }
        emptyError={
          asker
            ? `Add a reason. ${asker.name} ${asker.name === "You" ? "see" : "sees"} it with the photo.`
            : undefined
        }
        note={
          asker
            ? `Decisions are final. The photo stays in Photos and on ${asker.possessive} profile.`
            : undefined
        }
        confirmLabel="Ask for another photo"
        confirmIcon={<CameraRotateIcon data-icon="inline-start" aria-hidden />}
        pendingLabel="Saving…"
        onConfirm={async (reason) => {
          if (!asking) return { ok: false, error: "Choose a photo first." }
          return decide(asking, "needs_another_photo", reason)
        }}
        reportFocus={() => noticeRef.current ?? listRef.current}
        reportFocusOnSuccess
      >
        {asking ? (
          <div className="flex items-center gap-3">
            <EvidenceThumb
              src={asking.asset.available ? asking.asset.thumbnailUrl : null}
              className="aspect-square w-16 shrink-0"
            />
            <p className="min-w-0 text-body">
              <strong className="font-bold [overflow-wrap:anywhere] text-ink">
                {asking.requirement
                  ? (asking.requirement.title ?? "Checklist item")
                  : "Monthly photo"}
              </strong>
              <br />
              <span className="text-ink-muted">
                {isOwnPhoto(asking, viewerId)
                  ? "You"
                  : asking.author.displayName}{" "}
                · submitted {formatDateTime(asking.submittedAt)}
              </span>
            </p>
          </div>
        ) : null}
      </ReasonDialog>
    </div>
  )
}
