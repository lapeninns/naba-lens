// @vitest-environment jsdom
// Redesign R5: the admin route map (docs/plans/redesign-2026-11/ia.md,
// "Admin"). Tabs and picks give every admin route a home in the nav; one
// venue's pages share the VenueBar, BackLink, title and tabs.
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { adminVenueTabOf } from "@/app/admin/_components/admin-boundary"
import {
  AdminTabs,
  LIBRARY_TABS,
  OVERVIEW_TABS,
  PEOPLE_TABS,
  SETTINGS_TABS,
  VENUE_FACTS_PICKS,
  VenueFactsHeader,
} from "@/app/admin/_components/admin-tabs"
import { AdminVenueHeader } from "@/app/admin/_components/admin-venue-header"

afterEach(cleanup)

const VENUE = "6f1c1f5e-0000-4000-8000-000000000001"
const BASE = `/admin/coverage/${VENUE}`

const linksIn = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole("link")
    .map((a) => [a.textContent, a.getAttribute("href")])

const currentIn = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole("link")
    .filter((a) => a.getAttribute("aria-current") === "page")
    .map((a) => a.textContent)

describe("admin section tabs", () => {
  it("place the orphans: Albums, This month and Metrics under Overview", () => {
    expect(OVERVIEW_TABS.map((t) => [t.label, t.href])).toEqual([
      ["By venue", "/admin/overview"],
      ["Albums", "/admin/albums"],
      ["This month", "/admin/coverage"],
      ["Metrics", "/admin/metrics"],
    ])
    expect(LIBRARY_TABS.map((t) => [t.label, t.href])).toEqual([
      ["Photos", "/admin"],
      ["Collections", "/admin/library/collections"],
      ["Tags", "/admin/library/tags"],
      ["Removal requests", "/admin/library/removals"],
    ])
    // Decision 8: Venue managers sits under People.
    expect(PEOPLE_TABS.map((t) => [t.label, t.href])).toEqual([
      ["Accounts", "/admin/staff"],
      ["Venue managers", "/admin/coverage/managers"],
    ])
    // Decision 7: "Knowledge" is Venue facts, Runs are Imports, Schema
    // upgrades are Question changes. The routes stay (decision 1).
    expect(SETTINGS_TABS.map((t) => [t.label, t.href])).toEqual([
      ["Rules", "/admin/settings"],
      ["Activity", "/admin/activity"],
      ["Venue facts", "/admin/knowledge/sources"],
    ])
    expect(VENUE_FACTS_PICKS.map((t) => [t.label, t.href])).toEqual([
      ["Sources", "/admin/knowledge/sources"],
      ["Imports", "/admin/knowledge/runs"],
      ["Check dates", "/admin/knowledge/check-dates"],
      ["Question changes", "/admin/knowledge/upgrades"],
    ])
  })

  it("mark the current tab with aria-current", () => {
    render(<AdminTabs set="overview" active="metrics" />)
    const nav = screen.getByRole("navigation", { name: "Overview" })
    expect(currentIn(nav)).toEqual(["Metrics"])
  })

  it("show Venue facts under the Settings title, with its pick", () => {
    render(<VenueFactsHeader active="imports" />)
    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeTruthy()
    expect(
      currentIn(screen.getByRole("navigation", { name: "Settings" }))
    ).toEqual(["Venue facts"])
    expect(
      currentIn(screen.getByRole("group", { name: "Venue facts" }))
    ).toEqual(["Imports"])
  })
})

describe("one venue's frame", () => {
  it("a tab root: VenueBar, back to Venues, the tab's title, tabs and pick", () => {
    render(
      <AdminVenueHeader
        venueId={VENUE}
        venueName="The Old Crown, Girton"
        month="November 2026"
        view={{ tab: "review", pick: "menu-and-spaces" }}
        title="Review menu photos"
        pendingReview={7}
      />
    )
    expect(screen.getByText("The Old Crown, Girton")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Change venue" }).getAttribute("href")
    ).toBe("/admin/venues")
    expect(
      screen.getByRole("link", { name: "Venues" }).getAttribute("href")
    ).toBe("/admin/venues")
    expect(
      screen.getByRole("heading", { level: 1, name: "Review" })
    ).toBeTruthy()
    const tabs = screen.getByRole("navigation", {
      name: "The Old Crown, Girton",
    })
    expect(linksIn(tabs).map(([label]) => label)).toEqual([
      "Coverage",
      "Review, 7 to review",
      "Album",
      "Checklist",
      "Team",
      "Setup",
    ])
    expect(
      within(tabs).getByRole("link", { name: "Setup" }).getAttribute("href")
    ).toBe(`/admin/venues/${VENUE}`)
    expect(currentIn(tabs)).toEqual(["Review, 7 to review"])
    // One Review tab, two views: both routes stay.
    const pick = screen.getByRole("group", { name: "Review" })
    expect(linksIn(pick)).toEqual([
      ["Menu and spaces", `${BASE}/menu-photos`],
      ["Checklist", `${BASE}/review`],
    ])
    expect(currentIn(pick)).toEqual(["Menu and spaces"])
  })

  it("a detail page: back to its parent tab, its own title, no pick", () => {
    render(
      <AdminVenueHeader
        venueId={VENUE}
        venueName="The Old Crown"
        view={{ tab: "checklist" }}
        title="Beer garden"
        back={{ href: `${BASE}/checklist`, label: "Checklist" }}
      />
    )
    const back = screen.getAllByRole("link", { name: "Checklist" })[0]!
    expect(back.getAttribute("href")).toBe(`${BASE}/checklist`)
    expect(
      screen.getByRole("heading", { level: 1, name: "Beer garden" })
    ).toBeTruthy()
    expect(screen.queryByRole("group")).toBeNull()
  })

  it("boundaries find the tab from the path", () => {
    expect(adminVenueTabOf(BASE)).toBe("coverage")
    expect(adminVenueTabOf(`${BASE}/menu`)).toBe("coverage")
    expect(adminVenueTabOf(`${BASE}/menu-photos/photo/x`)).toBe("review")
    expect(adminVenueTabOf(`${BASE}/review`)).toBe("review")
    expect(adminVenueTabOf(`${BASE}/menu/items`)).toBe("album")
    expect(adminVenueTabOf(`${BASE}/amenities/places`)).toBe("album")
    expect(adminVenueTabOf(`${BASE}/checklist/abc`)).toBe("checklist")
    expect(adminVenueTabOf(`${BASE}/team`)).toBe("team")
  })
})
