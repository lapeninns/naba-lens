import type { Metadata } from "next"
import Link from "next/link"
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import { SelfReviewsControl } from "@/app/staff/manage/_shared/controls"
import { unexpected } from "@/app/staff/manage/_shared/context"
import type { ManageSearch } from "@/app/staff/manage/_shared/screens"
import { AppShell } from "@/components/nabalens/app-shell"
import { EmptyState } from "@/components/nabalens/empty-state"
import { formatDateTime } from "@/components/nabalens/menus/copy"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { StatusChip } from "@/components/nabalens/status-chip"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import {
  getCoverageActor,
  getGroupOverview,
  listPreparationRuns,
  listSelfReviews,
} from "@/lib/server/coverage"
import { isPeriodKey, periodKeyOf } from "@/lib/server/coverage/time"

import {
  COVERAGE_COPY,
  PREPARATION_COPY,
  SELF_REVIEWS_COPY,
  monthName,
} from "./coverage-copy"
import {
  MonthNav,
  SectionHead,
  SummaryLine,
  Tallies,
  VenueList,
} from "./coverage-sections"
import { buildPreparation } from "./preparation"
import { PreparationSection } from "./preparation-section"
import {
  PrepareButton,
  PrepareProvider,
  PrepareStatus,
} from "./prepare-control"

export const metadata: Metadata = { title: "Coverage · Naba-Lens" }

/**
 * A16 and A17: every venue's coverage and its staff participation (reported
 * separately), monthly preparation health and self-reviews.
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
  const isCurrent = period === current
  const month = monthName(overview.period.label)
  const model = buildPreparation(venues, runs.items, overview.period, new Date())
  const venueNames = Object.fromEntries(
    venues.map((row) => [row.venue.id, row.venue.name])
  )
  const needsPreparing =
    isCurrent &&
    venues.length > 0 &&
    (model.unprepared.length > 0 ||
      model.unfinished.length > 0 ||
      model.noSuccessThisMonth)
  const prepared = model.venues.filter((v) => v.state === "prepared").length
  const lastRunAt = preparation.status?.lastRunAt ?? model.lastRunAt
  const selfReviewCount = venues.reduce((n, row) => n + row.selfReviews, 0)
  const unpreparedNames = model.unprepared.map((v) => v.venue.name)

  const header = (
    <PageHeader
      venueScope
      scope={[COVERAGE_COPY.allVenues, overview.period.label]}
      title={COVERAGE_COPY.title}
      summary={
        venues.length === 0 ? undefined : (
          <p>
            {isCurrent
              ? COVERAGE_COPY.summary
              : COVERAGE_COPY.pastSummary(month)}
          </p>
        )
      }
      actions={
        venues.length === 0 ? undefined : (
          <>
            <Link
              href="/admin/coverage/managers"
              className={buttonVariants({ variant: "secondary", size: "touch" })}
            >
              <ShieldCheckIcon aria-hidden />
              {COVERAGE_COPY.venueManagers}
            </Link>
            {needsPreparing ? <PrepareButton primary /> : null}
          </>
        )
      }
      className="pb-0 md:pb-0"
    />
  )

  return (
    <AppShell
      variant="admin"
      active="coverage"
      userName={profile.displayName}
      logoutAction={logout}
    >
      <PrepareProvider
        month={month}
        venues={[...model.unprepared, ...model.unfinished].map(
          (v) => v.venue.name
        )}
      >
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            {header}
            <OfflineNotice />
            <PrepareStatus />
            {venues.length > 0 ? (
              <MonthNav
                period={period}
                current={current}
                label={overview.period.label}
              />
            ) : null}
            {isCurrent && model.unprepared.length > 0 ? (
              <Notice
                tone="attention"
                title={COVERAGE_COPY.unpreparedTitle(model.unprepared.length)}
              >
                <p>{COVERAGE_COPY.unpreparedBody(unpreparedNames, month)}</p>
              </Notice>
            ) : null}
          </div>

          {venues.length === 0 ? (
            <EmptyState
              title={COVERAGE_COPY.emptyTitle}
              description={<p>{COVERAGE_COPY.emptyText}</p>}
            />
          ) : (
            <>
              {isCurrent ? (
                <Tallies rows={venues} periodLabel={overview.period.label} />
              ) : null}
              <VenueList rows={venues} />
              {isCurrent ? (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="grid content-start gap-2">
                    <SectionHead
                      id="preparation-summary-title"
                      title={PREPARATION_COPY.title}
                    />
                    <SummaryLine
                      icon={prepared === venues.length ? "check" : "prepare"}
                    >
                      <a
                        href="#preparation"
                        className="underline-offset-3 hover:underline"
                      >
                        {PREPARATION_COPY.summaryLine(
                          prepared,
                          venues.length,
                          lastRunAt ? formatDateTime(lastRunAt) : null
                        )}
                      </a>
                    </SummaryLine>
                  </div>
                  <div className="grid content-start gap-2">
                    <SectionHead
                      id="self-review-summary-title"
                      title={COVERAGE_COPY.selfReviews}
                    />
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-touch md:text-body-sm">
                      <StatusChip state="self_review" />
                      <a
                        href="#self-reviews"
                        className="text-ink underline underline-offset-3"
                      >
                        {COVERAGE_COPY.selfReviewsThisMonth(selfReviewCount)}
                      </a>
                      <span className="text-ink-muted">
                        {COVERAGE_COPY.selfReviewsNote}
                      </span>
                    </p>
                  </div>
                </div>
              ) : null}
              {isCurrent ? (
                <PreparationSection
                  model={model}
                  period={overview.period}
                  venueNames={venueNames}
                  primary={needsPreparing}
                />
              ) : null}
              <section
                id="self-reviews"
                aria-labelledby="self-review-title"
                className="grid scroll-mt-20 gap-3"
              >
                <div className="grid gap-1">
                  <SectionHead
                    id="self-review-title"
                    title={SELF_REVIEWS_COPY.title}
                  />
                  <p className="max-w-(--size-reading) text-body-touch text-ink-muted md:text-body-sm">
                    {SELF_REVIEWS_COPY.body}
                  </p>
                </div>
                {selfReviews.items.length === 0 ? (
                  <EmptyState
                    title={SELF_REVIEWS_COPY.emptyTitle(overview.period.label)}
                    description={<p>{SELF_REVIEWS_COPY.emptyText}</p>}
                  />
                ) : (
                  <SelfReviewsControl initial={selfReviews} period={period} />
                )}
              </section>
            </>
          )}
        </div>
      </PrepareProvider>
    </AppShell>
  )
}
