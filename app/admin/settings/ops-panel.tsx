import {
  CoverageSection,
  Tally,
  TallyItem,
} from "@/components/nabalens/coverage"
import { EmptyState } from "@/components/nabalens/empty-state"
import { StatusChip } from "@/components/nabalens/status-chip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CATEGORIES, formatBytes } from "@/lib/ops/settings"
import { exceptionText, jobWords, type OpsStatus } from "@/lib/ops/status"
import type { Integration } from "@/lib/server/ops/integrations"

// Settings' read-only panels (spec §8 A7, §16): what needs attention first
// (DESIGN.md §11 rule 3), then operations, limits, categories and
// integrations. Server components: nothing here is interactive.

const DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})
export const when = (iso: string | null) =>
  iso ? DATE.format(new Date(iso)) : "Never"

export function ExceptionsPanel({ status }: { status: OpsStatus }) {
  const items = status.exceptions
  return (
    <CoverageSection
      id="exceptions"
      title="Needs attention"
      count={items.length > 0 ? items.length : undefined}
    >
      {items.length === 0 ? (
        <EmptyState
          variant="done"
          title="Nothing needs attention."
          description="Storage, processing, jobs, backlogs and venue setup are all fine."
        />
      ) : (
        <ul className="grid divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {items.map((e, i) => {
            const words = exceptionText(e)
            return (
              <li
                key={`${e.topic}-${e.venueId ?? i}`}
                className="grid gap-0.5 px-4 py-3.5"
              >
                <p className="font-bold text-ink">{words.title}</p>
                <p className="text-body text-ink-muted">{words.detail}</p>
              </li>
            )
          })}
        </ul>
      )}
    </CoverageSection>
  )
}

export function OperationsPanel({ status }: { status: OpsStatus }) {
  const s = status.storage
  return (
    <CoverageSection
      id="operations"
      title="Operations"
      count={`at ${when(status.generatedAt)}`}
    >
      <Tally>
        <TallyItem
          label="Storage used"
          value={Math.round(s.percent)}
          note={`% · ${formatBytes(s.usedBytes)} of ${formatBytes(s.quotaBytes)}`}
          tone={s.state === "ok" ? "neutral" : "attention"}
        />
        <TallyItem
          label="Stuck processing"
          value={status.processing.stuck}
          note={`${status.processing.processing} processing now`}
          tone="attention"
        />
        <TallyItem
          label="Failed uploads, last day"
          value={status.processing.failedLastDay}
          note={`${status.processing.failedLastWeek} this week`}
          tone="attention"
        />
        <TallyItem
          label="Preparation failures"
          value={status.preparation.failedLast30Days}
          note="Last 30 days"
          tone="attention"
        />
      </Tally>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <Table stacked>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Last success</TableHead>
              <TableHead>Failures this week</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Original archive check</TableCell>
              <TableCell label="Last run">
                {when(status.archive.lastRunAt)}
              </TableCell>
              <TableCell label="State">
                <JobState
                  state={
                    !status.archive.outcome
                      ? null
                      : ["timeout", "lease_lost", "failed"].includes(
                            status.archive.outcome
                          )
                        ? "failed"
                        : "succeeded"
                  }
                />
              </TableCell>
              <TableCell label="Last success">
                {when(status.archive.lastCompletedCycleAt)}
              </TableCell>
              <TableCell label="Failures this week" numeric>
                {status.archive.error ? "1+" : "0"}
              </TableCell>
            </TableRow>
            {status.jobs.map((j) => (
              <TableRow key={j.job}>
                <TableCell>{jobWords(j.job)}</TableCell>
                <TableCell label="Last run">{when(j.lastRunAt)}</TableCell>
                <TableCell label="State">
                  <JobState state={j.lastState} code={j.lastErrorCode} />
                </TableCell>
                <TableCell label="Last success">
                  {when(j.lastSuccessAt)}
                </TableCell>
                <TableCell label="Failures this week" numeric>
                  {j.failuresLastWeek}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="px-1 text-meta text-ink-muted">
        Last restore rehearsal:{" "}
        {status.restoreRehearsal.lastAt
          ? `${when(status.restoreRehearsal.lastAt)} (${status.restoreRehearsal.state === "succeeded" ? "records and files matched" : "failed"})`
          : "none recorded. See docs/backup-restore.md."}
      </p>
    </CoverageSection>
  )
}

function JobState({
  state,
  code,
}: {
  state: string | null
  code?: string | null
}) {
  if (state === "failed")
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <StatusChip state="failed">Failed</StatusChip>
        {code ? <span className="text-meta text-ink-muted">{code}</span> : null}
      </span>
    )
  if (state === "succeeded") return <span>Ran</span>
  if (state === "running") return <span>Running</span>
  return <span className="text-ink-muted">Not run yet</span>
}

export function LimitsPanel({
  limits,
}: {
  limits: { photoBytes: number; videoBytes: number; batchFiles: number }
}) {
  return (
    <CoverageSection id="limits" title="Media limits">
      <dl className="grid gap-x-6 gap-y-2 rounded-card border border-line bg-surface p-4 sm:grid-cols-[max-content_1fr]">
        <dt className="font-bold">Largest photo</dt>
        <dd>{formatBytes(limits.photoBytes)}</dd>
        <dt className="font-bold">Largest video</dt>
        <dd>{formatBytes(limits.videoBytes)}</dd>
        <dt className="font-bold">Files in one batch</dt>
        <dd>{limits.batchFiles}</dd>
      </dl>
      <p className="px-1 text-meta text-ink-muted">
        Set with each release, so the phone and the server always agree. Ask for
        a change in a release.
      </p>
    </CoverageSection>
  )
}

export function CategoriesPanel() {
  return (
    <CoverageSection id="categories" title="Categories">
      <p className="px-1 text-body">
        {CATEGORIES.join(", ")}. These five are fixed so every venue reads the
        same way; places say where a photo was taken.
      </p>
    </CoverageSection>
  )
}

export function IntegrationsPanel({
  integrations,
}: {
  integrations: Integration[]
}) {
  return (
    <CoverageSection id="integrations" title="Integrations">
      <ul className="grid divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {integrations.map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5"
          >
            <div className="grid gap-0.5">
              <p className="font-bold">{i.name}</p>
              <p className="text-meta text-ink-muted">{i.purpose}</p>
            </div>
            <span className="text-body">
              {i.configured ? "Set up" : "Not set up"}
            </span>
          </li>
        ))}
      </ul>
      <p className="px-1 text-meta text-ink-muted">
        Keys and passwords are kept in the hosting environment and never shown
        here.
      </p>
    </CoverageSection>
  )
}
