// Made-up metrics for the dev gallery (/ui-preview/gallery#metrics) and the
// unit and UI tests. Never imported by a product screen. Shaped like
// public.venue_metrics; the slot list reproduces the coverage counts (AC39).

import type {
  CoverageCounts,
  MetricSlot,
  MetricsOverview,
  VenueMetrics,
} from "./model"

const GENERATED = "2026-11-18T10:00:00.000Z"

let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`

function slots(
  category: MetricSlot["category"],
  kind: MetricSlot["kind"],
  group: string,
  states: Array<[MetricSlot["state"], string, boolean?]>
): MetricSlot[] {
  return states.map(([state, name, unavailable]) => ({
    kind,
    slotId: id(),
    name,
    groupName: group,
    category,
    state,
    counted: state !== "not_here" && state !== "inactive",
    unavailable: unavailable === true,
  }))
}

export const FIXTURE_SLOTS: MetricSlot[] = [
  ...slots("food", "dish", "Mains", [
    ["covered", "Steak and ale pie"],
    ["covered", "Fish and chips"],
    ["covered", "Ploughman's"],
    ["pending", "Sunday roast"],
    ["missing", "Sticky toffee pudding", true],
    ["replacement_needed", "Halloumi burger"],
  ]),
  ...slots("drinks", "dish", "Draught", [
    ["covered", "House bitter"],
    ["check_due", "Seasonal cider"],
  ]),
  ...slots("spaces", "area", "Garden", [
    ["covered", "Garden"],
    ["missing", "Snug"],
  ]),
  ...slots("facilities", "amenity", "Access", [
    ["covered", "Step-free entrance"],
    ["not_here", "Baby changing"],
    ["inactive", "Guest Wi-Fi"],
  ]),
]

function countOf(list: MetricSlot[]): CoverageCounts {
  const by = (s: MetricSlot["state"]) =>
    list.filter((x) => x.state === s).length
  return {
    total: list.filter((x) => x.counted).length,
    covered: by("covered"),
    checkDue: by("check_due"),
    pending: by("pending"),
    replacementNeeded: by("replacement_needed"),
    missing: by("missing"),
    notHere: by("not_here"),
    inactive: by("inactive"),
    unavailable: list.filter((x) => x.counted && x.unavailable).length,
  }
}

const CATEGORIES = ["food", "drinks", "spaces", "facilities", "other"] as const

export function fixtureMetrics(
  overrides: Partial<VenueMetrics> = {},
  list: MetricSlot[] = FIXTURE_SLOTS
): VenueMetrics {
  const categories = CATEGORIES.map((category) => ({
    category,
    ...countOf(list.filter((s) => s.category === category)),
  }))
  return {
    venueId: "00000000-0000-4000-8000-00000000a001",
    venueName: "The Example Arms",
    days: 30,
    from: "2026-10-19T10:00:00.000Z",
    generatedAt: GENERATED,
    coverage: { categories, totals: countOf(list) },
    slots: list,
    items: categories.map((c) => ({
      category: c.category,
      satisfied: c.category === "facilities" ? 4 : c.covered,
      total: c.category === "facilities" ? 6 : c.total,
    })),
    facts: {
      numerator: 5,
      denominator: 6,
      checkDue: 1,
      unconfirmed: 0,
      withdrawn: 0,
      byCategory: [{ category: "access", numerator: 5, denominator: 6 }],
    },
    review: {
      decided: 14,
      medianSeconds: 5400,
      p90Seconds: 86400,
      byKind: [
        { kind: "dish", decided: 11, medianSeconds: 3600 },
        { kind: "area", decided: 3, medianSeconds: 7200 },
      ],
      waiting: 3,
      oldestWaitingAt: "2026-11-16T10:00:00.000Z",
      overdueChecks: 0,
      processing: { count: 20, medianSeconds: 40, p90Seconds: 180 },
    },
    labels: {
      reviewed: 12,
      corrected: 2,
      byRoute: [
        { route: "gallery", reviewed: 8, corrected: 2 },
        { route: "slot", reviewed: 4, corrected: 0 },
      ],
      labelledByReviewer: 1,
    },
    needsLabel: {
      count: 4,
      oldestAt: "2026-11-05T10:00:00.000Z",
      inManagerQueue: 1,
    },
    contributions: {
      useful: 9,
      firstFulfilment: 7,
      replacement: 2,
      extra: 3,
      duplicates: 1,
    },
    contentUse: {
      exports: { packages: 2, downloads: 3, files: 24 },
      publications: { published: 5, assets: 5, withdrawn: 1 },
    },
    reliability: {
      uploads: 40,
      failed: 1,
      notFinished: 1,
      stuckProcessing: 0,
      recovered: 2,
      clientFailures: 3,
      clientRetries: 3,
      exportFailures: 0,
      destinationFailures: 0,
      technical: 2,
      editorial: 2,
    },
    flow: [
      { name: "flow_started", route: "gallery", count: 12 },
      { name: "subject_selected", route: "gallery", count: 30 },
      { name: "submitted", route: "gallery", count: 30 },
      { name: "match_later", route: "gallery", count: 4 },
    ],
    ...overrides,
  }
}

/** A venue with nothing set up yet: no slots, no decisions, no events. */
export function emptyFixtureMetrics(): VenueMetrics {
  const zero = fixtureMetrics({}, [])
  return {
    ...zero,
    venueName: "The New Venue",
    items: zero.items.map((i) => ({ ...i, satisfied: 0, total: 0 })),
    facts: { ...zero.facts, numerator: 0, denominator: 0, checkDue: 0 },
    review: {
      ...zero.review,
      decided: 0,
      medianSeconds: null,
      p90Seconds: null,
      byKind: [],
      waiting: 0,
      oldestWaitingAt: null,
      processing: { count: 0, medianSeconds: null, p90Seconds: null },
    },
    labels: { reviewed: 0, corrected: 0, byRoute: [], labelledByReviewer: 0 },
    needsLabel: { count: 0, oldestAt: null, inManagerQueue: 0 },
    contributions: {
      useful: 0,
      firstFulfilment: 0,
      replacement: 0,
      extra: 0,
      duplicates: 0,
    },
    flow: [],
  }
}

export function fixtureOverview(): MetricsOverview {
  const strip = ({ slots: _s, flow: _f, ...rest }: VenueMetrics) => rest
  return {
    days: 30,
    generatedAt: GENERATED,
    failedJobs: 1,
    venues: [
      strip(fixtureMetrics()),
      strip({
        ...emptyFixtureMetrics(),
        venueId: "00000000-0000-4000-8000-00000000a002",
      }),
    ],
  }
}
