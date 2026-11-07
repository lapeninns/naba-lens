import Link from "next/link"
import {
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  ClockCountdownIcon,
  StorefrontIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr"

import { periodKeyLabel } from "@/components/nabalens/coverage/copy"
import { StatusChip } from "@/components/nabalens/status-chip"
import { buttonVariants } from "@/components/ui/button"
import type { GroupOverviewRow, PeriodKey } from "@/lib/server/coverage/types"
import { shiftPeriod } from "@/lib/server/coverage/time"
import { cn } from "@/lib/utils"

import { COVERAGE_COPY } from "./coverage-copy"

const venueHref = (id: string) => `/admin/coverage/${encodeURIComponent(id)}`
const periodHref = (period: PeriodKey, current: PeriodKey) =>
  period === current ? "/admin/coverage" : `/admin/coverage?period=${period}`

export function SectionHead({
  id,
  title,
  note,
}: {
  id: string
  title: string
  note?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="font-display text-section-title text-ink">
        {title}
      </h2>
      {note ? (
        <span className="font-mono text-meta text-ink-muted tabular-nums">
          {note}
        </span>
      ) : null}
    </div>
  )
}

export function MonthNav({
  period,
  current,
  label,
}: {
  period: PeriodKey
  current: PeriodKey
  label: string
}) {
  const previous = shiftPeriod(period, -1)
  const next = shiftPeriod(period, 1)
  const isCurrent = period === current
  const icon = buttonVariants({ variant: "quiet", size: "icon" })
  return (
    <div
      role="group"
      aria-label={COVERAGE_COPY.month}
      className="flex flex-wrap items-center gap-1"
    >
      <Link
        href={periodHref(previous, current)}
        aria-label={COVERAGE_COPY.previousMonth(periodKeyLabel(previous))}
        className={icon}
      >
        <CaretLeftIcon aria-hidden />
      </Link>
      <span
        aria-current={isCurrent ? "date" : undefined}
        className="min-w-36 text-center font-display text-label text-ink tabular-nums"
      >
        {label}
      </span>
      {isCurrent ? (
        <button
          type="button"
          disabled
          aria-label={COVERAGE_COPY.nextNotStarted}
          className={cn(icon, "opacity-40")}
        >
          <CaretRightIcon aria-hidden />
        </button>
      ) : (
        <Link
          href={periodHref(next, current)}
          aria-label={COVERAGE_COPY.nextMonth(periodKeyLabel(next))}
          className={icon}
        >
          <CaretRightIcon aria-hidden />
        </Link>
      )}
      {!isCurrent ? <StatusChip state="read_only" className="ml-2" /> : null}
    </div>
  )
}

type Tone = "plain" | "attention" | "negative" | "positive"

function TallyItem({
  label,
  value,
  of,
  note,
  tone = "plain",
}: {
  label: string
  value: number
  of?: number
  note?: string
  tone?: Tone
}) {
  const active = tone !== "plain" && tone !== "positive" && value > 0
  const Icon = tone === "negative" ? ClockCountdownIcon : WarningIcon
  return (
    <div className="grid content-start gap-1 rounded-card bg-surface px-4 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
      <dt className="text-meta text-ink-muted">{label}</dt>
      <dd
        className={cn(
          "flex items-baseline gap-1.5 font-display text-count text-ink tabular-nums",
          active && "text-warn-fg",
          tone === "positive" && "text-ok-fg"
        )}
      >
        {active ? <Icon aria-hidden className="size-6 self-center" /> : null}
        {value}
        {of !== undefined ? (
          <small className="text-lead font-bold text-ink-muted">of {of}</small>
        ) : null}
      </dd>
      {note ? <dd className="text-meta text-ink-muted">{note}</dd> : null}
    </div>
  )
}

const sum = (rows: GroupOverviewRow[], pick: (r: GroupOverviewRow) => number) =>
  rows.reduce((n, r) => n + pick(r), 0)

const isMenuChanged = (row: GroupOverviewRow) =>
  row.coverage.menuState === "menu_changed" ||
  row.coverage.menuState === "reconciliation_pending"

/** Venue coverage and staff participation, side by side and never blended. */
export function Tallies({
  rows,
  periodLabel,
}: {
  rows: GroupOverviewRow[]
  periodLabel: string
}) {
  const setupVenues = rows.filter((r) => r.coverage.needsSetup > 0).length
  const withoutTarget = sum(rows, (r) => r.participation.staffWithoutTarget)
  return (
    <div className="grid items-start gap-(--gutter) lg:grid-cols-2">
      <section
        aria-labelledby="venue-coverage-title"
        className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
      >
        <SectionHead
          id="venue-coverage-title"
          title={COVERAGE_COPY.venueCoverage}
          note={periodLabel}
        />
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <TallyItem
            label={COVERAGE_COPY.tally.venuesComplete}
            value={rows.filter((r) => r.coverage.complete).length}
            of={rows.length}
          />
          <TallyItem
            label={COVERAGE_COPY.tally.needSetup}
            value={sum(rows, (r) => r.coverage.needsSetup)}
            note={
              setupVenues > 0
                ? COVERAGE_COPY.tally.acrossVenues(setupVenues)
                : undefined
            }
            tone="attention"
          />
          <TallyItem
            label={COVERAGE_COPY.tally.toReview}
            value={sum(rows, (r) => r.coverage.pendingReview)}
          />
          <TallyItem
            label={COVERAGE_COPY.tally.overdue}
            value={sum(rows, (r) => r.coverage.overdue)}
            tone="negative"
          />
          <TallyItem
            label={COVERAGE_COPY.tally.menuChanged}
            value={rows.filter(isMenuChanged).length}
            tone="attention"
          />
        </dl>
      </section>
      <section
        aria-labelledby="staff-participation-title"
        className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
      >
        <SectionHead
          id="staff-participation-title"
          title={COVERAGE_COPY.staffParticipation}
          note={periodLabel}
        />
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <TallyItem
            label={COVERAGE_COPY.tally.metTarget}
            value={sum(rows, (r) => r.participation.complete)}
            of={sum(rows, (r) => r.participation.staff)}
            tone="positive"
          />
          <TallyItem
            label={COVERAGE_COPY.tally.photosAccepted}
            value={sum(rows, (r) => r.participation.acceptedPhotos)}
          />
          <TallyItem
            label={COVERAGE_COPY.tally.needSetup}
            value={sum(
              rows,
              (r) =>
                r.participation.targetsNeedingSetup +
                r.participation.staffWithoutTarget
            )}
            note={
              withoutTarget > 0
                ? COVERAGE_COPY.tally.withoutTarget(withoutTarget)
                : undefined
            }
            tone="attention"
          />
        </dl>
      </section>
    </div>
  )
}

function Frames({
  label,
  count,
  total,
  of,
}: {
  label: string
  count: number
  total: number
  of: string
}) {
  const width = total > 0 ? Math.min(100, (count / total) * 100) : 0
  return (
    <div className="grid content-start gap-1">
      <p className="text-meta text-ink-muted">{label}</p>
      <p className="flex items-baseline gap-1 tabular-nums">
        <span className="text-label text-ink">{count}</span>
        <span className="text-meta text-ink-muted">{of}</span>
      </p>
      <div
        aria-hidden
        className="h-2 overflow-hidden rounded-round bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]"
      >
        <span
          className="block h-full rounded-round bg-ok-fg"
          style={{ width: `${width.toFixed(1)}%` }}
        />
      </div>
    </div>
  )
}

/** One row per venue: its flags, then coverage and participation apart. */
export function VenueList({ rows }: { rows: GroupOverviewRow[] }) {
  return (
    <section aria-labelledby="venues-title" className="grid gap-3">
      <SectionHead
        id="venues-title"
        title={COVERAGE_COPY.venues}
        note={COVERAGE_COPY.venuesNote(rows.length)}
      />
      <ul
        aria-labelledby="venues-title"
        className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
      >
        {rows.map((row) => (
          <li key={row.venue.id}>
            <Link
              href={venueHref(row.venue.id)}
              className="grid min-h-16 gap-3 px-4 py-3.5 outline-none hover:bg-surface-2 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus focus-visible:outline-solid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-6"
            >
              <div className="grid min-w-0 gap-1.5">
                <p className="flex items-center gap-2 text-item-title text-ink">
                  <StorefrontIcon aria-hidden className="size-5 shrink-0" />
                  <span className="break-words">{row.venue.name}</span>
                </p>
                <VenueFlags row={row} />
              </div>
              <Frames
                label={COVERAGE_COPY.venueCoverage}
                count={row.coverage.satisfied}
                total={row.coverage.applicable}
                of={COVERAGE_COPY.itemsComplete(row.coverage.applicable)}
              />
              <Frames
                label={COVERAGE_COPY.staffParticipation}
                count={row.participation.complete}
                total={row.participation.staff}
                of={COVERAGE_COPY.metTheirTarget(row.participation.staff)}
              />
              <CaretRightIcon
                aria-hidden
                className="hidden size-5 text-ink-muted md:block"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function VenueFlags({ row }: { row: GroupOverviewRow }) {
  const { coverage } = row
  const setup = coverage.needsSetup + coverage.needsReassignment
  if (coverage.complete) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <StatusChip state="complete" />
      </div>
    )
  }
  const flags = [
    setup > 0 ? (
      <StatusChip key="setup" state="needs_setup">
        {COVERAGE_COPY.chip.needSetup(setup)}
      </StatusChip>
    ) : null,
    isMenuChanged(row) ? <StatusChip key="menu" state="menu_changed" /> : null,
    coverage.pendingReview > 0 ? (
      <StatusChip key="review" tone="neutral">
        {COVERAGE_COPY.chip.toReview(coverage.pendingReview)}
      </StatusChip>
    ) : null,
    coverage.overdue > 0 ? (
      <StatusChip key="overdue" state="overdue">
        {COVERAGE_COPY.chip.overdue(coverage.overdue)}
      </StatusChip>
    ) : null,
  ].filter(Boolean)
  return flags.length ? (
    <div className="flex flex-wrap gap-1.5">{flags}</div>
  ) : null
}

/** A16's one-line summaries; each links down to its full section. */
export function SummaryLine({
  icon,
  children,
}: {
  icon: "check" | "prepare"
  children: React.ReactNode
}) {
  const Icon = icon === "check" ? CheckIcon : WarningIcon
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-ink">
      <Icon
        aria-hidden
        className={cn(
          "size-5 shrink-0",
          icon === "check" ? "text-ok-fg" : "text-warn-fg"
        )}
      />
      {children}
    </p>
  )
}
