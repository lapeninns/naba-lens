import { CaretRightIcon, CheckIcon } from "@phosphor-icons/react/dist/ssr"

import { PreparationRunsControl } from "@/app/staff/manage/_shared/controls"
import { formatDate } from "@/components/nabalens/format"
import { formatDateTime } from "@/components/nabalens/menus/copy"
import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type {
  Page,
  PeriodView,
  PreparationRunView,
} from "@/lib/server/coverage/types"

import { SectionHead } from "./coverage-sections"
import {
  COVERAGE_COPY,
  PREPARATION_COPY,
  failureCode,
  failureWords,
  monthName,
} from "./coverage-copy"
import {
  did,
  failuresFor,
  nextHourlyRun,
  type PreparationEntry,
  type PreparationModel,
  type VenuePreparation,
} from "./preparation"
import { PrepareButton, PrepareRetryButton } from "./prepare-control"

function runScope(entry: PreparationEntry, names: Record<string, string>) {
  return entry.run.venueId
    ? (names[entry.run.venueId] ?? PREPARATION_COPY.allVenuesScope)
    : PREPARATION_COPY.allVenuesScope
}

/**
 * Plain words first; the code is never part of the sentence. Only what the
 * run supports: the venues credited to it, else its scope and counts.
 */
function runResult(entry: PreparationEntry, names: Record<string, string>) {
  const { run } = entry
  const prepared = entry.prepared.length
    ? PREPARATION_COPY.venuesPrepared(entry.prepared.map((v) => v.name))
    : run.status === "succeeded" && did(run)
      ? `${runScope(entry, names)}: ${PREPARATION_COPY.runCounts(
          run.targetsCopied,
          run.placeholdersCreated,
          run.candidatesAdded
        )}`
      : null
  const failed =
    entry.run.status === "failed"
      ? `${runScope(entry, names)}: ${failureWords(entry.run.errorCode)}`
      : null
  return [prepared && failed ? `${prepared}.` : prepared, failed]
    .filter(Boolean)
    .join(" ")
}

function MonthState({ venue }: { venue: VenuePreparation }) {
  if (venue.state === "didnt_finish") {
    return (
      <StatusChip state="failed">{PREPARATION_COPY.didntFinish}</StatusChip>
    )
  }
  if (venue.state === "not_prepared") {
    return (
      <StatusChip state="needs_setup">
        {PREPARATION_COPY.notPrepared}
      </StatusChip>
    )
  }
  const at = venue.preparedAt ? formatDateTime(venue.preparedAt) : null
  return (
    <span className="inline-flex items-center gap-1.5">
      <CheckIcon aria-hidden className="size-5 shrink-0 text-ok-fg" />
      {PREPARATION_COPY.prepared(at)}
    </span>
  )
}

function needSetupText(venue: VenuePreparation) {
  if (venue.state === "not_prepared") return String(venue.needSetup)
  const why =
    venue.state === "didnt_finish" && venue.staffWithoutTarget > 0
      ? PREPARATION_COPY.targetNotCopied
      : PREPARATION_COPY.noTarget
  return PREPARATION_COPY.needSetupDetail(venue.needSetup, why)
}

/**
 * A17: whether every venue's month is set up, and what failed and why. The
 * venue table and Recent runs both read `model.entries`, so they always agree.
 */
export function PreparationSection({
  model,
  period,
  venueNames,
  allRuns,
  primary,
}: {
  model: PreparationModel
  period: PeriodView
  venueNames: Record<string, string>
  /** First page of every run, any month, for See all runs. */
  allRuns: Page<PreparationRunView>
  /** The page header already offers Prepare this month. */
  primary: boolean
}) {
  const month = monthName(period.label)
  const failed = model.unfinished
  return (
    <section
      id="preparation"
      aria-labelledby="preparation-title"
      className="grid scroll-mt-20 gap-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="preparation-title" className="type-section-title text-ink">
            {PREPARATION_COPY.title}
          </h2>
          <p className="max-w-reading text-body text-ink-muted">
            {PREPARATION_COPY.summary}
          </p>
        </div>
        {primary ? null : <PrepareButton primary={false} />}
      </div>

      {failed.length > 0 ? (
        <Notice
          tone="negative"
          title={PREPARATION_COPY.failedTitle(failed.length)}
          action={<PrepareRetryButton />}
        >
          <ul className="grid gap-1.5">
            {failed.map((venue) => {
              const run = failuresFor(model, venue)?.run
              return (
                <li key={venue.venue.id}>
                  <p>
                    {venue.venue.name}: {failureWords(run?.errorCode ?? null)}{" "}
                    {PREPARATION_COPY.safeToRepeat}
                  </p>
                  {run?.errorCode ? (
                    <p className="font-mono text-meta text-ink-muted">
                      {failureCode(run.errorCode)}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </Notice>
      ) : null}

      {model.unprepared.length > 0 ? (
        <Notice
          tone="attention"
          title={COVERAGE_COPY.unpreparedTitle(model.unprepared.length)}
        >
          <p>
            {PREPARATION_COPY.unpreparedBody(
              model.unprepared.map((v) => v.venue.name),
              month
            )}
          </p>
        </Notice>
      ) : null}

      {failed.length === 0 && model.noSuccessThisMonth ? (
        <Notice tone="attention">
          <p>{PREPARATION_COPY.firstRun(nextHourlyRun(new Date()))}</p>
        </Notice>
      ) : null}

      <div className="grid gap-3">
        <SectionHead
          id="preparation-venues-title"
          title={PREPARATION_COPY.venues}
          note={PREPARATION_COPY.venuesNote}
        />
        <Table stacked framed aria-label={PREPARATION_COPY.venuesTable}>
          <TableHeader>
            <TableRow>
              <TableHead>{PREPARATION_COPY.columns.venue}</TableHead>
              <TableHead>{month}</TableHead>
              <TableHead numeric>
                {PREPARATION_COPY.columns.targetsCopied}
              </TableHead>
              <TableHead>{PREPARATION_COPY.columns.needSetup}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.venues.map((venue) => (
              <TableRow key={venue.venue.id}>
                <TableHead scope="row" className="text-label text-ink">
                  {venue.venue.name}
                </TableHead>
                <TableCell label={month} className="whitespace-normal">
                  <MonthState venue={venue} />
                </TableCell>
                <TableCell
                  label={PREPARATION_COPY.columns.targetsCopied}
                  numeric
                >
                  {venue.withTarget} of {venue.staff}
                </TableCell>
                <TableCell
                  label={PREPARATION_COPY.columns.needSetup}
                  className="whitespace-normal"
                >
                  {needSetupText(venue)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3">
        <SectionHead
          id="preparation-runs-title"
          title={PREPARATION_COPY.recentRuns}
          note={PREPARATION_COPY.recentRunsNote}
        />
        {model.recent.length === 0 ? (
          <p className="px-1 text-body text-ink-muted">
            {PREPARATION_COPY.noRecentRuns(formatDate(model.recentSince))}
          </p>
        ) : (
          <Table stacked framed aria-label={PREPARATION_COPY.recentRuns}>
            <TableHeader>
              <TableRow>
                <TableHead>{PREPARATION_COPY.columns.when}</TableHead>
                <TableHead>{PREPARATION_COPY.columns.startedBy}</TableHead>
                <TableHead>{PREPARATION_COPY.columns.result}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.recent.map((entry) => (
                <TableRow key={entry.run.id}>
                  <TableCell className="tabular-nums max-md:font-semibold">
                    {formatDateTime(entry.run.finishedAt)}
                  </TableCell>
                  <TableCell label={PREPARATION_COPY.columns.startedBy}>
                    {entry.run.trigger === "scheduled"
                      ? PREPARATION_COPY.hourly
                      : PREPARATION_COPY.manual}
                  </TableCell>
                  <TableCell
                    label={PREPARATION_COPY.columns.result}
                    className="whitespace-normal"
                  >
                    {runResult(entry, venueNames)}
                    {entry.run.errorCode ? (
                      <>
                        {" "}
                        <span className="font-mono text-meta text-ink-muted">
                          {failureCode(entry.run.errorCode)}
                        </span>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <details id="all-runs" className="group">
          <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 px-1 text-body font-semibold text-ink underline underline-offset-4 focus-ring outline-none [&::-webkit-details-marker]:hidden">
            <CaretRightIcon
              aria-hidden
              className="size-5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
            {PREPARATION_COPY.seeAllRuns}
          </summary>
          <div className="pt-3">
            <PreparationRunsControl initial={allRuns} venueNames={venueNames} />
          </div>
        </details>
      </div>
    </section>
  )
}
