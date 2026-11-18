import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { EmptyState } from "@/components/nabalens/empty-state"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import { fieldControlVariants } from "@/components/ui/field-control"
import { OptionRow } from "@/components/ui/option-row"
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
  ofWords,
  OVERVIEW_CATEGORIES,
  periodLabel,
  rowAttention,
  rowHrefs,
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
 * are in name order; nothing ranks people (§18). Below md the table stacks
 * into one labelled block per venue (DESIGN.md §8: 320px).
 */

export const OVERVIEW_COPY = {
  title: "Overview",
  scope: "All venues",
  summary:
    "Every venue's coverage and backlog. Each number opens the records behind it.",
  attentionTitle: "Venues needing attention",
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
  emptyTitle: "No venues match",
  emptyText: "Choose all venues, or add a venue under Venues.",
}

const NUMBER_LINK =
  "inline-flex min-h-12 flex-wrap items-center gap-x-1 font-mono text-mono font-semibold tabular-nums text-ink underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"

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

/** Shades as the albums matrix (DESIGN.md §6.6): the tint repeats the words. */
function tint(c: { covered: number; total: number }) {
  // From md only: a stacked phone block keeps its labels readable on surface.
  if (c.total === 0 || c.covered === 0) return ""
  if (c.covered >= c.total)
    return "md:bg-ok-fg md:text-on-ok md:[&_a]:text-on-ok"
  return c.covered * 2 < c.total ? "md:bg-ok-bg" : "md:bg-ok-half"
}

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
      <TableCell label={label} className="border-l border-line text-ink-muted">
        {OVERVIEW_COPY.noNextMenu}
      </TableCell>
    )
  if (!counts || counts.total === 0)
    return (
      <TableCell label={label} className="border-l border-line text-ink-muted">
        {OVERVIEW_COPY.noSlots}
      </TableCell>
    )
  const words = ofWords(counts.covered, counts.total)
  const notes = [
    counts.pending > 0 ? OVERVIEW_COPY.waiting(counts.pending) : null,
    counts.checkDue > 0 ? OVERVIEW_COPY.checkDue(counts.checkDue) : null,
  ].filter(Boolean)
  return (
    <TableCell
      label={label}
      className={cn("min-w-32 border-l border-line align-top", tint(counts))}
      data-testid={`overview-${counts.category}`}
    >
      <span className="grid gap-0.5">
        <NumberLink
          href={categoryHref(
            row.venueId,
            counts.category,
            filters.menu,
            row.nextMenu?.versionId ?? null
          )}
          label={`${label} at ${row.name}: ${words.main} covered`}
        >
          <span className="whitespace-nowrap">{words.main}</span>
          {words.pct ? (
            <span className="font-sans text-meta font-normal">
              · {words.pct}
            </span>
          ) : null}
        </NumberLink>
        {notes.length ? (
          <span className="text-meta">{notes.join(" · ")}</span>
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
    <section aria-labelledby="overview-table-title" className="grid gap-3">
      <h2
        id="overview-table-title"
        className="px-1 type-section-title text-ink"
      >
        {OVERVIEW_COPY.tableTitle}
      </h2>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <Table
          stacked
          aria-labelledby="overview-table-title"
          className="md:min-w-[60rem]"
          data-testid="overview-table"
        >
          <TableHeader>
            <TableRow>
              <TableHead>{OVERVIEW_COPY.venue}</TableHead>
              {columns.map((c) => (
                <TableHead key={c.key} className="border-l border-line">
                  {c.label}
                </TableHead>
              ))}
              <TableHead className="border-l border-line">
                {OVERVIEW_COPY.facts}
              </TableHead>
              <TableHead className="border-l border-line">
                {OVERVIEW_COPY.unlabelled}
              </TableHead>
              <TableHead className="border-l border-line">
                {OVERVIEW_COPY.review}
              </TableHead>
              <TableHead className="border-l border-line">
                {OVERVIEW_COPY.checks}
              </TableHead>
              <TableHead className="border-l border-line">
                {OVERVIEW_COPY.publication}
              </TableHead>
              <TableHead className="border-l border-line">
                {OVERVIEW_COPY.added(filters.period)}
              </TableHead>
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
                  <TableHead scope="row" className="align-top text-ink md:min-w-48">
                    <span className="grid gap-1">
                      <Link
                        href={href.venue}
                        className="inline-flex min-h-12 items-center underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
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
                  <TableCell
                    label={OVERVIEW_COPY.facts}
                    className="border-l border-line align-top"
                  >
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
                  <TableCell
                    label={OVERVIEW_COPY.unlabelled}
                    className="border-l border-line align-top"
                  >
                    <NumberLink
                      href={href.unlabelled}
                      label={`Unlabelled at ${row.name}: ${row.unlabelled}`}
                      testId="overview-unlabelled"
                    >
                      {row.unlabelled}
                    </NumberLink>
                  </TableCell>
                  <TableCell
                    label={OVERVIEW_COPY.review}
                    className="border-l border-line align-top"
                  >
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
                  <TableCell
                    label={OVERVIEW_COPY.checks}
                    className="border-l border-line align-top"
                  >
                    <span className="grid gap-0.5">
                      <NumberLink
                        href={href.checksDue}
                        label={`Checks due at ${row.name}: ${row.checksDue.total}`}
                        testId="overview-checks"
                      >
                        {row.checksDue.total}
                      </NumberLink>
                      {row.checksDue.total > 0 ? (
                        <span className="text-meta">
                          {row.checksDue.slots} photo · {row.checksDue.facts}{" "}
                          fact
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell
                    label={OVERVIEW_COPY.publication}
                    className="border-l border-line align-top"
                  >
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
                  <TableCell
                    label={OVERVIEW_COPY.added(filters.period)}
                    className="border-l border-line align-top"
                  >
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
                      className="border-l border-line font-mono tabular-nums"
                    >
                      {t.total ? `${w.main} · ${w.pct}` : OVERVIEW_COPY.noSlots}
                    </TableCell>
                  )
                })}
                <TableCell
                  label={OVERVIEW_COPY.facts}
                  className="border-l border-line font-mono tabular-nums"
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
                  className="border-l border-line font-mono tabular-nums"
                >
                  {rows.reduce((s, r) => s + r.unlabelled, 0)}
                </TableCell>
                <TableCell
                  label={OVERVIEW_COPY.review}
                  className="border-l border-line font-mono tabular-nums"
                >
                  {OVERVIEW_COPY.waiting(
                    rows.reduce((s, r) => s + r.review.waiting, 0)
                  )}
                </TableCell>
                <TableCell
                  label={OVERVIEW_COPY.checks}
                  className="border-l border-line font-mono tabular-nums"
                >
                  {rows.reduce((s, r) => s + r.checksDue.total, 0)}
                </TableCell>
                <TableCell
                  label={OVERVIEW_COPY.publication}
                  className="border-l border-line font-mono tabular-nums"
                >
                  {rows.reduce((s, r) => s + r.publication.total, 0)}
                </TableCell>
                <TableCell
                  label={OVERVIEW_COPY.added(filters.period)}
                  className="border-l border-line font-mono tabular-nums"
                >
                  {rows.reduce((s, r) => s + (r.added ?? 0), 0)}
                </TableCell>
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>
    </section>
  )
}

function AttentionList({ rows, now }: { rows: OverviewRow[]; now: Date }) {
  return (
    <section aria-labelledby="overview-attention-title" className="grid gap-3">
      <h2
        id="overview-attention-title"
        className="px-1 type-section-title text-ink"
      >
        {OVERVIEW_COPY.attentionTitle}
        {rows.length ? (
          <span className="ml-2 font-sans text-meta text-ink-muted">
            {rows.length}
          </span>
        ) : null}
      </h2>
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
            return (
              <li key={row.venueId} className="grid gap-2 px-4 py-3">
                <Link
                  href={hrefs.venue}
                  className="inline-flex min-h-12 items-center gap-2 text-label text-ink underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
                >
                  {row.name}
                  <CaretRightIcon
                    aria-hidden
                    className="size-5 text-ink-muted"
                  />
                </Link>
                <ul className="flex flex-wrap gap-2">
                  {rowAttention(row, now).map((a) => {
                    const href =
                      a.kind === "setup"
                        ? hrefs.setup
                        : a.kind === "publication"
                          ? hrefs.publication
                          : a.kind === "checks"
                            ? hrefs.checksDue
                            : hrefs.review
                    return (
                      <li key={a.kind}>
                        <Link
                          href={href}
                          className="inline-flex min-h-12 items-center rounded-control focus-ring outline-none"
                        >
                          <StatusChip
                            state={
                              a.kind === "setup"
                                ? "needs_setup"
                                : "needs_attention"
                            }
                          >
                            {attentionWords(a)}
                          </StatusChip>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

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
  return (
    <form
      method="get"
      className="grid gap-4 rounded-card border border-line bg-surface p-4"
      aria-label="Filters"
      data-testid="overview-filters"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <label className="grid gap-1.5">
          <span className="text-label text-ink">Venue</span>
          <select
            name="venue"
            defaultValue={filters.venueId ?? ""}
            className={select}
          >
            <option value="">All venues</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-label text-ink">Menu</span>
          <select name="menu" defaultValue={filters.menu} className={select}>
            <option value="current">Current menu</option>
            <option value="next">Next scheduled menu</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-label text-ink">Reporting period</span>
          <select
            name="period"
            defaultValue={filters.period}
            className={select}
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-label text-ink">Categories</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
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
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary">
          Show
        </Button>
        <Link
          href="/admin/overview"
          className="inline-flex min-h-12 items-center text-accent-text underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
        >
          Clear filters
        </Link>
      </div>
    </form>
  )
}

export function OverviewView({
  rows,
  filters,
  now,
}: {
  rows: OverviewRow[]
  filters: OverviewFilters
  now: Date
}) {
  if (rows.length === 0)
    return (
      <EmptyState
        title={OVERVIEW_COPY.emptyTitle}
        description={<p>{OVERVIEW_COPY.emptyText}</p>}
      />
    )
  const { attention } = attentionFirst(rows, now)
  return (
    <div className="grid gap-8">
      <AttentionList rows={attention} now={now} />
      <OverviewTable rows={rows} filters={filters} now={now} />
    </div>
  )
}
