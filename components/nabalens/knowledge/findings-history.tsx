"use client"

import * as React from "react"
import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"
import { staffCaptureHref } from "@/lib/amenities/contract"
import {
  findingKey,
  type FindingSummary,
  type FindingsPage,
  type KnowledgeResult,
} from "@/lib/knowledge-client/contract"

import { DiscardDraftDialog } from "../amenities/capture/knowledge-fields"
import { Notice } from "../notice"
import { CountBadge, StatusChip } from "../status-chip"
import {
  dateAndTime,
  FINDING_STATE_CHIP,
  findingExplanation,
  KNOWLEDGE_ANSWER_LABEL,
  recognitionLine,
} from "./copy"

export const YOUR_FINDINGS_HEADING_ID = "your-findings-heading"

export const YOUR_FINDINGS_COPY = {
  title: "Your findings",
  intro: "Findings you've sent about your venue, and what happened to them.",
  empty: "Findings you send about your venue show here.",
  emptyAction: "See amenity checks",
  loading: "Loading your findings…",
  failed: "We couldn't load your findings.",
  discardFailed: "We couldn't discard this draft. Try again.",
  moved: (venue: string) => `You've moved to ${venue}; this stays as it was.`,
  draftElsewhere: (oldVenue: string, venue: string) =>
    `This draft is for ${oldVenue}. You can't send it now that you work at ${venue}.`,
  hidden: (venue: string) =>
    `Findings from ${venue} aren't shown since you moved venue. Your manager there can still see them.`,
} as const

type Load = (input: {
  cursor: string
}) => Promise<KnowledgeResult<{ page: FindingsPage }>>
type Discard = (input: {
  checkId: string
}) => Promise<KnowledgeResult<Record<never, never>>>

function rowKey(finding: FindingSummary): string {
  return finding.findingRef
    ? findingKey(finding.findingRef)
    : `${finding.kind}:${finding.checkId}:${finding.sentAt ?? finding.savedAt ?? ""}`
}

const rowId = (key: string) => `finding-${key.replace(/[^\w-]/g, "-")}`

/**
 * Me's "Your findings" (B01-06, design §4.5): what I sent about my venue and
 * what happened to it, newest first, with drafts and closed assignments. One
 * action per row. Rows from a venue I've left stay, read-only. The cursor is
 * the server's and is passed back untouched.
 */
export function YourFindings({
  initial,
  venue,
  loadMore,
  discardDraft,
  retryHref = "/staff",
  homeHref = "/staff/tasks",
}: {
  /** The first page; null when it couldn't be read. */
  initial: FindingsPage | null
  /** Where I work now; rows elsewhere are read-only. */
  venue: { id: string; name: string } | null
  loadMore: Load
  discardDraft?: Discard
  retryHref?: string
  homeHref?: string
}) {
  const [items, setItems] = React.useState(initial?.items ?? [])
  const [cursor, setCursor] = React.useState(initial?.nextCursor ?? null)
  const [hidden, setHidden] = React.useState(initial?.hiddenEarlierVenues ?? [])
  const [status, setStatus] = React.useState<"idle" | "loading" | "failed">(
    "idle"
  )
  const [focusKey, setFocusKey] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (focusKey) document.getElementById(rowId(focusKey))?.focus()
  }, [focusKey])

  async function more() {
    if (!cursor || status === "loading") return
    setStatus("loading")
    let result: Awaited<ReturnType<Load>> | null = null
    try {
      result = await loadMore({ cursor })
    } catch {
      result = null
    }
    if (!result?.ok) {
      // Keep what is loaded; the retry sits under it.
      setStatus("failed")
      return
    }
    const known = new Set(items.map(rowKey))
    const fresh = result.page.items.filter((item) => !known.has(rowKey(item)))
    setItems((current) => [...current, ...fresh])
    setCursor(result.page.nextCursor)
    setHidden(result.page.hiddenEarlierVenues)
    setStatus("idle")
    // The button may go: move to the first new row.
    if (fresh[0]) setFocusKey(rowKey(fresh[0]))
  }

  const asked = items.filter((item) => item.state === "needs_attention").length

  return (
    <section
      aria-labelledby={YOUR_FINDINGS_HEADING_ID}
      className="grid scroll-mt-4 gap-3 pt-2"
    >
      <div className="grid gap-1 px-1">
        <h2
          id={YOUR_FINDINGS_HEADING_ID}
          aria-label={
            asked > 0
              ? `${YOUR_FINDINGS_COPY.title}, ${asked} needs attention`
              : YOUR_FINDINGS_COPY.title
          }
          className="flex items-center gap-2 font-display text-section-title text-ink"
        >
          {YOUR_FINDINGS_COPY.title}
          <CountBadge count={asked} label="needs attention" />
        </h2>
        <p className="text-body text-ink-muted">{YOUR_FINDINGS_COPY.intro}</p>
      </div>

      {initial === null ? (
        <Notice
          tone="negative"
          action={
            <Link
              href={retryHref}
              className={buttonVariants({
                variant: "secondary",
                size: "touch",
              })}
            >
              Try again
            </Link>
          }
        >
          {YOUR_FINDINGS_COPY.failed}
        </Notice>
      ) : items.length === 0 && hidden.length === 0 ? (
        <div className="grid justify-items-start gap-3 rounded-card bg-surface p-4 shadow-card">
          <p className="text-body text-ink">{YOUR_FINDINGS_COPY.empty}</p>
          <Link
            href={homeHref}
            className={buttonVariants({ variant: "secondary", size: "touch" })}
          >
            {YOUR_FINDINGS_COPY.emptyAction}
          </Link>
        </div>
      ) : (
        <>
          {items.length > 0 ? (
            <ul
              aria-label={YOUR_FINDINGS_COPY.title}
              className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
            >
              {items.map((finding) => {
                const key = rowKey(finding)
                return (
                  <FindingRow
                    key={key}
                    id={rowId(key)}
                    finding={finding}
                    venue={venue}
                    onDiscard={
                      discardDraft
                        ? async () => {
                            const result = await discardDraft({
                              checkId: finding.checkId,
                            }).catch(() => null)
                            if (!result?.ok) return false
                            setItems((current) =>
                              current.filter((item) => rowKey(item) !== key)
                            )
                            document
                              .getElementById(YOUR_FINDINGS_HEADING_ID)
                              ?.focus()
                            return true
                          }
                        : undefined
                    }
                  />
                )
              })}
            </ul>
          ) : null}
          {hidden.map(({ name }) => (
            <p key={name} className="px-1 text-meta text-ink-muted">
              {YOUR_FINDINGS_COPY.hidden(name)}
            </p>
          ))}
          {status === "failed" ? (
            <Notice
              tone="negative"
              action={
                <Button
                  type="button"
                  variant="secondary"
                  size="touch"
                  onClick={() => void more()}
                >
                  Try again
                </Button>
              }
            >
              {YOUR_FINDINGS_COPY.failed}
            </Notice>
          ) : cursor ? (
            <Button
              type="button"
              variant="secondary"
              size="touch"
              className="justify-self-start max-sm:w-full"
              aria-busy={status === "loading"}
              disabled={status === "loading"}
              onClick={() => void more()}
            >
              {status === "loading" ? YOUR_FINDINGS_COPY.loading : "Show more"}
            </Button>
          ) : null}
        </>
      )}
    </section>
  )
}

function FindingRow({
  id,
  finding,
  venue,
  onDiscard,
}: {
  id: string
  finding: FindingSummary
  venue: { id: string; name: string } | null
  /** Resolves false when the draft couldn't be discarded. */
  onDiscard?: () => Promise<boolean>
}) {
  const [confirming, setConfirming] = React.useState(false)
  const [discardFailed, setDiscardFailed] = React.useState(false)
  const elsewhere = venue !== null && finding.venue.id !== venue.id
  const oldVenue = finding.venue.name || "your earlier venue"
  const draft = finding.state === "saved"
  const stranded = draft && (elsewhere || finding.sendable === false)
  const action =
    elsewhere || stranded
      ? null
      : draft
        ? "Finish"
        : finding.state === "needs_attention"
          ? "Add detail"
          : "View"
  const when = draft
    ? finding.savedAt && `Saved ${dateAndTime(finding.savedAt)}`
    : finding.sentAt && `Sent ${dateAndTime(finding.sentAt)}`
  const credit = recognitionLine(finding.recognition, finding.answer)

  return (
    <li className="grid min-w-0 gap-1.5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3
          id={id}
          tabIndex={-1}
          className="min-w-0 rounded-control text-item-title [overflow-wrap:anywhere] text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          {finding.question}
        </h3>
        <StatusChip state={FINDING_STATE_CHIP[finding.state]} />
      </div>
      {elsewhere && finding.venue.name ? (
        <p className="text-meta font-semibold text-ink-muted">
          {finding.venue.name}
        </p>
      ) : null}
      {finding.answer ? (
        <p className="text-body text-ink">
          Answer: {KNOWLEDGE_ANSWER_LABEL[finding.answer]}
        </p>
      ) : null}
      <p className="text-body [overflow-wrap:anywhere] text-ink">
        {stranded && venue
          ? YOUR_FINDINGS_COPY.draftElsewhere(oldVenue, venue.name)
          : findingExplanation(finding)}
      </p>
      {when ? <p className="text-meta text-ink-muted">{when}</p> : null}
      {credit ? <p className="text-meta text-ink-muted">{credit}</p> : null}
      {elsewhere && !draft && venue ? (
        <p className="text-meta text-ink-muted">
          {YOUR_FINDINGS_COPY.moved(venue.name)}
        </p>
      ) : null}
      {action ? (
        <Link
          href={staffCaptureHref(finding.checkId)}
          aria-label={`${action}: ${finding.question}`}
          className={buttonVariants({
            variant: action === "View" ? "quiet" : "secondary",
            size: "touch",
            className: "justify-self-start max-sm:w-full",
          })}
        >
          {action}
        </Link>
      ) : null}
      {stranded && onDiscard ? (
        <>
          <Button
            type="button"
            variant="quiet"
            size="touch"
            className="justify-self-start"
            aria-label={`Discard draft: ${finding.question}`}
            onClick={() => setConfirming(true)}
          >
            Discard draft
          </Button>
          <DiscardDraftDialog
            open={confirming}
            onOpenChange={setConfirming}
            onDiscard={async () => {
              setDiscardFailed(false)
              if (!(await onDiscard())) setDiscardFailed(true)
            }}
          />
          {discardFailed ? (
            <p role="alert" className="text-meta text-ink">
              {YOUR_FINDINGS_COPY.discardFailed}
            </p>
          ) : null}
        </>
      ) : null}
    </li>
  )
}
