"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ImageSquareIcon, VideoCameraIcon } from "@phosphor-icons/react"

import { LabelEditorHost } from "@/app/_labels/label-editor-host"
import { PreviewUnavailable } from "@/components/nabalens/coverage/evidence-image"
import {
  MY_CONTRIBUTIONS_COPY,
  titleOf,
} from "@/components/nabalens/knowledge/my-contributions"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { Notice } from "@/components/nabalens/notice"
import { CHIP_STATES, StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import type {
  ContributionsFeedPage,
  FeedPhotoItem,
} from "@/lib/knowledge/contract"
import type { SaveLabelsResult } from "@/lib/menus/types"
import {
  contributionRows,
  type PhotoContributionRow,
} from "@/lib/work-client/contributions"

type LoadMore = (input: {
  cursor: string
}) => Promise<
  { ok: true; page: ContributionsFeedPage } | { ok: false; message: string }
>

// The server leaves a manager's staff-era uploads out of its feed; a row
// that still says another role (or none, from before roles were recorded)
// is never listed here either. An older server sends no role: kept.
const photosOf = (page: ContributionsFeedPage | null): FeedPhotoItem[] =>
  (page?.items ?? []).filter(
    (item): item is FeedPhotoItem =>
      item.type === "photo" &&
      (item.uploaderRole === undefined || item.uploaderRole === "manager")
  )

const rowId = (key: string) => `upload-${key.replace(/[^\w-]/g, "-")}`

/** Labels still to add (or to fix) put a photo in the first group. */
const needsLabels = (row: PhotoContributionRow) =>
  row.labels === "needs_labels" || row.labels === "needs_attention"

/**
 * The row's one chip, in the album's words (second handoff, decision 8):
 * Needs labels, Retake, In the album, else Waiting. Exported for tests.
 */
export function uploadChip(row: PhotoContributionRow): string {
  if (needsLabels(row)) return "needs_labels"
  if (
    row.reviews.some((r) => r.state === "better_photo_requested" && !r.offMenu)
  )
    return "outcome_retake"
  if (row.menuUseAccepted || row.reviews.some((r) => r.state === "accepted"))
    return "outcome_public"
  return "outcome_waiting"
}

/**
 * A manager account's own photo rows from the R5 feed, 20 feed rows a page
 * (task sends and findings are left out, so a page may show fewer), with My
 * contributions' lines and Add or Edit labels. Nothing here deletes.
 * Second handoff: photos needing labels first, then the labelled ones; each
 * row is the photo, its label, one chip and one button.
 */
export function MyUploads({
  initial,
  venue,
  loadMore,
}: {
  /** The first feed page; null when it couldn't be read. */
  initial: ContributionsFeedPage | null
  venue: { id: string; name: string }
  loadMore: LoadMore
}) {
  const router = useRouter()
  const [items, setItems] = React.useState(() => photosOf(initial))
  const [cursor, setCursor] = React.useState(initial?.nextCursor ?? null)
  const [pagedOn, setPagedOn] = React.useState(false)
  const [status, setStatus] = React.useState<"idle" | "loading" | "failed">(
    "idle"
  )
  const [focusKey, setFocusKey] = React.useState<string | null>(null)
  const [labelFor, setLabelFor] = React.useState<string | null>(null)
  const retryRef = React.useRef<HTMLButtonElement>(null)

  // A refresh (after a label save) brings a new first page. Before Show more
  // it replaces the list; after, its rows replace their loaded copies and
  // the later pages stay, so focus and place are kept.
  const seed = JSON.stringify(initial)
  const [seeded, setSeeded] = React.useState(seed)
  if (seed !== seeded) {
    setSeeded(seed)
    const fresh = photosOf(initial)
    if (!pagedOn) {
      setItems(fresh)
      setCursor(initial?.nextCursor ?? null)
    } else {
      setItems((current) => {
        const byKey = new Map(fresh.map((item) => [item.key, item]))
        const known = new Set(current.map((item) => item.key))
        return [
          ...fresh.filter((item) => !known.has(item.key)),
          ...current.map((item) => byKey.get(item.key) ?? item),
        ]
      })
    }
  }

  React.useEffect(() => {
    if (focusKey) document.getElementById(rowId(focusKey))?.focus()
  }, [focusKey])

  React.useEffect(() => {
    if (status === "failed") retryRef.current?.focus()
  }, [status])

  const rows = React.useMemo(
    () =>
      contributionRows(items).filter(
        (row): row is PhotoContributionRow => row.type === "photo"
      ),
    [items]
  )

  async function more() {
    if (!cursor || status === "loading") return
    setStatus("loading")
    const result = await loadMore({ cursor }).catch(() => null)
    if (!result?.ok) {
      setStatus("failed")
      return
    }
    const known = new Set(items.map((item) => item.key))
    const fresh = photosOf(result.page).filter((item) => !known.has(item.key))
    setItems((current) => [...current, ...fresh])
    setCursor(result.page.nextCursor)
    setPagedOn(true)
    setStatus("idle")
    // With no new photo and more to come, focus stays on Show more.
    if (fresh[0]) setFocusKey(fresh[0].key)
    else if (!result.page.nextCursor && items.length > 0)
      setFocusKey(items[items.length - 1].key)
  }

  function onSaved(results: SaveLabelsResult[]) {
    const saved = new Map(
      results.flatMap((r) => (r.ok ? [[r.assetId, r.labels] as const] : []))
    )
    if (saved.size === 0) return
    setItems((current) =>
      current.map((item) => {
        const labels = saved.get(item.assetId)
        if (!labels) return item
        return {
          ...item,
          labels: {
            ...item.labels,
            hasLabels: labels.hasLabels,
            needsLabels: item.uploadState === "ready" && !labels.hasLabels,
          },
        }
      })
    )
    // The server's own lines (and the overview's count) follow on refresh.
    router.refresh()
  }

  const copy = MANAGER_COPY.uploads

  return (
    <section aria-label={copy.title} className="grid gap-6">
      {initial === null ? (
        <Notice
          tone="negative"
          action={
            <Link
              href={managerHrefs.uploads}
              className={buttonVariants({ variant: "secondary" })}
            >
              Try again
            </Link>
          }
        >
          {copy.failed}
        </Notice>
      ) : rows.length === 0 ? (
        cursor ? null : (
          <p className="rounded-card bg-surface p-4 text-body text-ink shadow-card">
            {copy.empty}
          </p>
        )
      ) : (
        [
          {
            id: "needs",
            title: CHIP_STATES.needs_labels.word,
            rows: rows.filter(needsLabels),
          },
          {
            id: "labelled",
            title: copy.labelledTitle,
            rows: rows.filter((row) => !needsLabels(row)),
          },
        ].map((group) =>
          group.rows.length === 0 ? null : (
            <section
              key={group.id}
              aria-labelledby={`uploads-${group.id}`}
              className="grid gap-3"
            >
              <h2
                id={`uploads-${group.id}`}
                className="flex flex-wrap items-baseline gap-x-3 px-1 type-section-title text-ink"
              >
                {group.title}
                <span className="text-meta font-normal text-ink-muted tabular-nums">
                  {group.rows.length}
                </span>
              </h2>
              <ul
                aria-label={group.title}
                className="grid divide-y divide-line overflow-hidden rounded-card bg-surface edge"
              >
                {group.rows.map((row) => (
                  <UploadRow
                    key={row.key}
                    row={row}
                    venue={venue}
                    onLabel={() => setLabelFor(row.assetId)}
                  />
                ))}
              </ul>
            </section>
          )
        )
      )}

      {initial === null ? null : status === "failed" ? (
        <Notice
          tone="negative"
          action={
            <Button
              ref={retryRef}
              type="button"
              variant="secondary"
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
          className="justify-self-start max-sm:w-full"
          aria-busy={status === "loading"}
          // aria-disabled keeps focus on it while loading (HM-06).
          aria-disabled={status === "loading" || undefined}
          onClick={() => void more()}
        >
          {status === "loading" ? copy.loading : "Show more"}
        </Button>
      ) : null}

      <LabelEditorHost
        assetIds={labelFor ? [labelFor] : []}
        open={labelFor !== null}
        onOpenChange={(open) => {
          if (!open) setLabelFor(null)
        }}
        onSaved={onSaved}
      />
    </section>
  )
}

function UploadRow({
  row,
  venue,
  onLabel,
}: {
  row: PhotoContributionRow
  venue: { id: string; name: string }
  onLabel: () => void
}) {
  const copy = MANAGER_COPY.uploads
  const id = rowId(row.key)
  const elsewhere = row.venueId !== venue.id
  const labelled = row.labels === "labelled" || row.labels === "needs_attention"
  const retake = row.reviews.find(
    (r) => r.state === "better_photo_requested" && !r.offMenu && r.reason
  )
  return (
    <li className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
      <Thumb row={row} />
      <div className="grid min-w-0 content-start gap-0.5">
        <h3
          id={id}
          tabIndex={-1}
          className="min-w-0 rounded-control text-label [overflow-wrap:anywhere] text-ink focus-ring outline-none"
        >
          {titleOf(row)}
        </h3>
        <p className="text-meta text-ink-muted">
          {[
            MY_CONTRIBUTIONS_COPY.sent(row.sentAt),
            row.setSize
              ? MY_CONTRIBUTIONS_COPY.oneOfSet(row.setSize).toLowerCase()
              : null,
            elsewhere && row.venueName ? row.venueName : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {row.upload === "saved" ? null : (
          <p className="text-meta text-ink-muted">
            {MY_CONTRIBUTIONS_COPY.upload[row.upload]}
          </p>
        )}
        {retake ? (
          <p className="text-meta [overflow-wrap:anywhere] text-ink-muted">
            “{retake.reason}”
          </p>
        ) : null}
      </div>
      <div className="col-start-2 sm:col-start-auto">
        <StatusChip state={uploadChip(row)} />
      </div>
      {/* The editor opens saved files only. */}
      {row.upload === "saved" ? (
        <Button
          type="button"
          variant={labelled ? "quiet" : "secondary"}
          className="col-span-2 max-sm:w-full sm:col-span-1"
          aria-describedby={id}
          onClick={onLabel}
        >
          {labelled ? copy.editLabels : copy.addLabels}
        </Button>
      ) : null}
    </li>
  )
}

function Thumb({ row }: { row: PhotoContributionRow }) {
  const [failed, setFailed] = React.useState(false)
  const show = row.mediaType === "image" && row.upload === "saved" && !failed
  // A thumbnail the route refuses (e.g. one this account may no longer
  // read) says so, as evidence images do, rather than a bare icon.
  if (failed)
    return (
      <PreviewUnavailable className="size-14 shrink-0 rounded-control px-1 text-center text-caption" />
    )
  return (
    <span
      aria-hidden
      className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-control bg-plate text-ink-muted"
    >
      {show ? (
        // Signed private URLs never go through next/image (see MediaTile).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/media/${encodeURIComponent(row.assetId)}/thumb`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : row.mediaType === "video" ? (
        <VideoCameraIcon className="size-6" />
      ) : (
        <ImageSquareIcon className="size-6" />
      )}
    </span>
  )
}
