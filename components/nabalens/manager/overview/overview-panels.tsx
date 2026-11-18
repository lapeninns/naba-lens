import Link from "next/link"
import {
  ArrowsClockwiseIcon,
  ImageSquareIcon,
  ImagesIcon,
  StorefrontIcon,
} from "@phosphor-icons/react/dist/ssr"

import { HomeRow } from "@/components/nabalens/album/home-rows"
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

import { MenuMonthCheckControl } from "../venue/menu-month-check"

/*
 * S2-MGR (Full App v1): the manager Overview's new panels (spec §7 M1),
 * in Album's look (DESIGN.md §3, §5): link rows with the HomeRow shape, a
 * card per panel with a 1px line edge, counts in words before any bar.
 */

const ICONS: Record<OverviewActionKey, React.ReactNode> = {
  review: <ImagesIcon aria-hidden />,
  venue: <StorefrontIcon aria-hidden />,
  request: <ImageSquareIcon aria-hidden />,
  outdated: <ArrowsClockwiseIcon aria-hidden />,
}

const CARD = "grid gap-3 rounded-card bg-surface p-4 edge"

export const OVERVIEW_PANELS_COPY = {
  actionsTitle: "Do next",
  reviewNext: (n: number) => `Review next · ${plural(n, "photo")} waiting`,
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

/** Review next as the main button, then the four actions (spec §7 M1). */
export function OverviewActions({
  actions,
  pendingPhotos,
  reviewHref,
}: {
  actions: OverviewAction[]
  pendingPhotos: number | null
  reviewHref: string
}) {
  const copy = OVERVIEW_PANELS_COPY
  return (
    <section
      aria-labelledby="overview-actions"
      data-slot="overview-actions"
      className="grid gap-3"
    >
      <h2 id="overview-actions" className="type-section-title text-ink">
        {copy.actionsTitle}
      </h2>
      {pendingPhotos && pendingPhotos > 0 ? (
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
      ) : null}
      <ul className="grid gap-2 md:grid-cols-2">
        {actions.map((action) => (
          <li
            key={action.key}
            data-action={action.key}
            data-waiting={action.waiting || undefined}
          >
            <HomeRow
              href={action.href}
              slot="overview-action"
              icon={ICONS[action.key]}
              title={action.title}
              line={action.line}
            />
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
    <p className="type-count text-ink tabular-nums">{value}</p>
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
      <h2 id="overview-backlog" className="type-section-title text-ink">
        {copy.backlogTitle}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div data-backlog="collect" className={CARD}>
          <h3 className="text-label text-ink">{copy.toCollect}</h3>
          <Count value={split.toCollect} />
          <p className="text-body text-ink-muted">{copy.toCollectLine}</p>
        </div>
        <div data-backlog="review" className={CARD}>
          <h3 className="text-label text-ink">{copy.toReview}</h3>
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
        <h2 id="overview-coverage" className="type-section-title text-ink">
          {copy.coverageTitle}
        </h2>
        <p className="text-body text-ink-muted">{copy.coverageNote}</p>
      </div>
      {rows === null || rows.length === 0 ? (
        <p role="status" className="text-body text-ink-muted">
          {copy.coverageFailed}
        </p>
      ) : (
        <ul className={`${CARD} gap-4`}>
          {rows.map((row) => {
            const words = `${row.label}: ${row.text}${row.percent ? `, ${row.percent}` : ""}`
            return (
              <li
                key={row.key}
                data-category={row.key}
                className="grid gap-1.5"
              >
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-body text-ink">
                  <span className="text-label">{row.label}</span>
                  <span className="font-mono text-meta tabular-nums">
                    {row.text}
                    {row.percent ? (
                      <span className="text-ink-muted"> · {row.percent}</span>
                    ) : null}
                  </span>
                </p>
                <Progress
                  value={row.total > 0 ? (row.covered / row.total) * 100 : 0}
                  aria-label={words}
                  aria-valuetext={words}
                  tone="ok"
                  size="sm"
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
        <h2 id="overview-venue" className="type-section-title text-ink">
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
      <h2 id="overview-venue" className="type-section-title text-ink">
        <Link
          href={venueHref}
          className="rounded-control focus-ring hover:underline"
        >
          {copy.venueTitle}
        </Link>
      </h2>
      <dl className={`${CARD} sm:grid-cols-[auto_1fr] sm:gap-x-6`}>
        <dt className="text-label text-ink">{copy.activeMenu}</dt>
        <dd data-slot="active-menu" className="grid gap-2 text-body text-ink">
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
        </dd>
        <dt className="text-label text-ink">{copy.mainReviewer}</dt>
        <dd data-reviewer="main" className="text-body text-ink">
          {reviewers.main?.name ?? (
            <span className="text-ink-muted">{copy.mainNone}</span>
          )}
        </dd>
        <dt className="text-label text-ink">{copy.backupReviewer}</dt>
        <dd data-reviewer="backup" className="text-body text-ink">
          {reviewers.backup?.name ?? (
            <span className="text-ink-muted">{copy.nobody}</span>
          )}
        </dd>
      </dl>
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
