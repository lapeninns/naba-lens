import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"
import { METRICS_COPY } from "@/components/nabalens/metrics/copy"
import { metricsHrefs } from "@/components/nabalens/metrics/hrefs"
import { MetricsOverviewTable } from "@/components/nabalens/metrics/metrics-overview"
import {
  MetricsReport,
  type MetricsHrefs,
} from "@/components/nabalens/metrics/metrics-report"
import { Notice } from "@/components/nabalens/notice"
import {
  emptyFixtureMetrics,
  fixtureMetrics,
  fixtureOverview,
} from "@/lib/metrics/fixtures"

/*
 * Gallery block for the S2-METRICS screens (spec §18.1, AC39): a venue's
 * report, one category, an empty venue, the admin overview, and the loading
 * and failed states. Made-up data (lib/metrics/fixtures.ts).
 */

const hrefs: MetricsHrefs = {
  filter: (next) =>
    metricsHrefs.manager({
      days: next.days ?? 30,
      category: next.category ?? null,
    }),
  review: "#metrics",
  needsLabel: "#metrics",
}

function Group({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="grid min-w-0 gap-3">
      <h3 id={id} className="type-heading-sm text-ink">
        {title}
      </h3>
      <div className="rounded-card bg-canvas p-3 edge">{children}</div>
    </section>
  )
}

export function MetricsBlock() {
  return (
    <div className="grid min-w-0 gap-10">
      <Group id="metrics-report" title="A venue's report, all categories">
        <MetricsReport
          metrics={fixtureMetrics()}
          category={null}
          hrefs={hrefs}
        />
      </Group>
      <Group id="metrics-category" title="One category (Food)">
        <MetricsReport
          metrics={fixtureMetrics()}
          category="food"
          hrefs={hrefs}
        />
      </Group>
      <Group id="metrics-empty" title="A venue with nothing set up yet">
        <MetricsReport
          metrics={emptyFixtureMetrics()}
          category={null}
          hrefs={hrefs}
        />
      </Group>
      <Group id="metrics-overview" title="Admin overview of every venue">
        <MetricsOverviewTable
          overview={fixtureOverview()}
          venueHref={(id) => metricsHrefs.admin({ venue: id })}
        />
      </Group>
      <Group id="metrics-loading" title="Loading">
        <ManagerWorkspaceLoading label={METRICS_COPY.loading} />
      </Group>
      <Group id="metrics-error" title="A failed read">
        <Notice
          tone="negative"
          role="alert"
          title={METRICS_COPY.loadFailedTitle}
        >
          {METRICS_COPY.loadFailed}
        </Notice>
      </Group>
    </div>
  )
}
