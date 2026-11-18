import { describe, expect, it } from "vitest"

import {
  emptyFixtureMetrics,
  fixtureMetrics,
  fixtureOverview,
} from "@/lib/metrics/fixtures"
import {
  DEFAULT_PERIOD,
  durationWords,
  parseCategory,
  parseMetricsOverview,
  parseMyContributions,
  parsePeriod,
  parseVenueMetrics,
  rateWords,
  reproduce,
  routeWords,
  slotChipKey,
  slotsByState,
} from "@/lib/metrics/model"
import { CHIP_STATES } from "@/components/nabalens/status-chip"
import { METRICS_COPY } from "@/components/nabalens/metrics/copy"

// S2-METRICS (spec §18.1, AC39): parsing the metrics reads and the derived
// numbers the screens show.

describe("parseVenueMetrics", () => {
  it("round-trips the database's shape", () => {
    const m = fixtureMetrics()
    expect(parseVenueMetrics(JSON.parse(JSON.stringify(m)))).toEqual(m)
  })

  it("refuses a payload without a venue and fills missing numbers with zero", () => {
    expect(parseVenueMetrics(null)).toBeNull()
    expect(parseVenueMetrics({})).toBeNull()
    const thin = parseVenueMetrics({ venueId: "v", coverage: {} })!
    expect(thin.coverage.totals.total).toBe(0)
    expect(thin.review.medianSeconds).toBeNull()
    expect(thin.slots).toEqual([])
    expect(thin.flow).toEqual([])
  })

  it("drops slots with an unknown state, kind or category", () => {
    const m = parseVenueMetrics({
      venueId: "v",
      slots: [
        { kind: "dish", category: "food", state: "covered", counted: true },
        { kind: "dish", category: "food", state: "approved", counted: true },
        { kind: "cat", category: "food", state: "covered", counted: true },
        { kind: "dish", category: "mains", state: "covered", counted: true },
      ],
    })!
    expect(m.slots).toHaveLength(1)
  })
})

describe("overview and own contributions", () => {
  it("parses the admin overview without slots", () => {
    const o = fixtureOverview()
    const parsed = parseMetricsOverview(JSON.parse(JSON.stringify(o)))!
    expect(parsed.venues).toHaveLength(2)
    expect(parsed.failedJobs).toBe(1)
    expect(parseMetricsOverview({})).toBeNull()
  })

  it("parses own contributions", () => {
    expect(
      parseMyContributions({
        days: 30,
        useful: 2,
        firstFulfilment: 1,
        replacement: 1,
        extra: 0,
      })
    ).toEqual({
      days: 30,
      useful: 2,
      firstFulfilment: 1,
      replacement: 1,
      extra: 0,
    })
    expect(parseMyContributions({})).toBeNull()
  })
})

describe("AC39: the number reproduces from its slots", () => {
  it("re-derives every category's numerator and denominator", () => {
    const m = fixtureMetrics()
    for (const c of m.coverage.categories) {
      expect(reproduce(m.slots, c.category), c.category).toEqual({
        covered: c.covered,
        total: c.total,
      })
    }
    expect(reproduce(m.slots, null)).toEqual({
      covered: m.coverage.totals.covered,
      total: m.coverage.totals.total,
    })
  })

  it("keeps a temporarily unavailable dish in the total (inv. 7)", () => {
    const m = fixtureMetrics()
    const pudding = m.slots.find((s) => s.unavailable)!
    expect(pudding.counted).toBe(true)
    expect(m.coverage.totals.unavailable).toBe(1)
  })

  it("groups slots by state, counted states first", () => {
    const groups = slotsByState(fixtureMetrics().slots, null)
    expect(groups.map((g) => g.state)).toEqual([
      "covered",
      "check_due",
      "pending",
      "replacement_needed",
      "missing",
      "not_here",
      "inactive",
    ])
    expect(groups.find((g) => g.state === "not_here")!.counted).toBe(false)
    expect(slotsByState(fixtureMetrics().slots, "spaces")).toHaveLength(2)
    expect(slotsByState(emptyFixtureMetrics().slots, null)).toEqual([])
  })

  it("names slot states with the coverage chips' own words (X11)", () => {
    expect(METRICS_COPY.covered).toBe(CHIP_STATES.coverage_covered.word)
    expect(METRICS_COPY.awaitingReview).toBe(CHIP_STATES.coverage_pending.word)
    expect(METRICS_COPY.checkDue).toBe(CHIP_STATES.coverage_check_due.word)
    expect(METRICS_COPY.anotherPhoto).toBe(
      CHIP_STATES.coverage_replacement_needed.word
    )
    expect(METRICS_COPY.missing).toBe(CHIP_STATES.coverage_missing.word)
    expect(METRICS_COPY.coverageRule).toContain(
      CHIP_STATES.coverage_inactive.word
    )
  })

  it("has a status chip for every slot state", () => {
    for (const g of slotsByState(fixtureMetrics().slots, null))
      expect(Object.hasOwn(CHIP_STATES, slotChipKey(g.state))).toBe(true)
  })
})

describe("words", () => {
  it("says durations in plain words", () => {
    expect(durationWords(null)).toBe("No decisions yet")
    expect(durationWords(30)).toBe("under a minute")
    expect(durationWords(45 * 60)).toBe("45 min")
    expect(durationWords(3 * 3600)).toBe("3 h")
    expect(durationWords(5 * 86400)).toBe("5 days")
  })

  it("shows a rate with its numerator and denominator", () => {
    expect(rateWords(1, 4)).toBe("1 of 4 corrected (25%)")
    expect(rateWords(0, 0)).toBe("0 of 0 corrected")
    expect(routeWords("not_recorded")).toBe("Before recording began")
    expect(routeWords("unknown_route")).toBe("unknown_route")
  })

  it("reads filters from the URL, defaulting safely", () => {
    expect(parsePeriod("7")).toBe(7)
    expect(parsePeriod("8")).toBe(DEFAULT_PERIOD)
    expect(parsePeriod(undefined)).toBe(DEFAULT_PERIOD)
    expect(parseCategory("drinks")).toBe("drinks")
    expect(parseCategory("mains")).toBeNull()
    expect(parseCategory(["food"])).toBeNull()
  })
})
