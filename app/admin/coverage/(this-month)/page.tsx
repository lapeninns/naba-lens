import type { Metadata } from "next"

import { SelfReviewsControl } from "@/app/staff/manage/_shared/controls"
import { ItemPhotoSelfReviewsControl } from "@/app/staff/manage/_shared/menu-items-controls"
import { unexpected } from "@/app/staff/manage/_shared/context"
import type { ManageSearch } from "@/app/staff/manage/_shared/screens"
import { AppShell } from "@/components/nabalens/app-shell"
import { CoverageSection } from "@/components/nabalens/coverage"
import { EmptyState } from "@/components/nabalens/empty-state"
import { ITEM_SELF_REVIEWS_COPY } from "@/components/nabalens/menu-photos/item-photo-self-reviews"
import { formatDateTime } from "@/components/nabalens/menus/copy"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { StatusChip } from "@/components/nabalens/status-chip"
import { requireActiveAdmin } from "@/lib/auth"
import {
  getCoverageActor,
  getGroupOverview,
  getOurMenu,
  listItemPhotoSelfReviews,
  listPreparationRuns,
  listSelfReviews,
} from "@/lib/server/coverage"
import {
  isPeriodKey,
  periodKeyOf,
  periodView,
} from "@/lib/server/coverage/time"
import type { GroupOverviewRow } from "@/lib/server/coverage/types"
import type { MediaActor } from "@/lib/server/media/types"

import { ADMIN_SECTION_TITLES, AdminTabs } from "../../_components/admin-tabs"
import {
  COVERAGE_COPY,
  PREPARATION_COPY,
  SELF_REVIEWS_COPY,
  monthName,
} from "../coverage-copy"
import {
  MonthNav,
  Tallies,
  VenueList,
  type VenueMenus,
} from "../coverage-sections"
import { buildPreparation, loadPeriodRuns, runsSince } from "../preparation"
import { PreparationSection } from "../preparation-section"
import {
  PrepareButton,
  PrepareProvider,
  PrepareStatus,
} from "../prepare-control"

export const metadata: Metadata = { title: "Coverage" }

/** Our menu totals per venue; a venue whose menu can't be read is left out. */
async function readVenueMenus(
  actor: MediaActor,
  venues: GroupOverviewRow[]
): Promise<VenueMenus> {
  const reads = await Promise.all(
    venues.map(async (row) => ({
      venueId: row.venue.id,
      read: await getOurMenu(actor, { venueId: row.venue.id }),
    }))
  )
  const menus: VenueMenus = new Map()
  for (const { venueId, read } of reads) {
    if (!read.ok) continue
    menus.set(
      venueId,
      read.menu.menuState === "ready" ? read.menu.totals : null
    )
  }
  return menus
}

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
  const isCurrent = period === current
  const actor = auth.actor
  const now = new Date()
  const view = periodView(period)
  const since = runsSince(view, now)
  const [overview, selfReviews, itemSelfReviews, runs] = await Promise.all([
    getGroupOverview(actor, { period }),
    listSelfReviews(actor, { period }),
    // Our menu decisions on a manager's own photos, kept apart from the
    // monthly self-reviews (a separate measure).
    listItemPhotoSelfReviews(actor, { period }),
    // Past months hide Monthly preparation, so only this month reads runs.
    isCurrent
      ? loadPeriodRuns(
          (cursor) => listPreparationRuns(actor, cursor ? { cursor } : {}),
          since
        )
      : Promise.resolve({
          ok: true as const,
          runs: [],
          firstPage: { items: [], nextCursor: null },
          complete: true,
        }),
  ])
  if (!overview.ok) unexpected(overview)
  if (!selfReviews.ok) unexpected(selfReviews)
  if (!itemSelfReviews.ok) unexpected(itemSelfReviews)
  if (!runs.ok) unexpected(runs)
  const { venues, preparation } = overview
  // Our menu is a current goal, not a month's record: shown this month only.
  // A venue whose menu can't be read is left blank rather than failing the page.
  const menus: VenueMenus | undefined = isCurrent
    ? await readVenueMenus(actor, venues)
    : undefined
  const month = monthName(overview.period.label)
  const model = buildPreparation(venues, runs.runs, overview.period, now, {
    ...preparation,
    complete: runs.complete && since === view.startsAt,
  })
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
  const lastRunAt = model.lastRunAt
  const selfReviewCount = venues.reduce((n, row) => n + row.selfReviews, 0)
  const unpreparedNames = model.unprepared.map((v) => v.venue.name)

  const header = (
    <PageHeader
      venueScope
      scope={[COVERAGE_COPY.allVenues, overview.period.label]}
      title={ADMIN_SECTION_TITLES.overview}
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
        // Venue managers is a People tab now (second handoff), not a link here.
        venues.length > 0 && needsPreparing ? (
          <PrepareButton primary />
        ) : undefined
      }
      className="pb-0 md:pb-0"
    >
      {/* Metrics is a sibling tab now, not a button (redesign R5). */}
      <AdminTabs set="overview" active="this-month" />
    </PageHeader>
  )

  return (
    <AppShell variant="admin" active="overview" userName={profile.displayName}>
      <PrepareProvider
        month={month}
        venues={[...model.unprepared, ...model.unfinished].map(
          (v) => v.venue.name
        )}
      >
        <div className="flex flex-col gap-6">
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
                <Tallies
                  rows={venues}
                  periodLabel={overview.period.label}
                  menus={menus}
                />
              ) : null}
              <VenueList rows={venues} menus={menus} />
              {/* Second handoff: Monthly preparation and Self-reviews are
                  reference lists, folded shut with their summary line. A
                  failed run keeps preparation open, so it is not missed. */}
              {isCurrent ? (
                <CoverageSection
                  id="preparation"
                  title={PREPARATION_COPY.title}
                  count={PREPARATION_COPY.summaryLine(
                    prepared,
                    venues.length,
                    lastRunAt ? formatDateTime(lastRunAt) : null
                  )}
                  collapsed={model.unfinished.length === 0}
                >
                  <PreparationSection
                    model={model}
                    period={overview.period}
                    venueNames={venueNames}
                    allRuns={runs.firstPage}
                    primary={needsPreparing}
                    bare
                  />
                </CoverageSection>
              ) : null}
              <CoverageSection
                id="self-reviews"
                title={SELF_REVIEWS_COPY.title}
                count={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <StatusChip state="self_review" />
                    {COVERAGE_COPY.selfReviewsThisMonth(selfReviewCount)}
                  </span>
                }
                collapsed
              >
                <p className="max-w-reading px-1 text-body text-ink-muted">
                  {SELF_REVIEWS_COPY.body}
                </p>
                {selfReviews.items.length === 0 ? (
                  <EmptyState
                    title={SELF_REVIEWS_COPY.emptyTitle(overview.period.label)}
                    description={<p>{SELF_REVIEWS_COPY.emptyText}</p>}
                  />
                ) : (
                  <SelfReviewsControl initial={selfReviews} period={period} />
                )}
                <div className="mt-3 grid gap-1">
                  <h3 className="px-1 text-label text-ink">
                    {ITEM_SELF_REVIEWS_COPY.title}
                  </h3>
                  <p className="max-w-reading px-1 text-body text-ink-muted">
                    {ITEM_SELF_REVIEWS_COPY.body}
                  </p>
                </div>
                <ItemPhotoSelfReviewsControl
                  initial={itemSelfReviews}
                  period={period}
                />
              </CoverageSection>
            </>
          )}
        </div>
      </PrepareProvider>
    </AppShell>
  )
}
