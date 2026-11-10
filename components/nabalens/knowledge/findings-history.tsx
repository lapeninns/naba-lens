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

import { clearDraft } from "../amenities/capture/draft"
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
  discarded: "Draft discarded.",
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

/** What the server's first page says; a refresh that changes it re-seeds. */
function pageSignature(page: FindingsPage | null): string {
  if (!page) return ""
  return JSON.stringify([
    page.items.map((item) => [
      rowKey(item),
      item.state,
      item.sentAt,
      item.savedAt,
    ]),
    page.nextCursor,
    page.hiddenEarlierVenues.map((v) => v.name),
  ])
}

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
  onDiscardDraft,
  viewerId = null,
  retryHref = "/staff",
  homeHref = "/staff/tasks",
}: {
  /** The first page; null when it couldn't be read. */
  initial: FindingsPage | null
  /** Where I work now; rows elsewhere are read-only. */
  venue: { id: string; name: string } | null
  loadMore: Load
  onDiscardDraft?: Discard
  /** The signed-in person: a discard also clears this device's copy. */
  viewerId?: string | null
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
  const [announcement, setAnnouncement] = React.useState("")
  const retryRef = React.useRef<HTMLButtonElement>(null)

  // A refresh (after a delete or a label change on Me) brings a new first
  // page: show it, not the rows first loaded (HM-09).
  const signature = pageSignature(initial)
  const [seeded, setSeeded] = React.useState(signature)
  if (signature !== seeded) {
    setSeeded(signature)
    setItems(initial?.items ?? [])
    setCursor(initial?.nextCursor ?? null)
    setHidden(initial?.hiddenEarlierVenues ?? [])
    setStatus("idle")
  }

  React.useEffect(() => {
    if (focusKey) document.getElementById(rowId(focusKey))?.focus()
  }, [focusKey])

  React.useEffect(() => {
    if (status === "failed") retryRef.current?.focus()
  }, [status])

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
      // Keep what is loaded; the retry sits under it and takes focus.
      setStatus("failed")
      return
    }
    const known = new Set(items.map(rowKey))
    const fresh = result.page.items.filter((item) => !known.has(rowKey(item)))
    setItems((current) => [...current, ...fresh])
    setCursor(result.page.nextCursor)
    setHidden(result.page.hiddenEarlierVenues)
    setStatus("idle")
    // The button may go: move to the first new row, else the heading when
    // the button went with nothing new (HM-06).
    if (fresh[0]) setFocusKey(rowKey(fresh[0]))
    else if (!result.page.nextCursor)
      requestAnimationFrame(() =>
        document.getElementById(YOUR_FINDINGS_HEADING_ID)?.focus()
      )
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
          // Focus lands here after a discard removes the row (L2).
          tabIndex={-1}
          aria-label={
            asked > 0
              ? `${YOUR_FINDINGS_COPY.title}, ${asked} needs attention`
              : YOUR_FINDINGS_COPY.title
          }
          className="flex items-center gap-2 rounded-control font-display text-section-title text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
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
                      onDiscardDraft
                        ? async () => {
                            const result = await onDiscardDraft({
                              checkId: finding.checkId,
                            }).catch(() => null)
                            if (!result?.ok) return false
                            // The capture form's copy on this device too,
                            // or opening the question would restore it (L1).
                            if (viewerId)
                              clearDraft({
                                userId: viewerId,
                                checkId: finding.checkId,
                              })
                            setItems((current) =>
                              current.filter((item) => rowKey(item) !== key)
                            )
                            setAnnouncement(YOUR_FINDINGS_COPY.discarded)
                            // After the row and its dialog are gone.
                            requestAnimationFrame(() =>
                              document
                                .getElementById(YOUR_FINDINGS_HEADING_ID)
                                ?.focus()
                            )
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
                  ref={retryRef}
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
              // aria-disabled keeps focus on it while loading (HM-06).
              aria-disabled={status === "loading" || undefined}
              onClick={() => void more()}
            >
              {status === "loading" ? YOUR_FINDINGS_COPY.loading : "Show more"}
            </Button>
          ) : null}
        </>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
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
