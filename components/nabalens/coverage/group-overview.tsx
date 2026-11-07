import Link from "next/link"

import { formatDateTime } from "@/components/nabalens/menus/copy"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { MENU_STATE_LABEL, labelFor, periodKeyLabel, plural } from "./copy"
import { CoverageBadge } from "./coverage-badges"
import type { GroupOverviewRow, MissingPeriod } from "./types"

const venueHref = (id: string) => `/admin/coverage/${encodeURIComponent(id)}`

function managerNames(row: GroupOverviewRow): string {
  const names = row.managers
    .map((m) => m.displayName)
    .filter((n): n is string => !!n)
  return names.length ? names.join(", ") : "No manager"
}

/** Venue coverage for every venue (separate from staff participation). */
export function GroupCoverageTable({ rows }: { rows: GroupOverviewRow[] }) {
  return (
    <section aria-labelledby="group-coverage-title" className="grid gap-3">
      <div className="grid gap-1">
        <h2
          id="group-coverage-title"
          className="font-display text-section-title text-ink"
        >
          Venue coverage
        </h2>
        <p className="max-w-prose text-meta text-ink-muted">
          Checklist items with enough accepted photos. A venue is complete only
          when every applicable item is satisfied, nothing needs setup and its
          menu coverage is current.
        </p>
      </div>
      <div className="overflow-x-auto rounded-card bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Venue</TableHead>
              <TableHead>Checklist</TableHead>
              <TableHead>Needs setup</TableHead>
              <TableHead>To review</TableHead>
              <TableHead>Overdue</TableHead>
              <TableHead>Menu</TableHead>
              <TableHead>Managers</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.venue.id}>
                <TableCell className="font-bold">
                  <Link
                    href={venueHref(row.venue.id)}
                    className="inline-flex min-h-11 items-center underline-offset-3 hover:underline focus-visible:underline sm:inline sm:min-h-0"
                  >
                    {row.venue.name}
                  </Link>
                  {row.coverage.complete ? (
                    <CoverageBadge tone="positive" className="ml-2">
                      Complete
                    </CoverageBadge>
                  ) : null}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.coverage.satisfied} of {row.coverage.applicable}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.coverage.needsSetup}
                  {row.coverage.amenityUnknown > 0
                    ? ` (${row.coverage.amenityUnknown} to verify)`
                    : null}
                  {row.coverage.needsReassignment > 0
                    ? `, ${row.coverage.needsReassignment} to reassign`
                    : null}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.coverage.pendingReview}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.coverage.overdue}
                </TableCell>
                <TableCell>
                  {labelFor(MENU_STATE_LABEL, row.coverage.menuState)}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {managerNames(row)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

/** Monthly staff participation per venue, reported apart from coverage. */
export function GroupParticipationTable({
  rows,
  periodLabel,
}: {
  rows: GroupOverviewRow[]
  periodLabel: string
}) {
  return (
    <section aria-labelledby="group-participation-title" className="grid gap-3">
      <div className="grid gap-1">
        <h2
          id="group-participation-title"
          className="font-display text-section-title text-ink"
        >
          Staff participation, {periodLabel}
        </h2>
        <p className="max-w-prose text-meta text-ink-muted">
          Monthly targets met with new photos accepted this month. A person
          without a target or team needs setup and is never counted complete.
        </p>
      </div>
      <div className="overflow-x-auto rounded-card bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Venue</TableHead>
              <TableHead>Staff</TableHead>
              <TableHead>Targets set</TableHead>
              <TableHead>Needs setup</TableHead>
              <TableHead>No target row</TableHead>
              <TableHead>Complete</TableHead>
              <TableHead>Accepted photos</TableHead>
              <TableHead>Self-reviews</TableHead>
              <TableHead>Last preparation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.venue.id}>
                <TableCell className="font-bold">
                  <Link
                    href={`${venueHref(row.venue.id)}/team`}
                    className="inline-flex min-h-11 items-center underline-offset-3 hover:underline focus-visible:underline sm:inline sm:min-h-0"
                  >
                    {row.venue.name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.participation.staff}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.participation.targetsSet}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.participation.targetsNeedingSetup}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.participation.staffWithoutTarget}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.participation.complete} of {row.participation.staff}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.participation.acceptedPhotos}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.selfReviews}
                </TableCell>
                <TableCell>
                  {row.lastPreparation ? (
                    <>
                      {formatDateTime(row.lastPreparation.at)}
                      {row.lastPreparation.status === "failed" ? (
                        <CoverageBadge tone="negative" className="ml-2">
                          Failed
                        </CoverageBadge>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-ink-muted">Never</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

/** Venues where active staff have no target row: a sign preparation did not run. */
export function MissingPeriodList({ missing }: { missing: MissingPeriod[] }) {
  if (missing.length === 0) {
    return (
      <p className="text-meta text-ink-muted">
        Every active person at an active venue has a target row for the month.
      </p>
    )
  }
  return (
    <ul aria-label="Missing periods" className="grid gap-1 text-meta">
      {missing.map((m) => (
        <li
          key={`${m.venue.id}:${m.period}`}
          className="font-semibold text-warn-fg"
        >
          <Link
            href={`${venueHref(m.venue.id)}/team`}
            className="font-bold underline underline-offset-3"
          >
            {m.venue.name}
          </Link>
          , {periodKeyLabel(m.period)}:{" "}
          {plural(m.staffWithoutTarget, "person", "people")} without a target
          row
        </li>
      ))}
    </ul>
  )
}
