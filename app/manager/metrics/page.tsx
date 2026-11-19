import type { Metadata } from "next"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { METRICS_COPY } from "@/components/nabalens/metrics/copy"
import { metricsHrefs } from "@/components/nabalens/metrics/hrefs"
import { MetricsReport } from "@/components/nabalens/metrics/metrics-report"
import { Notice } from "@/components/nabalens/notice"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { parseCategory, parsePeriod } from "@/lib/metrics/model"
import { loadVenueMetrics } from "@/lib/server/metrics"

export const metadata: Metadata = { title: METRICS_COPY.title }

/**
 * A manager's metrics for their own venue (spec §18.1, §7 M1; AC39). No nav
 * tab (the phone bar is full); linked from Overview. The database refuses
 * any venue but the one this person manages.
 */
export default async function ManagerMetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await workspaceManagerContext()
  const search = await searchParams
  const days = parsePeriod(search.days)
  const category = parseCategory(search.category)
  const read = await loadVenueMetrics(ctx.actor, ctx.venueId, days)
  return (
    <div className="grid gap-gutter">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      <PageHeader
        scope={ctx.venue.name}
        venueScope
        title={METRICS_COPY.title}
        summary={METRICS_COPY.summary}
        className="pb-0 md:pb-0"
      />
      {read.ok ? (
        <MetricsReport
          metrics={read.metrics}
          category={category}
          hrefs={{
            filter: (next) =>
              metricsHrefs.manager({
                days: next.days ?? days,
                category:
                  next.category === undefined ? category : next.category,
              }),
            review: managerHrefs.review(),
            needsLabel: managerHrefs.review(),
          }}
        />
      ) : (
        <Notice
          tone="negative"
          role="alert"
          title={METRICS_COPY.loadFailedTitle}
        >
          {read.message} {read.nextAction}
        </Notice>
      )}
    </div>
  )
}
