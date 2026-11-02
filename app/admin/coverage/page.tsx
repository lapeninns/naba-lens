import type { Metadata } from "next"
import Link from "next/link"
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import {
  PrepareMonthControl,
  PreparationRunsControl,
  SelfReviewsControl,
} from "@/app/staff/manage/_shared/controls"
import { unexpected } from "@/app/staff/manage/_shared/context"
import type { ManageSearch } from "@/app/staff/manage/_shared/screens"
import { AppShell } from "@/components/nabalens/app-shell"
import {
  GroupCoverageTable,
  GroupParticipationTable,
  MissingPeriodList,
  SELF_REVIEW_COPY,
  periodKeyLabel,
} from "@/components/nabalens/coverage"
import { formatDateTime } from "@/components/nabalens/menus/copy"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import {
  getCoverageActor,
  getGroupOverview,
  listPreparationRuns,
  listSelfReviews,
} from "@/lib/server/coverage"
import {
  isPeriodKey,
  periodKeyOf,
  shiftPeriod,
} from "@/lib/server/coverage/time"

export const metadata: Metadata = { title: "Coverage · Naba-Lens" }

/**
 * Organisation oversight: every venue's coverage and its staff participation
 * (reported separately), self-reviews, and monthly preparation health.
 */
export default async function CoverageOverviewPage({
  searchParams,
}: {
  searchParams: Promise<ManageSearch>
}) {
  const profile = await requireActiveAdmin()
  const search = await searchParams
  const current = periodKeyOf(new Date())
  const requested = typeof search.period === "string" ? search.period : null
  const period =
    requested && isPeriodKey(requested) && requested <= current
      ? requested
      : current
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const [overview, selfReviews, runs] = await Promise.all([
    getGroupOverview(auth.actor, { period }),
    listSelfReviews(auth.actor, { period }),
    listPreparationRuns(auth.actor, {}),
  ])
  if (!overview.ok) unexpected(overview)
  if (!selfReviews.ok) unexpected(selfReviews)
  if (!runs.ok) unexpected(runs)
  const { venues, preparation } = overview
  const venueNames = Object.fromEntries(
    venues.map((row) => [row.venue.id, row.venue.name])
  )
  const previous = shiftPeriod(period, -1)
  const next = shiftPeriod(period, 1)
  const status = preparation.status

  return (
    <AppShell
      variant="admin"
      active="coverage"
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="grid gap-8">
        <div className="grid gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="grid gap-1">
              <h1 className="font-display text-page-title-compact md:text-page-title">
                Coverage, {overview.period.label}
              </h1>
              <p className="max-w-prose text-sm text-muted-foreground">
                Every venue’s photo coverage and its staff’s monthly
                participation, side by side but counted separately. Dates are UK
                time.
              </p>
            </div>
            <Link
              href="/admin/coverage/managers"
              className={buttonVariants({ variant: "outline", size: "touch" })}
            >
              <ShieldCheckIcon data-icon="inline-start" aria-hidden />
              Venue managers
            </Link>
          </div>
          <nav aria-label="Month" className="flex flex-wrap gap-2">
            <Link
              href={`/admin/coverage?period=${previous}`}
              className={buttonVariants({ variant: "outline", size: "touch" })}
            >
              {periodKeyLabel(previous)}
            </Link>
            {period !== current ? (
              <Link
                href={
                  next === current
                    ? "/admin/coverage"
                    : `/admin/coverage?period=${next}`
                }
                className={buttonVariants({
                  variant: "outline",
                  size: "touch",
                })}
              >
                {periodKeyLabel(next)}
              </Link>
            ) : null}
            {period !== current ? (
              <Link
                href="/admin/coverage"
                className={buttonVariants({ variant: "ghost", size: "touch" })}
              >
                This month
              </Link>
            ) : null}
          </nav>
        </div>

        {venues.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active venues.</p>
        ) : (
          <>
            <GroupCoverageTable rows={venues} />
            <GroupParticipationTable
              rows={venues}
              periodLabel={overview.period.label}
            />
          </>
        )}

        <section aria-labelledby="preparation-title" className="grid gap-3">
          <div className="grid gap-1">
            <h2 id="preparation-title" className="text-lg font-medium">
              Monthly preparation
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              Runs every hour: copies each person’s last target at their venue,
              adds the standard checklist items and flags missing setup. A venue
              listed below has people without a target row, which means
              preparation has not reached it.
            </p>
          </div>
          {status ? (
            <p className="text-sm">
              {status.lastSuccessAt
                ? `Last successful run ${formatDateTime(status.lastSuccessAt)}.`
                : "No successful run this month."}{" "}
              {status.lastStatus === "failed" && status.lastFailureAt
                ? `Last run failed ${formatDateTime(status.lastFailureAt)} (code ${status.lastErrorCode ?? "unknown"}).`
                : null}
            </p>
          ) : null}
          <MissingPeriodList missing={preparation.missingPeriods} />
          {preparation.recentFailures.length > 0 ? (
            <div className="grid gap-1">
              <h3 className="text-sm font-medium text-negative">
                Recent failures
              </h3>
              <ul className="grid gap-1 text-sm">
                {preparation.recentFailures.map((run) => (
                  <li key={run.id}>
                    {formatDateTime(run.startedAt)},{" "}
                    {run.venueId
                      ? (venueNames[run.venueId] ?? "one venue")
                      : "all venues"}
                    : code {run.errorCode ?? "unknown"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <PrepareMonthControl label="Prepare this month for all venues" />
          <details className="grid gap-2">
            <summary className="cursor-pointer py-3 text-sm font-medium sm:py-1">
              All preparation runs
            </summary>
            <div className="pt-2">
              <PreparationRunsControl initial={runs} venueNames={venueNames} />
            </div>
          </details>
        </section>

        <section aria-labelledby="self-review-title" className="grid gap-3">
          <div className="grid gap-1">
            <h2 id="self-review-title" className="text-lg font-medium">
              Self-reviews, {overview.period.label}
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              {SELF_REVIEW_COPY} Managers may review their own photos; each
              decision is listed here.
            </p>
          </div>
          <SelfReviewsControl initial={selfReviews} period={period} />
        </section>
      </div>
    </AppShell>
  )
}
