import Link from "next/link"
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { EmptyState } from "@/components/nabalens/empty-state"
import {
  StatusChip,
  type ChipStateKey as ChipState,
} from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import { fieldControlVariants } from "@/components/ui/field-control"
import { OptionRow } from "@/components/ui/option-row"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ageWords,
  attentionFirst,
  attentionWords,
  categoryHref,
  categoryTotals,
  CHECK_PARTS,
  DEFAULT_BACKLOG_ALERT_DAYS,
  ofWords,
  OVERVIEW_CATEGORIES,
  periodLabel,
  rowAttention,
  rowHrefs,
  type Attention,
  type CategoryCounts,
  type OverviewFilters,
  type OverviewRow,
} from "@/lib/admin/overview"
import { operatingStatusChip, type OperatingStatus } from "@/lib/admin/venues"
import { cn } from "@/lib/utils"

/*
 * Group overview (spec §8 A1). First what needs attention (blocked setup,
 * publication errors, checks due, long-waiting photos), then the table:
 * venues down; coverage by category, confirmed facts, unlabelled backlog,
 * oldest review, checks due, publication errors and photos added in the
 * period across. Every number is a link to the records behind it, and each
 * category number is the one slot rule's own "n of N" (FA-8, AC39). Venues
 * are in name order; nothing ranks people (§18). Below md the table becomes
 * one row per venue with a single meter; the category split is one tap away
 * on the venue (handoff, Overview 390px).
 */

export const OVERVIEW_COPY = {
  title: "Overview",
  scope: "All venues",
  summary:
    "Every venue's album and backlog. Each number opens the records behind it.",
  attentionTitle: "Venues needing attention",
  attentionOf: (n: number, of: number) => `${n} of ${of}`,
  attentionNone:
    "No venue has blocked setup, errors, checks due or a long wait.",
  tableTitle: "By venue",
  venue: "Venue",
  facts: "Facts confirmed",
  unlabelled: "Unlabelled",
  review: "Oldest waiting",
  checks: "Checks due",
  publication: "Publication errors",
  added: (period: string) => `Added in ${periodLabel(period)}`,
  allVenues: "All venues",
  noSlots: "None listed",
  nothingWaiting: "Nothing waiting",
  noNextMenu: "No menu scheduled",
  waiting: (n: number) => (n === 1 ? "1 waiting" : `${n} waiting`),
  checkDue: (n: number) => (n === 1 ? "1 check due" : `${n} checks due`),
  inAlbum: "In the album",
  tableKey:
    "In the album, of every slot the venue has. Darker cells are fuller; a brass outline is under half.",
  showMore: (n: number) =>
    n === 1 ? "Show 1 more venue" : `Show ${n} more venues`,
  emptyTitle: "No venues match",
  emptyText: "Choose all venues, or add a venue under Venues.",
}

const NUMBER_LINK =
  "inline-flex min-h-10 flex-wrap items-center gap-x-1 font-mono text-mono font-semibold tabular-nums text-ink underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"

function NumberLink({
  href,
  children,
  label,
  testId,
}: {
  href: string
  children: React.ReactNode
  label: string
  testId?: string
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={NUMBER_LINK}
      data-testid={testId}
    >
      {children}
    </Link>
  )
}

/*
 * The cell is a tinted block that reads "30 of 34" (handoff, Overview › By
 * venue). The tint is a second signal, never the only one: darker is fuller,
 * a full cell is bottle, and under half takes the brass outline. The words
 * carry the meaning. The tint is drawn from md only: below md the table is
 * not shown (the phone list has one meter per venue).
 */
export const CELL_BASE =
  "inline-grid min-h-8 min-w-16 place-items-center rounded-square px-2 font-sans text-meta font-semibold whitespace-nowrap tabular-nums"

export function cellTint(c: { covered: number; total: number }) {
  if (c.total === 0) return "bg-surface-2 text-ink"
  // A full cell is bottle: its words and focus ring take on-ok, since the ink
  // ring is under 3:1 on bottle (review Z4).
  if (c.covered >= c.total) return "bg-ok-fg text-on-ok [--focus:var(--on-ok)]"
  if (c.covered * 2 < c.total)
    return "bg-warn-bg text-warn-fg ring-1 ring-brass ring-inset"
  return "bg-ok-half text-ink"
}

const CELL_LINK =
  "inline-flex min-h-10 items-center rounded-square focus-ring outline-none"

function CategoryCell({
  row,
  counts,
  label,
  filters,
}: {
  row: OverviewRow
  counts: CategoryCounts | undefined
  label: string
  filters: OverviewFilters
}) {
  if (
    filters.menu === "next" &&
    !row.nextMenu &&
    counts &&
    ["food", "drinks", "other"].includes(counts.category)
  )
    return (
      <TableCell label={label} className="text-meta text-ink-muted">
        {OVERVIEW_COPY.noNextMenu}
      </TableCell>
    )
  if (!counts || counts.total === 0)
    return (
      <TableCell label={label} className="text-meta text-ink-muted">
        {OVERVIEW_COPY.noSlots}
      </TableCell>
    )
  const words = ofWords(counts.covered, counts.total)
  const notes = [
    counts.pending > 0 ? OVERVIEW_COPY.waiting(counts.pending) : null,
    counts.checkDue > 0 ? OVERVIEW_COPY.checkDue(counts.checkDue) : null,
  ].filter(Boolean)
  return (
    <TableCell label={label} data-testid={`overview-${counts.category}`}>
      <span className="grid justify-items-start gap-0.5">
        <Link
          href={categoryHref(
            row.venueId,
            counts.category,
            filters.menu,
            row.nextMenu?.versionId ?? null
          )}
          aria-label={`${label} at ${row.name}: ${words.main} covered${
            words.pct ? `, ${words.pct}` : ""
          }`}
          className={CELL_LINK}
        >
          <span
            className={cn(CELL_BASE, cellTint(counts))}
            data-testid="overview-cell"
          >
            {words.main}
          </span>
        </Link>
        {notes.length ? (
          <span className="text-meta text-ink-muted">{notes.join(" · ")}</span>
        ) : null}
      </span>
    </TableCell>
  )
}

function OverviewTable({
  rows,
  filters,
  now,
}: {
  rows: OverviewRow[]
  filters: OverviewFilters
  now: Date
}) {
  const columns = OVERVIEW_CATEGORIES.filter((c) =>
    filters.categories.includes(c.key)
  )
  return (
    <div className="hidden gap-2 md:grid">
      <Table
        framed
        aria-labelledby="overview-table-title"
        className="min-w-[60rem]"
        aria-describedby="overview-table-key"
        data-testid="overview-table"
      >
        <TableHeader>
          <TableRow>
            <TableHead>{OVERVIEW_COPY.venue}</TableHead>
            {columns.map((c) => (
              <TableHead key={c.key}>{c.label}</TableHead>
            ))}
            <TableHead>{OVERVIEW_COPY.facts}</TableHead>
            <TableHead>{OVERVIEW_COPY.unlabelled}</TableHead>
            <TableHead>{OVERVIEW_COPY.review}</TableHead>
            <TableHead>{OVERVIEW_COPY.checks}</TableHead>
            <TableHead>{OVERVIEW_COPY.publication}</TableHead>
            <TableHead>{OVERVIEW_COPY.added(filters.period)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const href = rowHrefs(row, filters)
            const facts = ofWords(row.facts.confirmed, row.facts.total)
            const age = ageWords(row.review.oldestAt, now)
            return (
              <TableRow
                key={row.venueId}
                className="hover:bg-transparent"
                data-testid="overview-row"
                data-venue={row.venueId}
              >
                <TableHead scope="row" className="text-ink md:min-w-48">
                  <span className="grid gap-1">
                    <Link
                      href={href.venue}
                      className="inline-flex min-h-10 items-center underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
                    >
                      {row.name}
                    </Link>
                    {row.operatingStatus !== "open" ? (
                      <StatusChip
                        state={operatingStatusChip(
                          row.operatingStatus as OperatingStatus
                        )}
                      />
                    ) : null}
                    {filters.menu === "next" && row.nextMenu ? (
                      <span className="text-meta font-normal text-ink-muted">
                        Next: {row.nextMenu.title}
                      </span>
                    ) : null}
                  </span>
                </TableHead>
                {columns.map((c) => (
                  <CategoryCell
                    key={c.key}
                    row={row}
                    counts={row.categories.find((x) => x.category === c.key)}
                    label={c.label}
                    filters={filters}
                  />
                ))}
                <TableCell label={OVERVIEW_COPY.facts}>
                  {row.facts.total === 0 ? (
                    <span className="text-ink-muted">
                      {OVERVIEW_COPY.noSlots}
                    </span>
                  ) : (
                    <NumberLink
                      href={href.facts}
                      label={`Facts confirmed at ${row.name}: ${facts.main}`}
                      testId="overview-facts"
                    >
                      <span className="whitespace-nowrap">{facts.main}</span>
                      {facts.pct ? (
                        <span className="font-sans text-meta font-normal">
                          · {facts.pct}
                        </span>
                      ) : null}
                    </NumberLink>
                  )}
                </TableCell>
                <TableCell label={OVERVIEW_COPY.unlabelled}>
                  <NumberLink
                    href={href.unlabelled}
                    label={`Unlabelled at ${row.name}: ${row.unlabelled}`}
                    testId="overview-unlabelled"
                  >
                    {row.unlabelled}
                  </NumberLink>
                </TableCell>
                <TableCell label={OVERVIEW_COPY.review}>
                  {age ? (
                    <span className="grid gap-0.5">
                      <NumberLink
                        href={href.review}
                        label={`Oldest photo waiting at ${row.name}: ${age}`}
                        testId="overview-review"
                      >
                        {age}
                      </NumberLink>
                      <span className="text-meta">
                        {OVERVIEW_COPY.waiting(row.review.waiting)}
                      </span>
                    </span>
                  ) : (
                    <NumberLink
                      href={href.review}
                      label={`Nothing waiting at ${row.name}`}
                      testId="overview-review"
                    >
                      <span className="font-sans font-normal">
                        {OVERVIEW_COPY.nothingWaiting}
                      </span>
                    </NumberLink>
                  )}
                </TableCell>
                <TableCell label={OVERVIEW_COPY.checks}>
                  <span className="grid gap-0.5">
                    <NumberLink
                      href={href.checksDue}
                      label={`Checks due at ${row.name}: ${row.checksDue.total}`}
                      testId="overview-checks"
                    >
                      {row.checksDue.total}
                    </NumberLink>
                    {row.checksDue.total > 0 ? (
                      <span
                        className="flex flex-wrap gap-x-2 text-meta"
                        data-testid="overview-check-parts"
                      >
                        {CHECK_PARTS.filter(
                          (p) => row.checksDue[p.key] > 0
                        ).map((p) => (
                          <Link
                            key={p.key}
                            href={href.checkParts[p.key]}
                            data-part={p.key}
                            className="inline-flex min-h-10 items-center underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
                          >
                            {p.words(row.checksDue[p.key])}
                          </Link>
                        ))}
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell label={OVERVIEW_COPY.publication}>
                  <span className="grid gap-0.5">
                    <NumberLink
                      href={href.publication}
                      label={`Publication errors at ${row.name}: ${row.publication.total}`}
                      testId="overview-publication"
                    >
                      {row.publication.total}
                    </NumberLink>
                    {row.publication.total > 0 ? (
                      <span className="text-meta">
                        {row.publication.failed} failed ·{" "}
                        {row.publication.withdrawalPending} withdrawal pending
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell label={OVERVIEW_COPY.added(filters.period)}>
                  <NumberLink
                    href={href.added}
                    label={`Photos added at ${row.name} in ${periodLabel(filters.period)}: ${row.added ?? 0}`}
                    testId="overview-added"
                  >
                    {row.added ?? 0}
                  </NumberLink>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        {rows.length > 1 ? (
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="row" className="text-ink">
                {OVERVIEW_COPY.allVenues}
              </TableHead>
              {columns.map((c) => {
                const t = categoryTotals(rows, c.key)
                const w = ofWords(t.covered, t.total)
                return (
                  <TableCell
                    key={c.key}
                    label={c.label}
                    className="font-mono tabular-nums"
                  >
                    {t.total ? `${w.main} · ${w.pct}` : OVERVIEW_COPY.noSlots}
                  </TableCell>
                )
              })}
              <TableCell
                label={OVERVIEW_COPY.facts}
                className="font-mono tabular-nums"
              >
                {(() => {
                  const n = rows.reduce((s, r) => s + r.facts.confirmed, 0)
                  const d = rows.reduce((s, r) => s + r.facts.total, 0)
                  const w = ofWords(n, d)
                  return d ? `${w.main} · ${w.pct}` : OVERVIEW_COPY.noSlots
                })()}
              </TableCell>
              <TableCell
                label={OVERVIEW_COPY.unlabelled}
                className="font-mono tabular-nums"
              >
                {rows.reduce((s, r) => s + r.unlabelled, 0)}
              </TableCell>
              <TableCell
                label={OVERVIEW_COPY.review}
                className="font-mono tabular-nums"
              >
                {OVERVIEW_COPY.waiting(
                  rows.reduce((s, r) => s + r.review.waiting, 0)
                )}
              </TableCell>
              <TableCell
                label={OVERVIEW_COPY.checks}
                className="font-mono tabular-nums"
              >
                {rows.reduce((s, r) => s + r.checksDue.total, 0)}
              </TableCell>
              <TableCell
                label={OVERVIEW_COPY.publication}
                className="font-mono tabular-nums"
              >
                {rows.reduce((s, r) => s + r.publication.total, 0)}
              </TableCell>
              <TableCell
                label={OVERVIEW_COPY.added(filters.period)}
                className="font-mono tabular-nums"
              >
                {rows.reduce((s, r) => s + (r.added ?? 0), 0)}
              </TableCell>
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
      <p id="overview-table-key" className="px-1 text-meta text-ink-muted">
        {OVERVIEW_COPY.tableKey}
      </p>
    </div>
  )
}

/*
 * The one chip a venue needing attention takes: the most serious problem it
 * has. A publication error outranks missing setup, which outranks a check
 * due, which outranks a long wait. The words beside it list every problem.
 */
function attentionChip(list: Attention[]): ChipState {
  const kinds = new Set(list.map((a) => a.kind))
  if (kinds.has("publication")) return "publication_failed_unknown"
  if (kinds.has("setup")) return "needs_setup"
  if (kinds.has("checks")) return "coverage_check_due"
  return "outcome_waiting"
}

const ROW_LINK =
  "inline-flex min-h-10 items-center underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"

function AttentionList({
  rows,
  of,
  now,
  reviewAlertDays,
}: {
  rows: OverviewRow[]
  /** How many venues the overview shows: "3 of 9". */
  of: number
  now: Date
  reviewAlertDays: number
}) {
  return (
    <section aria-labelledby="overview-attention-title" className="grid gap-2">
      <div className="flex items-baseline gap-3 px-1">
        <h2
          id="overview-attention-title"
          className="flex-1 type-heading-sm text-ink"
        >
          {OVERVIEW_COPY.attentionTitle}
        </h2>
        {rows.length ? (
          <span className="text-meta text-ink-muted tabular-nums">
            {OVERVIEW_COPY.attentionOf(rows.length, of)}
          </span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState variant="done" title={OVERVIEW_COPY.attentionNone} />
      ) : (
        <ul
          className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
          data-testid="overview-attention"
        >
          {rows.map((row) => {
            const hrefs = rowHrefs(row, {
              venueId: null,
              categories: [],
              menu: "current",
              period: "2000-01",
            })
            const problems = rowAttention(row, now, reviewAlertDays)
            return (
              <li
                key={row.venueId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
              >
                <div className="grid min-w-0 flex-[1_1_16rem]">
                  <Link
                    href={hrefs.venue}
                    className={cn(ROW_LINK, "text-label text-ink")}
                  >
                    {row.name}
                  </Link>
                  <ul className="flex flex-wrap items-center gap-x-1 text-meta text-ink-muted">
                    {problems.map((a, i) => {
                      const href =
                        a.kind === "setup"
                          ? hrefs.setup
                          : a.kind === "publication"
                            ? hrefs.publication
                            : a.kind === "checks"
                              ? hrefs.checksDue
                              : hrefs.review
                      return (
                        <li key={a.kind} className="flex items-center gap-x-1">
                          {i > 0 ? <span aria-hidden>·</span> : null}
                          <Link href={href} className={ROW_LINK}>
                            {attentionWords(a)}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <StatusChip state={attentionChip(problems)} />
                <CaretRightIcon aria-hidden className="size-5 text-ink-muted" />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/*
 * The filters sit in the By venue heading row (handoff): venue, menu and
 * period as selects, the categories folded behind one disclosure, then Show.
 * A plain GET form, so it works before the page's script has loaded.
 */
export function OverviewFiltersForm({
  filters,
  venues,
  periods,
}: {
  filters: OverviewFilters
  venues: { id: string; name: string }[]
  periods: string[]
}) {
  const select = fieldControlVariants()
  const chosen = OVERVIEW_CATEGORIES.filter((c) =>
    filters.categories.includes(c.key)
  )
  return (
    <form
      method="get"
      action="/admin/overview"
      className="flex flex-wrap items-start gap-2"
      aria-label="Filters"
      data-testid="overview-filters"
    >
      <label className="grid">
        <span className="sr-only">Venue</span>
        <select
          name="venue"
          defaultValue={filters.venueId ?? ""}
          className={cn(select, "w-48")}
        >
          <option value="">All venues</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid">
        <span className="sr-only">Menu</span>
        <select
          name="menu"
          defaultValue={filters.menu}
          className={cn(select, "w-48")}
        >
          <option value="current">Current menu</option>
          <option value="next">Next scheduled menu</option>
        </select>
      </label>
      <label className="grid">
        <span className="sr-only">Reporting period</span>
        <select
          name="period"
          defaultValue={filters.period}
          className={cn(select, "w-44")}
        >
          {periods.map((p) => (
            <option key={p} value={p}>
              {periodLabel(p)}
            </option>
          ))}
        </select>
      </label>
      <details className="group relative">
        <summary
          className={cn(
            select,
            "flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden"
          )}
        >
          <span>
            Categories
            <span className="text-ink-muted">
              {" "}
              · {chosen.length} of {OVERVIEW_CATEGORIES.length}
            </span>
          </span>
          <CaretDownIcon
            aria-hidden
            className="size-4 transition-transform group-open:rotate-180"
          />
        </summary>
        <fieldset className="mt-2 grid gap-2 rounded-card border border-line bg-surface p-3 md:absolute md:right-0 md:z-local md:w-64 md:shadow-float">
          <legend className="sr-only">Categories</legend>
          {OVERVIEW_CATEGORIES.map((c) => (
            <OptionRow
              key={c.key}
              type="checkbox"
              name="category"
              value={c.key}
              label={c.label}
              defaultChecked={filters.categories.includes(c.key)}
            />
          ))}
        </fieldset>
      </details>
      <Button type="submit" variant="secondary">
        Show
      </Button>
      <Link
        href="/admin/overview"
        className="inline-flex min-h-10 items-center px-1 text-accent-text underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
      >
        Clear filters
      </Link>
    </form>
  )
}

/** Covered and total across the shown categories, for one venue's meter. */
function albumTotal(row: OverviewRow, filters: OverviewFilters) {
  return row.categories
    .filter((c) => filters.categories.includes(c.category))
    .reduce(
      (t, c) => ({ covered: t.covered + c.covered, total: t.total + c.total }),
      { covered: 0, total: 0 }
    )
}

/** Below md: one row per venue with a single meter; the rest fold away. */
const PHONE_SHOWN = 4

function PhoneVenueRow({
  row,
  filters,
}: {
  row: OverviewRow
  filters: OverviewFilters
}) {
  const t = albumTotal(row, filters)
  const words = ofWords(t.covered, t.total)
  const href = rowHrefs(row, filters).venue
  const id = `overview-meter-${row.venueId}`
  return (
    <li className="grid gap-2 px-4 py-3" data-testid="overview-phone-row">
      <Link href={href} className={cn(ROW_LINK, "text-label text-ink")}>
        {row.name}
      </Link>
      {t.total === 0 ? (
        <p className="text-meta text-ink-muted">{OVERVIEW_COPY.noSlots}</p>
      ) : (
        <div className="grid gap-1">
          <p id={id} className="flex items-baseline gap-2 text-meta">
            <span className="flex-1 text-ink-muted">
              {OVERVIEW_COPY.inAlbum}
            </span>
            <span className="font-semibold text-ink tabular-nums">
              {words.main}
            </span>
            {words.pct ? (
              <span className="text-ink-muted tabular-nums">{words.pct}</span>
            ) : null}
          </p>
          <Progress
            value={t.covered}
            max={t.total}
            tone="ok"
            size="sm"
            aria-labelledby={id}
          />
        </div>
      )}
    </li>
  )
}

function PhoneVenueList({
  rows,
  filters,
}: {
  rows: OverviewRow[]
  filters: OverviewFilters
}) {
  const shown = rows.slice(0, PHONE_SHOWN)
  const rest = rows.slice(PHONE_SHOWN)
  return (
    <div className="grid gap-2 md:hidden" data-testid="overview-phone">
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {shown.map((row) => (
          <PhoneVenueRow key={row.venueId} row={row} filters={filters} />
        ))}
      </ul>
      {rest.length ? (
        <details className="group grid gap-2">
          <summary
            className={cn(
              buttonVariants({ variant: "secondary" }),
              "w-full cursor-pointer list-none group-open:hidden [&::-webkit-details-marker]:hidden"
            )}
          >
            {OVERVIEW_COPY.showMore(rest.length)}
          </summary>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {rest.map((row) => (
              <PhoneVenueRow key={row.venueId} row={row} filters={filters} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

export function OverviewView({
  rows,
  filters,
  now,
  reviewAlertDays = DEFAULT_BACKLOG_ALERT_DAYS,
  controls,
}: {
  rows: OverviewRow[]
  filters: OverviewFilters
  now: Date
  /** ops_settings.backlog_alert_days (S3-R6, V21). */
  reviewAlertDays?: number
  /** The filters form, drawn in the By venue heading row. */
  controls?: React.ReactNode
}) {
  const header = (
    <div className="flex flex-wrap items-start gap-3 px-1">
      <h2
        id="overview-table-title"
        className="flex-1 py-2 type-heading-sm text-ink"
      >
        {OVERVIEW_COPY.tableTitle}
      </h2>
      {controls}
    </div>
  )
  if (rows.length === 0)
    return (
      <section aria-labelledby="overview-table-title" className="grid gap-3">
        {header}
        <EmptyState
          title={OVERVIEW_COPY.emptyTitle}
          description={<p>{OVERVIEW_COPY.emptyText}</p>}
        />
      </section>
    )
  const { attention } = attentionFirst(rows, now, reviewAlertDays)
  return (
    <div className="grid gap-8">
      <AttentionList
        rows={attention}
        of={rows.length}
        now={now}
        reviewAlertDays={reviewAlertDays}
      />
      <section aria-labelledby="overview-table-title" className="grid gap-3">
        {header}
        <PhoneVenueList rows={rows} filters={filters} />
        <OverviewTable rows={rows} filters={filters} now={now} />
      </section>
    </div>
  )
}
