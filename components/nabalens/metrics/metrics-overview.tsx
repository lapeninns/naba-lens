import Link from "next/link"

import { CoverageSection } from "@/components/nabalens/coverage"
import { EmptyState } from "@/components/nabalens/empty-state"
import { Notice } from "@/components/nabalens/notice"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  CATEGORY_WORDS,
  METRIC_CATEGORIES,
  categoryCounts,
  durationWords,
  type MetricsOverview,
} from "@/lib/metrics/model"

import { METRICS_COPY as C } from "./copy"
import { OfNumber } from "./metrics-report"

// Admin overview of every active venue (spec §18.1, §8 A1): coverage by
// category, facts, review and reliability, each venue linking to its full
// report. Venues are listed by name, never ordered by their numbers.

export function MetricsOverviewTable({
  overview,
  venueHref,
}: {
  overview: MetricsOverview
  venueHref: (venueId: string) => string
}) {
  const failedJobs = C.failedJobs(overview.failedJobs)
  return (
    <CoverageSection
      id="venues"
      title={C.chooseVenue}
      count={C.inPeriod(overview.days)}
    >
      {failedJobs ? (
        <Notice tone="attention" role="status">
          {failedJobs}
        </Notice>
      ) : null}
      {overview.venues.length === 0 ? (
        <EmptyState title={C.noVenuesTitle} description={C.noVenues} />
      ) : (
        <Table framed stacked>
          <TableHeader>
            <TableRow>
              <TableHead>{C.venueColumn}</TableHead>
              <TableHead>{C.photosColumn}</TableHead>
              {METRIC_CATEGORIES.filter((c) => c !== "other").map((c) => (
                <TableHead key={c}>{CATEGORY_WORDS[c]}</TableHead>
              ))}
              <TableHead>{C.factsColumn}</TableHead>
              <TableHead numeric>{C.waitingColumn}</TableHead>
              <TableHead numeric>{C.needsLabelColumn}</TableHead>
              <TableHead numeric>{C.failuresColumn}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.venues.map((v) => (
              <TableRow key={v.venueId} data-venue={v.venueId}>
                <TableCell className="font-semibold">
                  <Link
                    href={venueHref(v.venueId)}
                    className="rounded-control text-accent-text underline-offset-4 focus-ring outline-none hover:underline"
                  >
                    {v.venueName}
                  </Link>
                </TableCell>
                <TableCell label={C.photosColumn}>
                  <OfNumber
                    n={v.coverage.totals.covered}
                    d={v.coverage.totals.total}
                  />
                </TableCell>
                {METRIC_CATEGORIES.filter((c) => c !== "other").map((c) => {
                  const counts = categoryCounts(v, c)
                  return (
                    <TableCell key={c} label={CATEGORY_WORDS[c]}>
                      <OfNumber n={counts.covered} d={counts.total} />
                    </TableCell>
                  )
                })}
                <TableCell label={C.factsColumn}>
                  <OfNumber n={v.facts.numerator} d={v.facts.denominator} />
                </TableCell>
                <TableCell label={C.waitingColumn} numeric>
                  {v.review.waiting}
                  {v.review.oldestWaitingAt ? (
                    <span className="block text-meta text-ink-muted">
                      {C.oldest(
                        durationWords(
                          (Date.parse(overview.generatedAt) -
                            Date.parse(v.review.oldestWaitingAt)) /
                            1000
                        )
                      )}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell label={C.needsLabelColumn} numeric>
                  {v.needsLabel.count}
                </TableCell>
                <TableCell label={C.failuresColumn} numeric>
                  {v.reliability.technical}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CoverageSection>
  )
}
