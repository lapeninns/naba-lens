import type { Metadata } from "next"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { LinkSelect } from "@/components/nabalens/link-select"
import { METRICS_COPY } from "@/components/nabalens/metrics/copy"
import { metricsHrefs } from "@/components/nabalens/metrics/hrefs"
import { MetricsOverviewTable } from "@/components/nabalens/metrics/metrics-overview"
import {
  MetricsFilters,
  MetricsReport,
} from "@/components/nabalens/metrics/metrics-report"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { LinkButton } from "@/components/ui/link-button"
import { Field, FieldLabel } from "@/components/ui/field"
import { requireActiveAdmin } from "@/lib/auth"
import { parseCategory, parsePeriod } from "@/lib/metrics/model"
import { getCoverageActor } from "@/lib/server/coverage"

import { ADMIN_SECTION_TITLES, AdminTabs } from "../_components/admin-tabs"
import { loadMetricsOverview, loadVenueMetrics } from "@/lib/server/metrics"

export const metadata: Metadata = { title: METRICS_COPY.title }

/** The "All venues" choice in the venue Select. */
const ALL_VENUES = "all"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Admin metrics (spec §18.1, §8 A1; AC39): every active venue's coverage
 * by category, facts, review and reliability, then one venue's full report
 * with how each number is counted (`?venue=`). Admins only: the layout's
 * gate, requireActiveAdmin here, and the database (metrics_overview and
 * venue_metrics refuse anyone else). A failed read shows a notice in place.
 */
export default async function AdminMetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const search = await searchParams
  const days = parsePeriod(search.days)
  const category = parseCategory(search.category)
  const venueId =
    typeof search.venue === "string" && UUID.test(search.venue)
      ? search.venue
      : null

  const [overview, venue] = await Promise.all([
    loadMetricsOverview(auth.actor, days),
    venueId
      ? loadVenueMetrics(auth.actor, venueId, days)
      : Promise.resolve(null),
  ])
  const venues = overview.ok ? overview.overview.venues : []
  const filter =
    (base: { venue?: string | null }) =>
    (next: { days?: number; category?: typeof category }) =>
      metricsHrefs.admin({
        venue: base.venue ?? null,
        days: next.days ?? days,
        category: next.category === undefined ? category : next.category,
      })

  return (
    <AppShell variant="admin" active="overview" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <PageHeader
            scope={venue?.ok ? venue.metrics.venueName : "All venues"}
            venueScope={!!venue?.ok}
            title={ADMIN_SECTION_TITLES.overview}
            summary={<p>{METRICS_COPY.adminSummary}</p>}
            actions={
              venueId ? (
                <LinkButton
                  href={metricsHrefs.admin({ days, category })}
                  variant="secondary"
                >
                  {METRICS_COPY.backToAll}
                </LinkButton>
              ) : undefined
            }
            className="pb-0 md:pb-0"
          >
            <AdminTabs set="overview" active="metrics" />
          </PageHeader>
          <OfflineNotice />
        </div>

        {/* Second handoff: the venue pills became one Select. */}
        {venues.length > 0 ? (
          <Field className="grid max-w-sm min-w-0 gap-1.5 px-1">
            <FieldLabel htmlFor="admin-metrics-venue">
              {METRICS_COPY.chooseVenue}
            </FieldLabel>
            <LinkSelect
              id="admin-metrics-venue"
              value={venueId ?? ALL_VENUES}
              options={[
                {
                  id: ALL_VENUES,
                  name: METRICS_COPY.backToAll,
                  href: metricsHrefs.admin({ days, category }),
                },
                ...venues.map((v) => ({
                  id: v.venueId,
                  name: v.venueName,
                  href: metricsHrefs.admin({
                    venue: v.venueId,
                    days,
                    category,
                  }),
                })),
              ]}
            />
          </Field>
        ) : null}

        {venue ? (
          venue.ok ? (
            <MetricsReport
              metrics={venue.metrics}
              category={category}
              hrefs={{
                filter: filter({ venue: venueId }),
                review: `/admin/coverage/${venue.metrics.venueId}/menu-photos`,
                needsLabel: `/admin?venue=${venue.metrics.venueId}&labels=unlabelled`,
              }}
            />
          ) : (
            <Notice
              tone="negative"
              role="alert"
              title={METRICS_COPY.loadFailedTitle}
            >
              {venue.message} {venue.nextAction}
            </Notice>
          )
        ) : overview.ok ? (
          <>
            <MetricsFilters
              days={days}
              category={null}
              hrefs={{ filter: filter({}) }}
              categories={false}
            />
            <MetricsOverviewTable
              overview={overview.overview}
              venueHref={(id) => metricsHrefs.admin({ venue: id, days })}
            />
          </>
        ) : (
          <Notice
            tone="negative"
            role="alert"
            title={METRICS_COPY.loadFailedTitle}
          >
            {overview.message} {overview.nextAction}
          </Notice>
        )}
      </div>
    </AppShell>
  )
}
