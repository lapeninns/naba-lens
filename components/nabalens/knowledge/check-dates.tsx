import type {
  FreshnessEntry,
  RecheckTask,
} from "@/lib/knowledge-client/contract"

import { CoverageSection } from "@/components/nabalens/coverage"

import {
  CHECK_DATES_COPY as COPY,
  checkDateBasis,
  checkDateLine,
  recheckCauseLine,
} from "./copy"

/**
 * Check dates on a check page (B03 UI design §6.1, §6.3): each rated use's
 * state and what it counts from, then the open rechecks. Freshness is the
 * server's, read with the answer; nothing is computed here.
 */
export function CheckDatesSection({
  freshness,
  rechecks,
  assignee,
  findingWaiting,
  policy = false,
}: {
  freshness: readonly FreshnessEntry[]
  /** The check's open rechecks; null when they couldn't be read. */
  rechecks: { count: number; tasks: readonly RecheckTask[] } | null
  /** The check's assignee's name, or null when not assigned. */
  assignee: string | null
  /** A finding on this check is waiting for a decision. */
  findingWaiting: boolean
  policy?: boolean
}) {
  const internal = freshness.filter((entry) => entry.use === "internal")
  const rated = internal.filter((entry) => entry.state !== "unrated")
  const expired = rated.some(
    (entry) => entry.state === "expired" || entry.state === "basis_missing"
  )
  return (
    <CoverageSection id="amenity-check-dates" title={COPY.title}>
      {rated.length === 0 ? (
        <p className="text-body-touch text-ink md:text-body">{COPY.noRule}</p>
      ) : (
        <ul className="grid gap-2 text-body-touch text-ink md:text-body">
          {rated.map((entry) => {
            const basis = checkDateBasis(entry)
            return (
              <li key={entry.use} className="grid gap-0.5">
                <span>{checkDateLine(entry, { policy })}</span>
                {basis ? (
                  <span className="text-meta-touch text-ink-muted md:text-meta">
                    {basis}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {rechecks === null ? (
        <p className="text-body-touch text-ink md:text-body">
          {COPY.rechecksFailed}
        </p>
      ) : rechecks.tasks.length ? (
        <ul className="grid gap-2 text-body-touch text-ink md:text-body">
          {rechecks.tasks.map((task) => (
            <li key={task.taskId}>
              {COPY.recheckOpen(recheckCauseLine(task, { policy }), assignee)}
            </li>
          ))}
        </ul>
      ) : rechecks.count > 0 ? (
        <p className="text-body-touch text-ink md:text-body">
          {COPY.rechecksCount(rechecks.count)}
        </p>
      ) : expired ? (
        <p className="text-body-touch text-ink md:text-body">
          {COPY.opensWithinHour}
        </p>
      ) : null}
      {findingWaiting && (rechecks?.count ?? 0) > 0 ? (
        <p className="text-body-touch text-ink md:text-body">
          {COPY.waitingFinding}
        </p>
      ) : null}
    </CoverageSection>
  )
}
