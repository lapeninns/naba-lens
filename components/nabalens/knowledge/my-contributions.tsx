"use client"

import * as React from "react"
import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"
import type { ContributionsFeedPage } from "@/lib/knowledge/contract"
import type { FindingSummary } from "@/lib/knowledge-client/contract"
import {
  contributionRows,
  type ContributionRow,
  type MenuReviewLine,
  type PhotoContributionRow,
  type TaskSendContributionRow,
} from "@/lib/work-client/contributions"

import { clearDraft } from "../amenities/capture/draft"
import { Notice } from "../notice"
import { CountBadge } from "../status-chip"
import { dateAndTime, shortDate } from "./copy"
import { FindingRow, rowId, rowKey } from "./findings-history"

export const MY_CONTRIBUTIONS_HEADING_ID = "my-contributions-heading"

export const MY_CONTRIBUTIONS_COPY = {
  title: "My contributions",
  intro:
    "Photos, task photos and findings you've sent, and what happened to them.",
  empty: "Photos, task photos and findings you send show here.",
  drafts: "Drafts",
  draftsFailed: "We couldn't load your drafts.",
  loading: "Loading your contributions…",
  failed: "We couldn't load your contributions.",
  discardFailed: "We couldn't discard this draft. Try again.",
  discarded: "Draft discarded.",
  photo: "Photo",
  video: "Video",
  taskPhoto: "Task photo",
  upload: {
    saving: "Upload: Saving",
    not_finished: "Upload: Didn't finish",
    saved: "Upload: Saved",
  },
  labels: {
    needs_labels: "Labels: Needs labels",
    labelled: "Labels: Labelled",
    needs_attention: "Labels: Label needs attention",
  },
  menuReview: (line: MenuReviewLine) => {
    switch (line.state) {
      case "accepted":
        return `${line.item}: Accepted for menu use`
      case "better_photo_requested":
        return line.reason
          ? `${line.item}: Asked for a better photo: ${line.reason}`
          : `${line.item}: Asked for a better photo`
      case "needs_recheck":
        return `${line.item}: Needs a recheck`
      case "waiting":
        return `${line.item}: Waiting`
    }
  },
  offMenu: "This item isn't on the current menu, so no new photo is needed",
  menuUse: "Accepted for menu use",
  oneOfSet: (n: number) => `One of a set of ${n}`,
  taskReview: (row: TaskSendContributionRow) =>
    row.review === "waiting"
      ? "Review: Waiting"
      : row.review === "accepted"
        ? "Review: Accepted"
        : row.reason
          ? `Review: Needs another photo: ${row.reason}`
          : "Review: Needs another photo",
  revision: (n: number) => `Revision ${n}`,
  replaces: (sentAt: string) => `Replaces your photo sent ${shortDate(sentAt)}`,
  replacedEarlier: (sentAt: string) =>
    `Replaced your earlier finding of ${dateAndTime(sentAt)}`,
  sent: (sentAt: string) => `Sent ${dateAndTime(sentAt)}`,
} as const

type LoadMore = (input: {
  cursor: string
}) => Promise<
  { ok: true; page: ContributionsFeedPage } | { ok: false; message: string }
>
type Discard = (input: { checkId: string }) => Promise<{ ok: boolean }>

const contributionId = (key: string) =>
  `contribution-${key.replace(/[^\w-]/g, "-")}`

/** What the server's first page says; a refresh that changes it re-seeds. */
function signature(
  page: ContributionsFeedPage | null,
  drafts: readonly FindingSummary[] | null
): string {
  return JSON.stringify([page, drafts?.map(rowKey) ?? null])
}

/**
 * Me's My contributions (UI design §6.1): my photos, task photo sends and
 * findings in the server's send-time order, 20 a page, with my drafts above.
 * Each dimension has its own line; nothing is re-sorted here.
 */
export function MyContributions({
  initial,
  drafts,
  venue,
  offMenuPhotoIds = [],
  loadMore,
  onDiscardDraft,
  viewerId = null,
  retryHref = "/staff",
}: {
  /** The first page; null when it couldn't be read. */
  initial: ContributionsFeedPage | null
  /** B01's drafts; null when they couldn't be read. */
  drafts: FindingSummary[] | null
  /** Where I work now; rows elsewhere name their venue. */
  venue: { id: string; name: string } | null
  /** Better-photo requests for items no longer on the menu (D13). */
  offMenuPhotoIds?: readonly string[]
  loadMore: LoadMore
  onDiscardDraft?: Discard
  viewerId?: string | null
  retryHref?: string
}) {
  const [items, setItems] = React.useState(initial?.items ?? [])
  const [cursor, setCursor] = React.useState(initial?.nextCursor ?? null)
  const [draftRows, setDraftRows] = React.useState(drafts ?? [])
  const [status, setStatus] = React.useState<"idle" | "loading" | "failed">(
    "idle"
  )
  const [focusKey, setFocusKey] = React.useState<string | null>(null)
  const [announcement, setAnnouncement] = React.useState("")
  const retryRef = React.useRef<HTMLButtonElement>(null)

  // A refresh brings a new first page: show it, not the rows first loaded
  // (HM-09).
  const seed = signature(initial, drafts)
  const [seeded, setSeeded] = React.useState(seed)
  if (seed !== seeded) {
    setSeeded(seed)
    setItems(initial?.items ?? [])
    setCursor(initial?.nextCursor ?? null)
    setDraftRows(drafts ?? [])
    setStatus("idle")
  }

  React.useEffect(() => {
    if (focusKey) document.getElementById(contributionId(focusKey))?.focus()
  }, [focusKey])

  React.useEffect(() => {
    if (status === "failed") retryRef.current?.focus()
  }, [status])

  const offMenu = React.useMemo(
    () => new Set(offMenuPhotoIds),
    [offMenuPhotoIds]
  )
  const rows = React.useMemo(
    () => contributionRows(items, offMenu),
    [items, offMenu]
  )

  async function more() {
    if (!cursor || status === "loading") return
    setStatus("loading")
    const result = await loadMore({ cursor }).catch(() => null)
    if (!result?.ok) {
      // Keep what is loaded; the retry sits under it and takes focus (HM-06).
      setStatus("failed")
      return
    }
    const known = new Set(items.map((item) => item.key))
    const fresh = result.page.items.filter((item) => !known.has(item.key))
    setItems((current) => [...current, ...fresh])
    setCursor(result.page.nextCursor)
    setStatus("idle")
    if (fresh[0]) setFocusKey(fresh[0].key)
    else if (!result.page.nextCursor)
      requestAnimationFrame(() =>
        document.getElementById(MY_CONTRIBUTIONS_HEADING_ID)?.focus()
      )
  }

  const asked = rows.filter(
    (row) => row.type === "finding" && row.finding.state === "needs_attention"
  ).length
  const copy = MY_CONTRIBUTIONS_COPY

  return (
    <section
      aria-labelledby={MY_CONTRIBUTIONS_HEADING_ID}
      className="grid scroll-mt-4 gap-3 pt-2"
    >
      <div className="grid gap-1 px-1">
        <h2
          id={MY_CONTRIBUTIONS_HEADING_ID}
          tabIndex={-1}
          aria-label={
            asked > 0 ? `${copy.title}, ${asked} needs attention` : copy.title
          }
          className="flex items-center gap-2 rounded-control font-display text-section-title text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          {copy.title}
          <CountBadge count={asked} label="needs attention" />
        </h2>
        <p className="text-body text-ink-muted">{copy.intro}</p>
      </div>

      {drafts === null ? (
        <p className="px-1 text-meta text-ink-muted">{copy.draftsFailed}</p>
      ) : draftRows.length > 0 ? (
        <ul
          aria-label={copy.drafts}
          className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
        >
          {draftRows.map((draft) => {
            const key = rowKey(draft)
            return (
              <FindingRow
                key={key}
                id={rowId(key)}
                finding={draft}
                venue={venue}
                onDiscard={
                  onDiscardDraft
                    ? async () => {
                        const result = await onDiscardDraft({
                          checkId: draft.checkId,
                        }).catch(() => null)
                        if (!result?.ok) return false
                        // The capture form's copy on this device too.
                        if (viewerId)
                          clearDraft({
                            userId: viewerId,
                            checkId: draft.checkId,
                          })
                        setDraftRows((current) =>
                          current.filter((row) => rowKey(row) !== key)
                        )
                        setAnnouncement(copy.discarded)
                        requestAnimationFrame(() =>
                          document
                            .getElementById(MY_CONTRIBUTIONS_HEADING_ID)
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
          {copy.failed}
        </Notice>
      ) : rows.length === 0 ? (
        draftRows.length === 0 ? (
          <p className="rounded-card bg-surface p-4 text-body text-ink shadow-card">
            {copy.empty}
          </p>
        ) : null
      ) : (
        <ul
          aria-label={copy.title}
          className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
        >
          {rows.map((row) => (
            <ContributionItem key={row.key} row={row} venue={venue} />
          ))}
        </ul>
      )}

      {initial === null ? null : status === "failed" ? (
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
          {copy.failed}
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
          {status === "loading" ? copy.loading : "Show more"}
        </Button>
      ) : null}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  )
}

function ContributionItem({
  row,
  venue,
}: {
  row: ContributionRow
  venue: { id: string; name: string } | null
}) {
  if (row.type === "finding")
    return (
      <FindingRow
        id={contributionId(row.key)}
        finding={row.finding}
        venue={venue}
      >
        {row.replacedEarlierAt ? (
          <p className="text-meta text-ink-muted">
            {MY_CONTRIBUTIONS_COPY.replacedEarlier(row.replacedEarlierAt)}
          </p>
        ) : null}
      </FindingRow>
    )
  const elsewhere = venue !== null && row.venueId !== venue.id
  return (
    <li className="grid min-w-0 gap-1.5 p-4">
      <h3
        id={contributionId(row.key)}
        tabIndex={-1}
        className="min-w-0 rounded-control text-item-title [overflow-wrap:anywhere] text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
      >
        {titleOf(row)}
      </h3>
      {elsewhere && row.venueName ? (
        <p className="text-meta font-semibold text-ink-muted">
          {row.venueName}
        </p>
      ) : null}
      {row.type === "photo" ? (
        <PhotoLines row={row} />
      ) : (
        <TaskSendLines row={row} />
      )}
      <p className="text-meta text-ink-muted">
        {MY_CONTRIBUTIONS_COPY.sent(row.sentAt)}
      </p>
    </li>
  )
}

export function titleOf(
  row: PhotoContributionRow | TaskSendContributionRow
): string {
  const copy = MY_CONTRIBUTIONS_COPY
  if (row.type === "task_send") return row.title || copy.taskPhoto
  if (row.items.length > 0) return row.items.join(", ")
  return row.mediaType === "video" ? copy.video : copy.photo
}

export function PhotoLines({ row }: { row: PhotoContributionRow }) {
  const copy = MY_CONTRIBUTIONS_COPY
  return (
    <ul className="grid gap-1 text-body [overflow-wrap:anywhere] text-ink">
      {row.setSize ? <li>{copy.oneOfSet(row.setSize)}</li> : null}
      <li>{copy.upload[row.upload]}</li>
      {row.labels ? <li>{copy.labels[row.labels]}</li> : null}
      {row.reviews.map((line) => (
        <li key={line.key}>
          {copy.menuReview(line)}
          {line.offMenu ? (
            <span className="block text-meta text-ink-muted">
              {copy.offMenu}
            </span>
          ) : null}
        </li>
      ))}
      {row.menuUseAccepted ? <li>{copy.menuUse}</li> : null}
    </ul>
  )
}

function TaskSendLines({ row }: { row: TaskSendContributionRow }) {
  const copy = MY_CONTRIBUTIONS_COPY
  return (
    <ul className="grid gap-1 text-body [overflow-wrap:anywhere] text-ink">
      <li>{copy.taskReview(row)}</li>
      {row.revision ? (
        <li>
          {copy.revision(row.revision.number)}
          {row.revision.replacesSentAt ? (
            <span className="block text-meta text-ink-muted">
              {copy.replaces(row.revision.replacesSentAt)}
            </span>
          ) : null}
        </li>
      ) : null}
    </ul>
  )
}
