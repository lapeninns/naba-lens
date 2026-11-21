import { CoverageSection } from "@/components/nabalens/coverage"
import { Row, RowList } from "@/components/nabalens/common-room/row"
import { EmptyState } from "@/components/nabalens/empty-state"
import { MetaList } from "@/components/nabalens/meta-list"
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

// v2 tones: something failed is a problem; the rest need a person to act.
const PROBLEM_TOPICS = new Set(["processing", "job", "archive", "preparation"])

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
        <ul className="grid gap-2">
          {items.map((e, i) => {
            const words = exceptionText(e)
            return (
              <li key={`${e.topic}-${e.venueId ?? i}`}>
                {/* v2 SCREENS A1: problem and attention Notices first. Page
                    content, not a message after an action: no live role. */}
                <Notice
                  tone={PROBLEM_TOPICS.has(e.topic) ? "negative" : "attention"}
                  role="none"
                  title={words.title}
                >
                  <p className="text-ink-muted">{words.detail}</p>
                </Notice>
              </li>
            )
          })}
        </ul>
      )}
    </CoverageSection>
  )
}

/**
 * Settings › Rules (handoff): what needs attention, as one notice at the
 * top. Nothing when nothing does; Operations shows the rest is fine.
 */
export function AttentionNotice({ status }: { status: OpsStatus }) {
  const items = status.exceptions
  if (items.length === 0) return null
  const problem = items.some((e) => PROBLEM_TOPICS.has(e.topic))
  return (
    <Notice
      tone={problem ? "negative" : "attention"}
      // Page content, not a message after an action: no live role.
      role="none"
      title={
        items.length === 1
          ? "1 thing needs attention"
          : `${items.length} things need attention`
      }
      data-testid="settings-attention"
    >
      <ul className="grid gap-1">
        {items.map((e, i) => {
          const words = exceptionText(e)
          return (
            <li key={`${e.topic}-${e.venueId ?? i}`}>
              <span className="font-semibold">{words.title}.</span>{" "}
              {words.detail}
            </li>
          )
        })}
      </ul>
    </Notice>
  )
}

/** Operations at a glance (handoff "Settings › Rules"): one row each. */
export function OperationsPanel({ status }: { status: OpsStatus }) {
  const s = status.storage
  const p = status.processing
  return (
    <CoverageSection
      id="operations"
      title="Operations"
      count={`at ${when(status.generatedAt)}`}
    >
      <RowList list>
        <Row
          title="Storage used"
          subtitle={`${formatBytes(s.usedBytes)} of ${formatBytes(s.quotaBytes)} · ${Math.round(s.percent)}%`}
          end={s.state === "ok" ? null : <StatusChip state="needs_attention" />}
        />
        <Row
          title="Stuck processing"
          subtitle={`${p.stuck === 0 ? "None" : p.stuck} · ${p.processing} processing now`}
          end={
            p.stuck === 0 ? (
              <StatusChip state="complete" />
            ) : (
              <StatusChip state="needs_attention" />
            )
          }
        />
        <Row
          title="Failed uploads, last day"
          subtitle={`${p.failedLastDay} · ${p.failedLastWeek} this week`}
        />
        <Row
          title="Preparation failures"
          subtitle={`${status.preparation.failedLast30Days} in the last 30 days`}
        />
      </RowList>
    </CoverageSection>
  )
}

/** Where the shared set-up sits on this page (handoff "Shared set-up"). */
export function SharedSetupPanel() {
  return (
    <CoverageSection id="shared-setup" title="Shared set-up">
      <RowList list>
        <Row
          href="#shot-templates"
          title="Shot templates"
          subtitle={CATEGORIES.join(", ")}
        />
        <Row
          href="#limits"
          title="Media limits"
          subtitle="Largest photo, largest video, files in one batch"
        />
        <Row
          href="#jobs"
          title="Scheduled jobs"
          subtitle="Each job's last run and failures this week"
        />
        <Row
          href="#integrations"
          title="Integrations"
          subtitle="Original archive, alert email and other services"
        />
      </RowList>
    </CoverageSection>
  )
}

/** Each scheduled job's last run: wide, so a full row under the rules. */
export function JobsPanel({ status }: { status: OpsStatus }) {
  return (
    <CoverageSection id="jobs" title="Scheduled jobs">
      <Table stacked framed>
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
      <div className="rounded-card bg-surface p-4 shadow-card">
        <MetaList
          items={[
            { label: "Largest photo", value: formatBytes(limits.photoBytes) },
            { label: "Largest video", value: formatBytes(limits.videoBytes) },
            { label: "Files in one batch", value: limits.batchFiles },
          ]}
        />
      </div>
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
      <RowList list>
        {integrations.map((i) => (
          <Row
            key={i.id}
            title={i.name}
            subtitle={i.purpose}
            end={
              <span className="text-body text-ink">
                {i.configured ? "Set up" : "Not set up"}
              </span>
            }
          />
        ))}
      </RowList>
      <p className="px-1 text-meta text-ink-muted">
        Keys and passwords are kept in the hosting environment and never shown
        here.
      </p>
    </CoverageSection>
  )
}
