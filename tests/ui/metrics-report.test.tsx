// @vitest-environment jsdom
// S2-METRICS screens (spec §18.1, AC39): what is missing or waiting first,
// coverage by category as "n of N" with the percentage secondary, filters as
// links, the counted slots behind the number, the admin overview with a link
// per venue, and an empty venue. Nobody is named or ranked.
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

import { metricsHrefs } from "@/components/nabalens/metrics/hrefs"
import { MetricsOverviewTable } from "@/components/nabalens/metrics/metrics-overview"
import {
  MetricsReport,
  type MetricsHrefs,
} from "@/components/nabalens/metrics/metrics-report"
import {
  emptyFixtureMetrics,
  fixtureMetrics,
  fixtureOverview,
} from "@/lib/metrics/fixtures"

afterEach(cleanup)

const hrefs: MetricsHrefs = {
  filter: (next) =>
    metricsHrefs.manager({
      days: next.days ?? 30,
      category: next.category === undefined ? null : next.category,
    }),
  review: "/manager/review",
  needsLabel: "/manager/review",
}

describe("MetricsReport", () => {
  it("leads with what needs attention, linked to where it is done", () => {
    render(
      <MetricsReport metrics={fixtureMetrics()} category={null} hrefs={hrefs} />
    )
    const sections = screen.getAllByRole("heading", { level: 2 })
    expect(sections[0]!.textContent).toBe("Needs attention")
    const attention = screen.getByRole("region", { name: "Needs attention" })
    const review = within(attention).getByRole("link", {
      name: /Awaiting review/,
    })
    expect(review.getAttribute("href")).toBe("/manager/review")
    expect(review.textContent).toContain("3")
    expect(review.textContent).toContain("oldest 2 days")
  })

  it("shows coverage per category as n of N with the percentage after it", () => {
    render(
      <MetricsReport metrics={fixtureMetrics()} category={null} hrefs={hrefs} />
    )
    const table = screen.getByRole("region", { name: /Photo coverage/ })
    const food = table.querySelector('[data-category="food"]')!
    expect(food.textContent).toContain("3 of 6")
    expect(food.textContent).toContain("50%")
    const facilities = table.querySelector('[data-category="facilities"]')!
    // Not here and No photo needed leave the total.
    expect(facilities.textContent).toContain("1 of 1")
    expect(table.textContent).toContain("1 slot is temporarily unavailable")
  })

  it("narrows to one category and keeps the period in its links", () => {
    render(
      <MetricsReport
        metrics={fixtureMetrics()}
        category="spaces"
        hrefs={hrefs}
      />
    )
    const table = screen.getByRole("region", { name: /Photo coverage/ })
    expect(table.querySelectorAll("[data-category]")).toHaveLength(1)
    // Category is a Select (handoff 2); its choice shows on the trigger.
    const category = screen.getByRole("combobox", { name: "Category" })
    expect(category.textContent).toContain("Spaces")
    const periods = screen.getByRole("group", { name: "Period" })
    expect(
      within(periods)
        .getByRole("link", { name: /Last 7 days/ })
        .getAttribute("href")
    ).toBe("/manager/metrics?days=7")
    expect(
      within(periods)
        .getByRole("link", { name: /Last 30 days/ })
        .getAttribute("aria-current")
    ).toBe("true")
  })

  it("lists the counted slots behind the number (AC39)", () => {
    const m = fixtureMetrics()
    render(<MetricsReport metrics={m} category={null} hrefs={hrefs} />)
    const how = screen.getByRole("region", { name: "How this is counted" })
    expect(how.querySelector('[data-slot="reproduced"]')!.textContent).toBe(
      `Counting the slots below gives ${m.coverage.totals.covered} of ${m.coverage.totals.total} covered.`
    )
    const covered = how.querySelector('details[data-state="covered"]')!
    expect(covered.textContent).toContain("Covered")
    expect(covered.textContent).toContain("Steak and ale pie")
    const notHere = how.querySelector('details[data-state="not_here"]')!
    expect(notHere.textContent).toContain("not in the total")
  })

  it("folds the reference sections shut, each whole inside", () => {
    render(
      <MetricsReport metrics={fixtureMetrics()} category={null} hrefs={hrefs} />
    )
    const more = screen.getByRole("group", { name: "More about these numbers" })
    const folds = more.querySelectorAll<HTMLDetailsElement>(":scope > details")
    expect(
      Array.from(folds, (d) => d.querySelector("summary")!.textContent)
    ).toEqual([
      expect.stringContaining("Contributions and use"),
      expect.stringContaining("Reliability"),
      expect.stringContaining("How this is counted"),
      expect.stringContaining("How photos are added"),
    ])
    for (const d of Array.from(folds)) expect(d.open).toBe(false)
    const table = screen.getByRole("region", { name: /Photo coverage/ })
    expect(within(table).getAllByText("Retake").length).toBeGreaterThan(0)
  })

  it("separates technical failures from editorial retakes", () => {
    render(
      <MetricsReport metrics={fixtureMetrics()} category={null} hrefs={hrefs} />
    )
    const rel = screen.getByRole("region", { name: /Reliability/ })
    expect(rel.textContent).toContain("Technical failures")
    expect(rel.textContent).toContain("Retakes asked for")
    expect(rel.textContent).toContain("editorial, not technical")
  })

  it("shows an empty venue without inventing numbers", () => {
    render(
      <MetricsReport
        metrics={emptyFixtureMetrics()}
        category={null}
        hrefs={hrefs}
      />
    )
    expect(screen.getByText("No slots yet")).toBeTruthy()
    expect(screen.getByText("Nothing recorded in this period.")).toBeTruthy()
    const table = screen.getByRole("region", { name: /Photo coverage/ })
    expect(table.textContent).toContain("0 of 0")
    expect(table.textContent).not.toContain("%")
  })

  it("names nobody", () => {
    const { container } = render(
      <MetricsReport metrics={fixtureMetrics()} category={null} hrefs={hrefs} />
    )
    expect(container.textContent).not.toMatch(
      /rank|leaderboard|top contributor/i
    )
  })
})

describe("MetricsOverviewTable", () => {
  it("lists each venue by name with a link to its report", () => {
    const o = fixtureOverview()
    render(
      <MetricsOverviewTable
        overview={o}
        venueHref={(id) => metricsHrefs.admin({ venue: id })}
      />
    )
    const link = screen.getByRole("link", { name: "The Example Arms" })
    expect(link.getAttribute("href")).toBe(
      `/admin/metrics?venue=${o.venues[0]!.venueId}`
    )
    const row = link.closest("tr")!
    expect(row.textContent).toContain("6 of 11")
    expect(row.textContent).toContain("5 of 6")
    expect(screen.getByText(/1 scheduled job failed/)).toBeTruthy()
  })

  it("says so when there are no active venues", () => {
    render(
      <MetricsOverviewTable
        overview={{ ...fixtureOverview(), venues: [], failedJobs: 0 }}
        venueHref={(id) => id}
      />
    )
    expect(screen.getByText("No active venues")).toBeTruthy()
  })
})

describe("metricsHrefs", () => {
  it("keeps defaults out of the URL", () => {
    expect(metricsHrefs.manager()).toBe("/manager/metrics")
    expect(metricsHrefs.manager({ days: 30, category: null })).toBe(
      "/manager/metrics"
    )
    expect(metricsHrefs.admin({ venue: "v", days: 90, category: "food" })).toBe(
      "/admin/metrics?venue=v&days=90&category=food"
    )
  })
})
