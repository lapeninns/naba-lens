import { CaretRightIcon, CheckIcon } from "@phosphor-icons/react/dist/ssr"

import { PreparationRunsControl } from "@/app/staff/manage/_shared/controls"
import { formatDate } from "@/components/nabalens/format"
import { formatDateTime } from "@/components/nabalens/menus/copy"
import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import type {
  Page,
  PeriodView,
  PreparationRunView,
} from "@/lib/server/coverage/types"

import { SectionHead } from "./coverage-sections"
import {
  COVERAGE_COPY,
  PREPARATION_COPY,
  failureWords,
  monthName,
} from "./coverage-copy"
import {
  failuresFor,
  nextHourlyRun,
  type PreparationEntry,
  type PreparationModel,
  type VenuePreparation,
} from "./preparation"
import { PrepareButton, PrepareRetryButton } from "./prepare-control"

const TH =
  "px-3 py-2 text-left text-meta-strong text-ink-muted first:pl-4 last:pr-4"
const TD =
  "px-3 py-2.5 align-top text-body-touch text-ink first:pl-4 last:pr-4 md:text-body-sm max-md:flex max-md:gap-2 max-md:px-4 max-md:py-1 max-md:before:min-w-32 max-md:before:text-ink-muted max-md:before:content-[attr(data-label)]"
const TABLE =
  "w-full border-collapse max-md:block max-md:[&_tbody]:block max-md:[&_thead]:sr-only max-md:[&_tr]:block max-md:[&_tr]:py-2"

function runScope(entry: PreparationEntry, names: Record<string, string>) {
  return entry.run.venueId
    ? (names[entry.run.venueId] ?? PREPARATION_COPY.allVenuesScope)
    : PREPARATION_COPY.allVenuesScope
}

/** Plain words first; the code is never part of the sentence. */
function runResult(entry: PreparationEntry, names: Record<string, string>) {
  const prepared = entry.prepared.length
    ? PREPARATION_COPY.venuesPrepared(entry.prepared.map((v) => v.name))
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
      <CheckIcon aria-hidden className="size-4 shrink-0 text-positive" />
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
      className="grid scroll-mt-20 gap-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2
            id="preparation-title"
            className="text-section-title-touch text-ink md:text-section-title"
          >
            {PREPARATION_COPY.title}
          </h2>
          <p className="max-w-(--size-reading) text-body-touch text-ink-muted md:text-body-sm">
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
                    <p className="font-mono text-mono text-ink-muted">
                      {run.errorCode}
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
        <div className="overflow-x-auto rounded-panel border border-line">
          <table aria-label={PREPARATION_COPY.venuesTable} className={TABLE}>
            <thead className="border-b border-line">
              <tr>
                <th scope="col" className={TH}>
                  {PREPARATION_COPY.columns.venue}
                </th>
                <th scope="col" className={TH}>
                  {month}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {PREPARATION_COPY.columns.targetsCopied}
                </th>
                <th scope="col" className={TH}>
                  {PREPARATION_COPY.columns.needSetup}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {model.venues.map((venue) => (
                <tr key={venue.venue.id}>
                  <th
                    scope="row"
                    className={`${TD} text-left font-semibold max-md:before:content-none`}
                  >
                    {venue.venue.name}
                  </th>
                  <td data-label={month} className={TD}>
                    <MonthState venue={venue} />
                  </td>
                  <td
                    data-label={PREPARATION_COPY.columns.targetsCopied}
                    className={`${TD} tabular-nums md:text-right`}
                  >
                    {venue.withTarget} of {venue.staff}
                  </td>
                  <td
                    data-label={PREPARATION_COPY.columns.needSetup}
                    className={TD}
                  >
                    {needSetupText(venue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-3">
        <SectionHead
          id="preparation-runs-title"
          title={PREPARATION_COPY.recentRuns}
          note={PREPARATION_COPY.recentRunsNote}
        />
        {model.recent.length === 0 ? (
          <p className="text-body-touch text-ink-muted md:text-body-sm">
            {PREPARATION_COPY.noRecentRuns(formatDate(model.recentSince))}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-panel border border-line">
            <table aria-label={PREPARATION_COPY.recentRuns} className={TABLE}>
              <thead className="border-b border-line">
                <tr>
                  <th scope="col" className={TH}>
                    {PREPARATION_COPY.columns.when}
                  </th>
                  <th scope="col" className={TH}>
                    {PREPARATION_COPY.columns.startedBy}
                  </th>
                  <th scope="col" className={TH}>
                    {PREPARATION_COPY.columns.result}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {model.recent.map((entry) => (
                  <tr key={entry.run.id}>
                    <td
                      className={`${TD} whitespace-nowrap tabular-nums max-md:font-semibold max-md:before:content-none`}
                    >
                      {formatDateTime(entry.run.finishedAt)}
                    </td>
                    <td
                      data-label={PREPARATION_COPY.columns.startedBy}
                      className={TD}
                    >
                      {entry.run.trigger === "scheduled"
                        ? PREPARATION_COPY.hourly
                        : PREPARATION_COPY.manual}
                    </td>
                    <td
                      data-label={PREPARATION_COPY.columns.result}
                      className={TD}
                    >
                      {runResult(entry, venueNames)}
                      {entry.run.errorCode ? (
                        <>
                          {" "}
                          <span className="font-mono text-mono text-ink-muted">
                            {entry.run.errorCode}
                          </span>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details id="all-runs" className="group">
          <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 text-body-touch text-ink underline underline-offset-3 md:min-h-0 md:text-body-sm [&::-webkit-details-marker]:hidden">
            <CaretRightIcon
              aria-hidden
              className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
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
