import Link from "next/link"
import {
  ArrowsClockwiseIcon,
  ImageSquareIcon,
  ImagesIcon,
  PencilSimpleIcon,
  ShieldCheckIcon,
  StorefrontIcon,
} from "@phosphor-icons/react/dist/ssr"

import { HomeRow } from "@/components/nabalens/album/home-rows"
import { MetaList } from "@/components/nabalens/meta-list"
import { StatusChip } from "@/components/nabalens/status-chip"
import { buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { ManagerVenueSummary } from "@/lib/manager/venue"
import type {
  BacklogSplit,
  CategoryRow,
  OverviewAction,
  OverviewActionKey,
} from "@/lib/manager/overview"
import { plural } from "@/components/nabalens/coverage/copy"

import { MANAGER_CARD } from "../surface"
import { MenuMonthCheckControl } from "../venue/menu-month-check"

/*
 * S2-MGR (Full App v1): the manager Overview's new panels (spec §7 M1),
 * drawn to v2's M1 recipe (D10): action ListRows in one list, flat cards
 * with a line outline, counts in `figure`, one CoverageMeter per category,
 * the venue's facts as a MetaList. Counts are in words before any bar.
 */

/** A row of Needs you today: one of the four actions, or a job of its own. */
export type NeedsRowKey = OverviewActionKey | "confirm" | "rechecks" | "labels"
export type NeedsRow = Omit<OverviewAction, "key"> & { key: NeedsRowKey }

const ICONS: Record<NeedsRowKey, React.ReactNode> = {
  review: <ImagesIcon aria-hidden />,
  venue: <StorefrontIcon aria-hidden />,
  request: <ImageSquareIcon aria-hidden />,
  outdated: <ArrowsClockwiseIcon aria-hidden />,
  confirm: <ShieldCheckIcon aria-hidden />,
  rechecks: <ArrowsClockwiseIcon aria-hidden />,
  labels: <PencilSimpleIcon aria-hidden />,
}

const CARD = MANAGER_CARD

/**
 * v2 ListRows grouped in one box with lines between (RowList's look), for
 * lists that keep their own <li> attributes.
 */
export const MANAGER_ROW_LIST =
  "grid min-w-0 divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card [&_[data-slot=cr-row]]:rounded-none [&_[data-slot=cr-row]]:shadow-none [&_[data-slot=cr-row]]:focus-visible:-outline-offset-3"

export const OVERVIEW_PANELS_COPY = {
  /** The Overview's one display heading (redesign R4, ia.md). */
  actionsTitle: "Needs you today",
  /** The one bottle button: the biggest job. */
  reviewNext: (n: number) => `Review ${plural(n, "photo")}`,
  confirmTitle: "Confirm amenity findings",
  confirmLine: (n: number) => `${plural(n, "finding")} from staff to confirm`,
  rechecksTitle: "Recheck amenities",
  labelsTitle: "Label your own photos",
  labelsLine: (n: number) =>
    `${plural(n, "photo")} ${n === 1 ? "needs a label" : "need labels"}`,
  backlogTitle: "Collecting and reviewing",
  toCollect: "Still to collect",
  toCollectLine: "Slots nobody has sent a photo for yet.",
  toReview: "Waiting for your review",
  toReviewLine: (slots: number | null) =>
    slots === null
      ? "Photos staff have sent."
      : `Photos staff have sent, for ${plural(slots, "slot")}.`,
  couldNotCount: "We couldn't count these.",
  coverageTitle: "Coverage by category",
  coverageNote: "Accepted for public use, of everything the venue needs.",
  coverageFailed: "Coverage couldn't be loaded. Try again in a moment.",
  venueTitle: "This venue",
  activeMenu: "Active menu",
  noMenu: "No active menu yet",
  mainReviewer: "Main reviewer",
  backupReviewer: "Backup reviewer",
  nobody: "Not chosen yet",
  // S3-R5: the admin names the main reviewer; a manager chooses the backup.
  mainNone: "Not named yet",
  chooseReviewers: "Choose a backup reviewer",
} as const

/**
 * Needs you today (redesign R4, the handoff's Overview): one bottle button
 * for the biggest job (Review N photos, with what is waiting under it), then
 * every other job as a row that opens the place where the work is done. A
 * finished job stays as a plain line with its Complete chip, so the manager
 * can see it was checked. Nothing lives only here. `extra` adds the jobs of
 * their own (findings to confirm, the account's own photos to label) after
 * the four actions of spec §7 M1.
 */
export function OverviewActions({
  actions,
  pendingPhotos,
  reviewHref,
  extra = [],
  titleId,
}: {
  actions: OverviewAction[]
  pendingPhotos: number | null
  reviewHref: string
  extra?: NeedsRow[]
  /** The page's h1, when the list is the page (the Overview). */
  titleId?: string
}) {
  const copy = OVERVIEW_PANELS_COPY
  const main = pendingPhotos !== null && pendingPhotos > 0
  const review = actions.find((a) => a.key === "review")
  const rows: NeedsRow[] = [
    ...actions.filter((a) => !(main && a.key === "review")),
    ...extra,
  ]
  // Open jobs first, then the finished ones, each keeping its order.
  const ordered = [
    ...rows.filter((r) => r.waiting),
    ...rows.filter((r) => !r.waiting),
  ]
  return (
    <section
      aria-labelledby={titleId}
      aria-label={titleId ? undefined : copy.actionsTitle}
      data-slot="overview-actions"
      className="grid content-start gap-3"
    >
      {main ? (
        <div className="grid gap-1">
          <Link
            href={reviewHref}
            data-slot="review-next"
            className={buttonVariants({
              variant: "primary",
              className: "justify-self-start max-md:w-full",
            })}
          >
            <ImagesIcon data-icon="inline-start" aria-hidden />
            {copy.reviewNext(pendingPhotos)}
          </Link>
          {review ? (
            <p className="text-meta text-ink-muted">{review.line}</p>
          ) : null}
        </div>
      ) : null}
      <ul className="grid gap-2">
        {ordered.map((row) => (
          <li
            key={row.key}
            data-action={row.key}
            data-waiting={row.waiting || undefined}
            data-slot="overview-action"
          >
            {row.waiting ? (
              <HomeRow
                href={row.href}
                slot="overview-action-row"
                icon={ICONS[row.key]}
                title={row.title}
                line={row.line}
              />
            ) : (
              <div className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 rounded-card bg-surface px-4 py-3 edge">
                <span className="grid min-w-0 flex-1">
                  <span className="text-heading text-ink">{row.title}</span>
                  <span className="text-body text-ink-muted">{row.line}</span>
                </span>
                <StatusChip state="complete" />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Count({ value }: { value: number | null }) {
  return value === null ? (
    <p className="text-body text-ink-muted">
      {OVERVIEW_PANELS_COPY.couldNotCount}
    </p>
  ) : (
    <p className="type-figure text-ink">{value}</p>
  )
}

/** Collection versus review backlog: two numbers that never merge. */
export function BacklogPanel({ split }: { split: BacklogSplit }) {
  const copy = OVERVIEW_PANELS_COPY
  return (
    <section
      aria-labelledby="overview-backlog"
      data-slot="overview-backlog"
      className="grid gap-3"
    >
      <h2 id="overview-backlog" className="text-heading text-ink">
        {copy.backlogTitle}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div data-backlog="collect" className={CARD}>
          <h3 className="text-heading text-ink">{copy.toCollect}</h3>
          <Count value={split.toCollect} />
          <p className="text-body text-ink-muted">{copy.toCollectLine}</p>
        </div>
        <div data-backlog="review" className={CARD}>
          <h3 className="text-heading text-ink">{copy.toReview}</h3>
          <Count value={split.photosWaiting} />
          <p className="text-body text-ink-muted">
            {copy.toReviewLine(split.slotsWaiting)}
          </p>
        </div>
      </div>
    </section>
  )
}

/** Food, drinks, spaces, facilities (and Other), then facts: n of N and %. */
export function CategoryCoverage({ rows }: { rows: CategoryRow[] | null }) {
  const copy = OVERVIEW_PANELS_COPY
  return (
    <section
      aria-labelledby="overview-coverage"
      data-slot="overview-coverage"
      className="grid gap-3"
    >
      <div className="grid gap-1">
        <h2 id="overview-coverage" className="text-heading text-ink">
          {copy.coverageTitle}
        </h2>
        <p className="text-body text-ink-muted">{copy.coverageNote}</p>
      </div>
      {rows === null || rows.length === 0 ? (
        <p role="status" className="text-body text-ink-muted">
          {copy.coverageFailed}
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((row) => {
            const words = `${row.label}: ${row.text}${row.percent ? `, ${row.percent}` : ""}`
            return (
              // v2 CoverageMeter (`nl-cover`): the category, its count in
              // figure with the percentage beside it, then the 12px bar.
              <li
                key={row.key}
                data-category={row.key}
                className="grid gap-3 rounded-card bg-surface p-4 edge"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-heading text-ink">{row.label}</h3>
                  <p className="type-figure text-ink">
                    {row.text}
                    {row.percent ? (
                      <small className="ml-1 font-sans text-meta text-ink-muted">
                        · {row.percent}
                      </small>
                    ) : null}
                  </p>
                </div>
                <Progress
                  value={row.total > 0 ? (row.covered / row.total) * 100 : 0}
                  aria-label={words}
                  aria-valuetext={words}
                  tone="ok"
                  size="lg"
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** The active menu with this month's check, and the main/backup reviewers. */
export function VenueAtAGlance({
  summary,
  venueHref,
  reviewersHref,
}: {
  summary: ManagerVenueSummary | null
  venueHref: string
  reviewersHref: string
}) {
  const copy = OVERVIEW_PANELS_COPY
  if (!summary)
    return (
      <section aria-labelledby="overview-venue" className="grid gap-3">
        <h2 id="overview-venue" className="text-heading text-ink">
          {copy.venueTitle}
        </h2>
        <p role="status" className="text-body text-ink-muted">
          {copy.couldNotCount}
        </p>
      </section>
    )
  const { menuCheck, reviewers } = summary
  return (
    <section
      aria-labelledby="overview-venue"
      data-slot="overview-venue"
      className="grid gap-3"
    >
      <h2 id="overview-venue" className="text-heading text-ink">
        <Link
          href={venueHref}
          className="rounded-control focus-ring hover:underline"
        >
          {copy.venueTitle}
        </Link>
      </h2>
      <MetaList
        className="rounded-card bg-surface p-4 edge"
        items={[
          {
            label: copy.activeMenu,
            value: (
              <span
                data-slot="active-menu"
                className="grid justify-items-start gap-2"
              >
                {menuCheck ? (
                  <>
                    <span className="[overflow-wrap:anywhere]">
                      {menuCheck.menuTitle}
                    </span>
                    <MenuMonthCheckControl
                      venueId={summary.venueId}
                      check={menuCheck}
                    />
                  </>
                ) : (
                  <span className="text-ink-muted">{copy.noMenu}</span>
                )}
              </span>
            ),
          },
          {
            label: copy.mainReviewer,
            value: (
              <span data-reviewer="main">
                {reviewers.main?.name ?? (
                  <span className="text-ink-muted">{copy.mainNone}</span>
                )}
              </span>
            ),
          },
          {
            label: copy.backupReviewer,
            value: (
              <span data-reviewer="backup">
                {reviewers.backup?.name ?? (
                  <span className="text-ink-muted">{copy.nobody}</span>
                )}
              </span>
            ),
          },
        ]}
      />
      {!reviewers.backup ? (
        <Link
          href={reviewersHref}
          className={buttonVariants({
            variant: "secondary",
            className: "justify-self-start max-md:w-full",
          })}
        >
          {copy.chooseReviewers}
        </Link>
      ) : null}
    </section>
  )
}
