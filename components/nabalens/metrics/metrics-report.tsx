import {
  CoverageSection,
  Tally,
  TallyItem,
} from "@/components/nabalens/coverage"
import { EmptyState } from "@/components/nabalens/empty-state"
import { StatusChip } from "@/components/nabalens/status-chip"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
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
  METRIC_PERIODS,
  REVIEW_KIND_WORDS,
  categoryCounts,
  durationWords,
  flowWords,
  ofWords,
  rateWords,
  reproduce,
  routeWords,
  slotChipKey,
  slotsByState,
  type MetricCategory,
  type VenueMetrics,
} from "@/lib/metrics/model"

import { METRICS_COPY as C } from "./copy"

// The metrics report for one venue (spec §18.1, AC39), for its manager and
// for admins. Server component: filters are links. What is missing or
// waiting comes first (DESIGN.md §11 rule 3); every number shows its
// numerator and denominator ("n of N"), the percentage secondary (FA-8).
// Nobody is named or ranked (DESIGN.md §9).

export type MetricsHrefs = {
  /** The same report with another period or category. */
  filter: (next: { days?: number; category?: MetricCategory | null }) => string
  /** Where the venue's waiting photos are reviewed. */
  review?: string
  /** Where unlabelled photos are classified. */
  needsLabel?: string
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
})

function ageWords(iso: string | null, now: string): string | null {
  if (!iso) return null
  const seconds = (Date.parse(now) - Date.parse(iso)) / 1000
  return Number.isFinite(seconds) && seconds >= 0
    ? C.oldest(durationWords(seconds))
    : null
}

/** "30 of 40" with "75%" after it, quieter. */
export function OfNumber({ n, d }: { n: number; d: number }) {
  const { text, percent } = ofWords(n, d)
  return (
    <span className="tabular-nums">
      <span className="font-bold text-ink">{text}</span>
      {percent ? <span className="text-ink-muted"> · {percent}</span> : null}
    </span>
  )
}

export function MetricsFilters({
  days,
  category,
  hrefs,
  categories = true,
}: {
  days: number
  category: MetricCategory | null
  hrefs: MetricsHrefs
  /** False where the category filter has nothing to narrow. */
  categories?: boolean
}) {
  return (
    <div className="grid gap-3 px-1" data-slot="metrics-filters">
      <PillGroup label={C.periodLabel}>
        {METRIC_PERIODS.map((p) => (
          <FilterPill
            key={p}
            href={hrefs.filter({ days: p })}
            selected={p === days}
            current="true"
            scroll={false}
          >
            {C.period(p)}
          </FilterPill>
        ))}
      </PillGroup>
      {categories ? (
        <PillGroup label={C.categoryLabel}>
          <FilterPill
            href={hrefs.filter({ category: null })}
            selected={category === null}
            current="true"
            scroll={false}
          >
            {C.allCategories}
          </FilterPill>
          {METRIC_CATEGORIES.map((c) => (
            <FilterPill
              key={c}
              href={hrefs.filter({ category: c })}
              selected={category === c}
              current="true"
              scroll={false}
            >
              {CATEGORY_WORDS[c]}
            </FilterPill>
          ))}
        </PillGroup>
      ) : null}
    </div>
  )
}

/** Waiting and missing work first, each linking to where it is done. */
function AttentionTally({
  m,
  category,
  hrefs,
}: {
  m: VenueMetrics
  category: MetricCategory | null
  hrefs: MetricsHrefs
}) {
  const counts = category ? categoryCounts(m, category) : m.coverage.totals
  return (
    <CoverageSection id="attention" title={C.attentionTitle}>
      <Tally>
        <TallyItem
          label={C.missing}
          value={counts.missing + counts.replacementNeeded}
          of={counts.total}
          note={C.missingNote(counts.replacementNeeded)}
          tone="attention"
          href={`${hrefs.filter({ category })}#how-counted`}
        />
        <TallyItem
          label={C.awaitingReview}
          value={m.review.waiting}
          note={ageWords(m.review.oldestWaitingAt, m.generatedAt) ?? undefined}
          tone="attention"
          href={hrefs.review}
        />
        <TallyItem
          label={C.needsLabel}
          value={m.needsLabel.count}
          note={C.needsLabelNote(m.needsLabel.inManagerQueue)}
          tone="attention"
          href={hrefs.needsLabel}
        />
        <TallyItem
          label={C.checkDue}
          value={counts.checkDue}
          note={C.factsDue(m.facts.checkDue + m.facts.unconfirmed)}
          tone="attention"
          href={`${hrefs.filter({ category })}#how-counted`}
        />
        <TallyItem
          label={C.technicalFailures}
          value={m.reliability.technical}
          note={C.inPeriod(m.days)}
          tone="negative"
          href={`${hrefs.filter({ category })}#reliability`}
        />
      </Tally>
    </CoverageSection>
  )
}

function CoverageTable({
  m,
  category,
}: {
  m: VenueMetrics
  category: MetricCategory | null
}) {
  const rows = m.coverage.categories.filter(
    (c) => !category || c.category === category
  )
  return (
    <CoverageSection
      id="coverage"
      title={C.coverageTitle}
      count={
        category ? undefined : (
          <OfNumber n={m.coverage.totals.covered} d={m.coverage.totals.total} />
        )
      }
    >
      <p className="px-1 text-body text-ink-muted">{C.coverageRule}</p>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <Table stacked>
          <TableHeader>
            <TableRow>
              <TableHead>{C.category}</TableHead>
              <TableHead>{C.covered}</TableHead>
              <TableHead numeric>{C.awaitingReview}</TableHead>
              <TableHead numeric>{C.checkDue}</TableHead>
              <TableHead numeric>{C.anotherPhoto}</TableHead>
              <TableHead numeric>{C.missing}</TableHead>
              <TableHead numeric>{C.notCounted}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.category} data-category={c.category}>
                <TableCell className="font-bold">
                  {CATEGORY_WORDS[c.category]}
                </TableCell>
                <TableCell label={C.covered}>
                  <OfNumber n={c.covered} d={c.total} />
                </TableCell>
                <TableCell label={C.awaitingReview} numeric>
                  {c.pending}
                </TableCell>
                <TableCell label={C.checkDue} numeric>
                  {c.checkDue}
                </TableCell>
                <TableCell label={C.anotherPhoto} numeric>
                  {c.replacementNeeded}
                </TableCell>
                <TableCell label={C.missing} numeric>
                  {c.missing}
                </TableCell>
                <TableCell label={C.notCounted} numeric>
                  {c.notHere + c.inactive}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {(category ? categoryCounts(m, category) : m.coverage.totals)
        .unavailable > 0 ? (
        <p className="px-1 text-body text-ink-muted">
          {C.unavailable(
            (category ? categoryCounts(m, category) : m.coverage.totals)
              .unavailable
          )}
        </p>
      ) : null}
    </CoverageSection>
  )
}

function CompletenessSection({
  m,
  category,
}: {
  m: VenueMetrics
  category: MetricCategory | null
}) {
  const items = m.items.filter((i) => !category || i.category === category)
  const showFacts = !category || category === "facilities"
  return (
    <CoverageSection id="completeness" title={C.completenessTitle}>
      <Tally>
        {items.map((i) => (
          <TallyItem
            key={i.category}
            label={C.itemsIn(CATEGORY_WORDS[i.category])}
            value={i.satisfied}
            of={i.total}
            note={ofWords(i.satisfied, i.total).percent ?? C.nothingCounted}
          />
        ))}
        {showFacts ? (
          <TallyItem
            label={C.factsConfirmed}
            value={m.facts.numerator}
            of={m.facts.denominator}
            note={
              ofWords(m.facts.numerator, m.facts.denominator).percent ??
              C.nothingCounted
            }
          />
        ) : null}
      </Tally>
      <p className="px-1 text-body text-ink-muted">{C.itemRule}</p>
    </CoverageSection>
  )
}

function ReviewSection({ m }: { m: VenueMetrics }) {
  const r = m.review
  return (
    <CoverageSection
      id="review"
      title={C.reviewTitle}
      count={C.inPeriod(m.days)}
    >
      <Tally>
        <TallyItem
          label={C.reviewMedian}
          value={r.decided}
          note={C.decidedNote(
            durationWords(r.medianSeconds),
            durationWords(r.p90Seconds)
          )}
        />
        <TallyItem
          label={C.processingMedian}
          value={r.processing.count}
          note={C.processedNote(durationWords(r.processing.medianSeconds))}
        />
        <TallyItem
          label={C.labelCorrections}
          value={m.labels.corrected}
          of={m.labels.reviewed}
          note={
            ofWords(m.labels.corrected, m.labels.reviewed).percent ?? undefined
          }
        />
        <TallyItem
          label={C.labelledByReviewer}
          value={m.labels.labelledByReviewer}
        />
      </Tally>
      {r.byKind.length > 0 || m.labels.byRoute.length > 0 ? (
        <div className="grid gap-gutter md:grid-cols-2">
          {r.byKind.length > 0 ? (
            <ul className="grid divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {r.byKind.map((k) => (
                <li key={k.kind} className="grid gap-0.5 px-4 py-3">
                  <span className="font-bold text-ink">
                    {REVIEW_KIND_WORDS[k.kind] ?? k.kind}
                  </span>
                  <span className="text-meta text-ink-muted">
                    {C.kindLine(k.decided, durationWords(k.medianSeconds))}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {m.labels.byRoute.length > 0 ? (
            <ul className="grid divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {m.labels.byRoute.map((x) => (
                <li key={x.route} className="grid gap-0.5 px-4 py-3">
                  <span className="font-bold text-ink">
                    {routeWords(x.route)}
                  </span>
                  <span className="text-meta text-ink-muted">
                    {rateWords(x.corrected, x.reviewed)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <p className="px-1 text-body text-ink-muted">{C.reviewRule}</p>
    </CoverageSection>
  )
}

function UseSection({ m }: { m: VenueMetrics }) {
  const u = m.contributions
  const e = m.contentUse.exports
  const p = m.contentUse.publications
  return (
    <CoverageSection id="use" title={C.useTitle} count={C.inPeriod(m.days)}>
      <Tally>
        <TallyItem
          label={C.useful}
          value={u.useful}
          note={C.usefulNote(u.firstFulfilment, u.replacement)}
          tone="positive"
        />
        <TallyItem
          label={C.extra}
          value={u.extra}
          note={C.extraNote(u.duplicates)}
        />
        <TallyItem
          label={C.exports}
          value={e.downloads}
          note={C.exportsNote(e.packages, e.files)}
        />
        <TallyItem
          label={C.publications}
          value={p.published}
          note={C.publicationsNote(p.assets, p.withdrawn)}
        />
      </Tally>
      <p className="px-1 text-body text-ink-muted">{C.usefulRule}</p>
    </CoverageSection>
  )
}

function ReliabilitySection({ m }: { m: VenueMetrics }) {
  const r = m.reliability
  const rows: Array<[string, number]> = [
    [C.failedUploads, r.failed],
    [C.notFinished, r.notFinished],
    [C.stuck, r.stuckProcessing],
    [C.exportFailures, r.exportFailures],
    [C.destinationFailures, r.destinationFailures],
    [C.clientFailures, r.clientFailures],
    [C.clientRetries, r.clientRetries],
    [C.recovered, r.recovered],
  ]
  return (
    <CoverageSection
      id="reliability"
      title={C.reliabilityTitle}
      count={C.inPeriod(m.days)}
    >
      <Tally>
        <TallyItem
          label={C.technicalFailures}
          value={r.technical}
          note={C.uploadsNote(r.uploads)}
          tone="negative"
        />
        <TallyItem
          label={C.editorial}
          value={r.editorial}
          note={C.editorialNote}
        />
      </Tally>
      <ul className="grid divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {rows.map(([label, value]) => (
          <li
            key={label}
            className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3"
          >
            <span className="text-ink">{label}</span>
            <span className="font-mono font-semibold text-ink tabular-nums">
              {value}
            </span>
          </li>
        ))}
      </ul>
    </CoverageSection>
  )
}

/** AC39: the slots behind the coverage number, by state. */
export function HowCounted({
  m,
  category,
}: {
  m: VenueMetrics
  category: MetricCategory | null
}) {
  const groups = slotsByState(m.slots, category)
  const again = reproduce(m.slots, category)
  return (
    <CoverageSection id="how-counted" title={C.howCountedTitle}>
      <p className="px-1 text-body text-ink-muted" data-slot="reproduced">
        {C.reproduced(again.covered, again.total)}
      </p>
      {groups.length === 0 ? (
        <EmptyState title={C.noSlotsTitle} description={C.noSlots} />
      ) : (
        <div className="grid gap-2">
          {groups.map((g) => (
            <details
              key={g.state}
              className="group overflow-hidden rounded-card border border-line bg-surface"
              data-state={g.state}
            >
              <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 focus-ring outline-none">
                <StatusChip state={slotChipKey(g.state)} />
                <span className="font-mono font-semibold text-ink tabular-nums">
                  {g.slots.length}
                </span>
                <span className="text-meta text-ink-muted">
                  {g.counted ? C.counted : C.leavesTotal}
                </span>
              </summary>
              <ul className="grid divide-y divide-line border-t border-line">
                {g.slots.map((s) => (
                  <li
                    key={`${s.kind}-${s.slotId}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 [overflow-wrap:anywhere] text-ink">
                      {s.name}
                    </span>
                    <span className="text-meta text-ink-muted">
                      {CATEGORY_WORDS[s.category]}
                      {s.groupName && s.groupName !== s.name
                        ? ` · ${s.groupName}`
                        : ""}
                      {s.unavailable ? ` · ${C.soldOut}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </CoverageSection>
  )
}

function FlowSection({ m }: { m: VenueMetrics }) {
  return (
    <CoverageSection id="flow" title={C.flowTitle} count={C.inPeriod(m.days)}>
      {m.flow.length === 0 ? (
        <p className="px-1 text-body text-ink-muted">{C.noFlow}</p>
      ) : (
        <ul className="grid divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {m.flow.map((f) => (
            <li
              key={`${f.name}-${f.route ?? ""}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3"
            >
              <span className="text-ink">
                {flowWords(f.name)}
                {f.route ? (
                  <span className="text-ink-muted">
                    {" "}
                    · {routeWords(f.route)}
                  </span>
                ) : null}
              </span>
              <span className="font-mono font-semibold text-ink tabular-nums">
                {f.count}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="px-1 text-body text-ink-muted">{C.flowRule}</p>
    </CoverageSection>
  )
}

export function MetricsReport({
  metrics,
  category,
  hrefs,
}: {
  metrics: VenueMetrics
  category: MetricCategory | null
  hrefs: MetricsHrefs
}) {
  return (
    <div className="grid gap-8" data-slot="metrics-report">
      <AttentionTally m={metrics} category={category} hrefs={hrefs} />
      <MetricsFilters days={metrics.days} category={category} hrefs={hrefs} />
      <CoverageTable m={metrics} category={category} />
      <CompletenessSection m={metrics} category={category} />
      <ReviewSection m={metrics} />
      <UseSection m={metrics} />
      <ReliabilitySection m={metrics} />
      <HowCounted m={metrics} category={category} />
      <FlowSection m={metrics} />
      <p className="px-1 text-meta text-ink-muted">
        {C.generated(DATE.format(new Date(metrics.generatedAt)))}
      </p>
    </div>
  )
}
