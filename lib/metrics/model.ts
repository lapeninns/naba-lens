// Metrics and reporting (spec §18.1; 20261118117100_metrics_reads.sql).
// Pure and client-safe: parsing venue_metrics, metrics_overview and
// my_contribution_metrics, and the words and numbers the screens show.
// Managers and admins see "n of N" with the percentage as secondary text
// (FA-8); nothing here ranks or compares people (DESIGN.md §9).

import { coverageWords } from "@/lib/knowledge/facts"

export const METRIC_CATEGORIES = [
  "food",
  "drinks",
  "spaces",
  "facilities",
  "other",
] as const
export type MetricCategory = (typeof METRIC_CATEGORIES)[number]

export const CATEGORY_WORDS: Record<MetricCategory, string> = {
  food: "Food",
  drinks: "Drinks",
  spaces: "Spaces",
  facilities: "Amenities",
  other: "Other",
}

/** The periods a report can cover, in days (the database allows 1 to 366). */
export const METRIC_PERIODS = [7, 30, 90] as const
export type MetricPeriod = (typeof METRIC_PERIODS)[number]
export const DEFAULT_PERIOD: MetricPeriod = 30

export function parsePeriod(raw: unknown): MetricPeriod {
  const n = typeof raw === "string" ? Number(raw) : raw
  return (METRIC_PERIODS as readonly unknown[]).includes(n)
    ? (n as MetricPeriod)
    : DEFAULT_PERIOD
}

export function parseCategory(raw: unknown): MetricCategory | null {
  return typeof raw === "string" &&
    (METRIC_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as MetricCategory)
    : null
}

/** Slot states of the one coverage rule (public.coverage_slots). */
export type SlotStateKey =
  | "covered"
  | "check_due"
  | "pending"
  | "replacement_needed"
  | "missing"
  | "not_here"
  | "inactive"

/** The order states are listed in "How this is counted" (counted first). */
export const SLOT_STATE_ORDER: SlotStateKey[] = [
  "covered",
  "check_due",
  "pending",
  "replacement_needed",
  "missing",
  "not_here",
  "inactive",
]

export type CoverageCounts = {
  total: number
  covered: number
  checkDue: number
  pending: number
  replacementNeeded: number
  missing: number
  notHere: number
  inactive: number
  unavailable: number
}

export type MetricSlot = {
  kind: "dish" | "area" | "amenity"
  slotId: string
  name: string
  groupName: string
  category: MetricCategory
  state: SlotStateKey
  counted: boolean
  unavailable: boolean
}

export type Fraction = { numerator: number; denominator: number }

export type VenueMetrics = {
  venueId: string
  venueName: string
  days: number
  from: string
  generatedAt: string
  coverage: {
    categories: Array<{ category: MetricCategory } & CoverageCounts>
    totals: CoverageCounts
  }
  slots: MetricSlot[]
  items: Array<{ category: MetricCategory; satisfied: number; total: number }>
  facts: Fraction & {
    checkDue: number
    unconfirmed: number
    withdrawn: number
    byCategory: Array<{ category: string } & Fraction>
  }
  review: {
    decided: number
    medianSeconds: number | null
    p90Seconds: number | null
    byKind: Array<{
      kind: string
      decided: number
      medianSeconds: number | null
    }>
    waiting: number
    oldestWaitingAt: string | null
    overdueChecks: number
    processing: {
      count: number
      medianSeconds: number | null
      p90Seconds: number | null
    }
  }
  labels: {
    reviewed: number
    corrected: number
    byRoute: Array<{ route: string; reviewed: number; corrected: number }>
    labelledByReviewer: number
  }
  needsLabel: { count: number; oldestAt: string | null; inManagerQueue: number }
  contributions: {
    useful: number
    firstFulfilment: number
    replacement: number
    extra: number
    duplicates: number
  }
  contentUse: {
    exports: { packages: number; downloads: number; files: number }
    publications: { published: number; assets: number; withdrawn: number }
  }
  reliability: {
    uploads: number
    failed: number
    notFinished: number
    stuckProcessing: number
    recovered: number
    clientFailures: number
    clientRetries: number
    exportFailures: number
    destinationFailures: number
    technical: number
    editorial: number
  }
  flow: Array<{ name: string; route: string | null; count: number }>
}

/** A venue row of the admin overview: no slot list, no flow events. */
export type VenueMetricsSummary = Omit<VenueMetrics, "slots" | "flow">

export type MetricsOverview = {
  days: number
  generatedAt: string
  failedJobs: number
  venues: VenueMetricsSummary[]
}

export type MyContributions = {
  days: number
  useful: number
  firstFulfilment: number
  replacement: number
  extra: number
}

// ---------------------------------------------------------------------------
// Parsing (the database is trusted for shape, never for presence)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : 0
const numOrNull = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null
const str = (v: unknown) => (typeof v === "string" ? v : "")
const strOrNull = (v: unknown) => (typeof v === "string" ? v : null)

function counts(v: unknown): CoverageCounts {
  const o = obj(v)
  return {
    total: num(o.total),
    covered: num(o.covered),
    checkDue: num(o.checkDue),
    pending: num(o.pending),
    replacementNeeded: num(o.replacementNeeded),
    missing: num(o.missing),
    notHere: num(o.notHere),
    inactive: num(o.inactive),
    unavailable: num(o.unavailable),
  }
}

const isState = (v: unknown): v is SlotStateKey =>
  typeof v === "string" && (SLOT_STATE_ORDER as string[]).includes(v)

/** The StatusChip key for a slot state (words live in status-chip.tsx). */
export const slotChipKey = (state: SlotStateKey) => `coverage_${state}` as const

function slot(v: unknown): MetricSlot | null {
  const o = obj(v)
  const category = parseCategory(o.category)
  const kind = o.kind
  if (
    !category ||
    !isState(o.state) ||
    (kind !== "dish" && kind !== "area" && kind !== "amenity")
  )
    return null
  return {
    kind,
    slotId: str(o.slotId),
    name: str(o.name),
    groupName: str(o.groupName),
    category,
    state: o.state,
    counted: o.counted === true,
    unavailable: o.unavailable === true,
  }
}

function fraction(v: unknown): Fraction {
  const o = obj(v)
  return { numerator: num(o.numerator), denominator: num(o.denominator) }
}

function summary(raw: unknown): VenueMetricsSummary | null {
  const o = obj(raw)
  if (typeof o.venueId !== "string") return null
  const coverage = obj(o.coverage)
  const facts = obj(o.facts)
  const review = obj(o.review)
  const processing = obj(review.processing)
  const labels = obj(o.labels)
  const needs = obj(o.needsLabel)
  const useful = obj(o.contributions)
  const content = obj(o.contentUse)
  const exports = obj(content.exports)
  const pubs = obj(content.publications)
  const rel = obj(o.reliability)
  return {
    venueId: o.venueId,
    venueName: str(o.venueName),
    days: num(o.days),
    from: str(o.from),
    generatedAt: str(o.generatedAt),
    coverage: {
      categories: arr(coverage.categories).flatMap((c) => {
        const category = parseCategory(obj(c).category)
        return category ? [{ category, ...counts(c) }] : []
      }),
      totals: counts(coverage.totals),
    },
    items: arr(o.items).flatMap((i) => {
      const r = obj(i)
      const category = parseCategory(r.category)
      return category
        ? [{ category, satisfied: num(r.satisfied), total: num(r.total) }]
        : []
    }),
    facts: {
      ...fraction(facts),
      checkDue: num(facts.checkDue),
      unconfirmed: num(facts.unconfirmed),
      withdrawn: num(facts.withdrawn),
      byCategory: arr(facts.byCategory).map((c) => ({
        category: str(obj(c).category),
        ...fraction(c),
      })),
    },
    review: {
      decided: num(review.decided),
      medianSeconds: numOrNull(review.medianSeconds),
      p90Seconds: numOrNull(review.p90Seconds),
      byKind: arr(review.byKind).map((k) => {
        const r = obj(k)
        return {
          kind: str(r.kind),
          decided: num(r.decided),
          medianSeconds: numOrNull(r.medianSeconds),
        }
      }),
      waiting: num(review.waiting),
      oldestWaitingAt: strOrNull(review.oldestWaitingAt),
      overdueChecks: num(review.overdueChecks),
      processing: {
        count: num(processing.count),
        medianSeconds: numOrNull(processing.medianSeconds),
        p90Seconds: numOrNull(processing.p90Seconds),
      },
    },
    labels: {
      reviewed: num(labels.reviewed),
      corrected: num(labels.corrected),
      byRoute: arr(labels.byRoute).map((r) => {
        const x = obj(r)
        return {
          route: str(x.route),
          reviewed: num(x.reviewed),
          corrected: num(x.corrected),
        }
      }),
      labelledByReviewer: num(labels.labelledByReviewer),
    },
    needsLabel: {
      count: num(needs.count),
      oldestAt: strOrNull(needs.oldestAt),
      inManagerQueue: num(needs.inManagerQueue),
    },
    contributions: {
      useful: num(useful.useful),
      firstFulfilment: num(useful.firstFulfilment),
      replacement: num(useful.replacement),
      extra: num(useful.extra),
      duplicates: num(useful.duplicates),
    },
    contentUse: {
      exports: {
        packages: num(exports.packages),
        downloads: num(exports.downloads),
        files: num(exports.files),
      },
      publications: {
        published: num(pubs.published),
        assets: num(pubs.assets),
        withdrawn: num(pubs.withdrawn),
      },
    },
    reliability: {
      uploads: num(rel.uploads),
      failed: num(rel.failed),
      notFinished: num(rel.notFinished),
      stuckProcessing: num(rel.stuckProcessing),
      recovered: num(rel.recovered),
      clientFailures: num(rel.clientFailures),
      clientRetries: num(rel.clientRetries),
      exportFailures: num(rel.exportFailures),
      destinationFailures: num(rel.destinationFailures),
      technical: num(rel.technical),
      editorial: num(rel.editorial),
    },
  }
}

export function parseVenueMetrics(raw: unknown): VenueMetrics | null {
  const base = summary(raw)
  if (!base) return null
  const o = obj(raw)
  return {
    ...base,
    slots: arr(o.slots).flatMap((s) => {
      const parsed = slot(s)
      return parsed ? [parsed] : []
    }),
    flow: arr(o.flow).map((f) => {
      const r = obj(f)
      return {
        name: str(r.name),
        route: strOrNull(r.route),
        count: num(r.count),
      }
    }),
  }
}

export function parseMetricsOverview(raw: unknown): MetricsOverview | null {
  const o = obj(raw)
  if (!Array.isArray(o.venues)) return null
  return {
    days: num(o.days),
    generatedAt: str(o.generatedAt),
    failedJobs: num(o.failedJobs),
    venues: o.venues.flatMap((v) => {
      const parsed = summary(v)
      return parsed ? [parsed] : []
    }),
  }
}

export function parseMyContributions(raw: unknown): MyContributions | null {
  const o = obj(raw)
  if (typeof o.useful !== "number") return null
  return {
    days: num(o.days),
    useful: num(o.useful),
    firstFulfilment: num(o.firstFulfilment),
    replacement: num(o.replacement),
    extra: num(o.extra),
  }
}

// ---------------------------------------------------------------------------
// Words and derived numbers
// ---------------------------------------------------------------------------

/** "30 of 40" with "75%" as secondary text; no percentage for 0 of 0. */
export const ofWords = coverageWords

/** A category's counts, or zeros when the category is not listed. */
export function categoryCounts(
  metrics: Pick<VenueMetrics, "coverage">,
  category: MetricCategory
): CoverageCounts {
  return (
    metrics.coverage.categories.find((c) => c.category === category) ??
    counts({})
  )
}

/** The counted slots of a category (or all), grouped by state (AC39). */
export function slotsByState(
  slots: MetricSlot[],
  category: MetricCategory | null
): Array<{ state: SlotStateKey; counted: boolean; slots: MetricSlot[] }> {
  const shown = category ? slots.filter((s) => s.category === category) : slots
  return SLOT_STATE_ORDER.flatMap((state) => {
    const list = shown.filter((s) => s.state === state)
    return list.length > 0
      ? [{ state, counted: list[0]!.counted, slots: list }]
      : []
  })
}

/**
 * Re-derives a coverage fraction from the slot list, so a screen (and a
 * test) can show the number reproduces (AC39).
 */
export function reproduce(
  slots: MetricSlot[],
  category: MetricCategory | null
): { covered: number; total: number } {
  const counted = slots.filter(
    (s) => s.counted && (!category || s.category === category)
  )
  return {
    covered: counted.filter((s) => s.state === "covered").length,
    total: counted.length,
  }
}

/** A duration for people: "under a minute", "45 min", "3 h", "2 days". */
export function durationWords(seconds: number | null): string {
  if (seconds == null) return "No decisions yet"
  if (seconds < 60) return "under a minute"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(seconds / 3600)
  if (hours < 48) return `${hours} h`
  const days = Math.round(seconds / 86400)
  return `${days} days`
}

/** Correction rate words: "1 of 4 corrected (25%)". */
export function rateWords(corrected: number, reviewed: number): string {
  const { text, percent } = coverageWords(corrected, reviewed)
  return percent ? `${text} corrected (${percent})` : `${text} corrected`
}

export const ROUTE_WORDS: Record<string, string> = {
  slot: "From a slot",
  gallery: "From the gallery (Match)",
  request: "From a request",
  match_later: "From Match later",
  not_recorded: "Before recording began",
}

export const routeWords = (route: string) => ROUTE_WORDS[route] ?? route

export const REVIEW_KIND_WORDS: Record<string, string> = {
  dish: "Dishes and drinks",
  area: "Spaces",
  amenity: "Amenities",
  checklist: "Checklists",
}

export const FLOW_EVENT_WORDS: Record<string, string> = {
  flow_started: "Adding started",
  subject_selected: "Slot chosen",
  label_uncertain: "I'm not sure",
  match_later: "Match later",
  not_for_slot: "Not for a slot",
  batch_grouped: "Photos grouped",
  submitted: "Sent",
  transfer_failed: "Sending failed",
  transfer_retried: "Sent again",
}

export const flowWords = (name: string) => FLOW_EVENT_WORDS[name] ?? name
