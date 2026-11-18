// S2-ADMIN (spec §8 A1, A2): the overview and venue models' pure rules —
// parsing, URL filters, links behind every number, attention first, the
// setup checklist's words and venue form validation.
import { describe, expect, it } from "vitest"

import {
  ageWords,
  attentionFirst,
  categoryHref,
  categoryTotals,
  ofWords,
  parseOverview,
  parseOverviewFilters,
  periodRange,
  recentPeriods,
  rowAttention,
  rowHrefs,
  type OverviewRow,
} from "@/lib/admin/overview"
import { coverageWords } from "@/lib/knowledge/facts"
import {
  effectiveOperatingStatus,
  operatingStatusChip,
  parseVenueDetail,
  parseVenueList,
  setupBlocked,
  setupDetail,
  setupHref,
  validateVenueForm,
  VENUE_ERRORS,
} from "@/lib/admin/venues"

const V1 = "11111111-1111-4111-8111-111111111111"
const V2 = "22222222-2222-4222-8222-222222222222"
const NOW = new Date("2026-11-18T12:00:00Z")

const setup = (done: boolean[]) => ({
  items: ["inventory", "reviewers", "staff", "spaces", "collection"].map(
    (key, i) => ({ key, done: done[i] ?? true })
  ),
  done: done.filter(Boolean).length,
  total: 5,
})

function raw(over: Record<string, unknown> = {}) {
  return {
    venueId: V1,
    name: "The Bell",
    timezone: "Europe/London",
    operatingStatus: "open",
    active: true,
    categories: [
      { category: "food", total: 10, covered: 4, pending: 2, checkDue: 1 },
      { category: "drinks", total: 0, covered: 0 },
      { category: "spaces", total: 3, covered: 3 },
      { category: "facilities", total: 5, covered: 2 },
      { category: "other", total: 1, covered: 0 },
      { category: "bogus", total: 9, covered: 9 },
    ],
    nextMenu: null,
    facts: { confirmed: 6, total: 8, checkDue: 1, unconfirmed: 1 },
    unlabelled: 7,
    review: { waiting: 2, oldestAt: "2026-11-08T12:00:00Z" },
    checksDue: {
      dishes: 1,
      places: 0,
      facilities: 0,
      slots: 1,
      facts: 1,
      total: 2,
    },
    publication: { failed: 0, withdrawalPending: 0, total: 0 },
    added: 12,
    setup: setup([true, true, true, true, true]),
    ...over,
  }
}

describe("parseOverview", () => {
  it("reads rows and drops unknown categories and broken rows", () => {
    const rows = parseOverview({ rows: [raw(), { name: "no id" }] })!
    expect(rows).toHaveLength(1)
    expect(rows[0].categories.map((c) => c.category)).toEqual([
      "food",
      "drinks",
      "spaces",
      "facilities",
      "other",
    ])
    expect(rows[0].setup.done).toBe(5)
    expect(rows[0].added).toBe(12)
    expect(parseOverview({})).toBeNull()
    expect(parseOverview({ rows: [raw({ added: null })] })![0].added).toBeNull()
  })
})

describe("parseOverviewFilters", () => {
  it("defaults to every venue, four categories, current menu and this month", () => {
    expect(parseOverviewFilters({}, "2026-11")).toEqual({
      venueId: null,
      categories: ["food", "drinks", "spaces", "facilities"],
      menu: "current",
      period: "2026-11",
    })
  })

  it("keeps valid values in a fixed order and ignores the rest", () => {
    const f = parseOverviewFilters(
      {
        venue: V1.toUpperCase(),
        category: ["other", "food", "nope"],
        menu: "next",
        period: "2026-02",
      },
      "2026-11"
    )
    expect(f).toEqual({
      venueId: V1,
      categories: ["food", "other"],
      menu: "next",
      period: "2026-02",
    })
    // A future month is not a reporting period yet; junk is ignored.
    expect(
      parseOverviewFilters(
        { venue: "x", menu: "past", period: "2027-01" },
        "2026-11"
      )
    ).toMatchObject({ venueId: null, menu: "current", period: "2026-11" })
  })

  it("turns a month into its first and last day", () => {
    expect(periodRange("2026-02")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    })
    expect(periodRange("2024-02").to).toBe("2024-02-29")
    expect(recentPeriods("2026-01", 3)).toEqual([
      "2026-01",
      "2025-12",
      "2025-11",
    ])
  })
})

describe("every number links to its records (A1-numbers-link)", () => {
  const row = parseOverview({ rows: [raw()] })![0]
  const filters = parseOverviewFilters({ period: "2026-10" }, "2026-11")

  it("gives each number a filtered destination", () => {
    expect(rowHrefs(row, filters)).toEqual({
      venue: `/admin/venues/${V1}`,
      facts: `/admin/coverage/${V1}/amenities`,
      unlabelled: `/admin?venue=${V1}&labels=unlabelled`,
      // V18: the dish and place queues the count reads, not the checklist.
      review: `/admin/coverage/${V1}/menu-photos`,
      // V20: the total opens the biggest part (a tie: the first).
      checksDue: `/admin/coverage/${V1}/menu-photos?status=recheck`,
      checkParts: {
        dishes: `/admin/coverage/${V1}/menu-photos?status=recheck`,
        places: `/admin/coverage/${V1}/amenities/places`,
        facilities: `/admin/coverage/${V1}/amenities`,
        facts: `/admin/coverage/${V1}/amenities`,
      },
      publication: "/admin/publishing",
      added: `/admin?venue=${V1}&from=2026-10-01&to=2026-10-31`,
      setup: `/admin/venues/${V1}#setup`,
    })
  })

  it("links Checks due to the part with the most checks (V20)", () => {
    const [placesFirst] = parseOverview({
      rows: [
        raw({
          checksDue: {
            dishes: 1,
            places: 3,
            facilities: 0,
            slots: 4,
            facts: 2,
            total: 6,
          },
        }),
      ],
    })!
    expect(rowHrefs(placesFirst, filters).checksDue).toBe(
      `/admin/coverage/${V1}/amenities/places`
    )
    const [factsOnly] = parseOverview({
      rows: [
        raw({
          checksDue: {
            dishes: 0,
            places: 0,
            facilities: 0,
            slots: 0,
            facts: 1,
            total: 1,
          },
        }),
      ],
    })!
    expect(rowHrefs(factsOnly, filters).checksDue).toBe(
      `/admin/coverage/${V1}/amenities`
    )
  })

  it("sends category numbers to the slot pages, or the next menu", () => {
    expect(categoryHref(V1, "food", "current", null)).toBe(
      `/admin/coverage/${V1}/menu-photos`
    )
    expect(categoryHref(V1, "drinks", "next", "m1")).toBe(
      "/admin/menus/versions/m1"
    )
    expect(categoryHref(V1, "spaces", "next", "m1")).toBe(
      `/admin/coverage/${V1}/amenities/places`
    )
    expect(categoryHref(V1, "facilities", "current", null)).toBe(
      `/admin/coverage/${V1}/amenities`
    )
  })
})

describe("attention first (A1-blocked-first)", () => {
  const clean = raw({
    venueId: V2,
    name: "Aardvark",
    checksDue: { slots: 0, facts: 0, total: 0 },
    review: { waiting: 0, oldestAt: null },
  })
  const blocked = raw({ setup: setup([false, true, false, true, true]) })

  it("lists blocked setup, errors, checks due and long waits", () => {
    const [row] = parseOverview({
      rows: [
        raw({
          setup: setup([false]),
          publication: { failed: 1, withdrawalPending: 1, total: 2 },
        }),
      ],
    })!
    expect(rowAttention(row, NOW)).toEqual([
      { kind: "setup", missing: 1 },
      { kind: "publication", count: 2 },
      { kind: "checks", count: 2 },
      { kind: "review", days: 10 },
    ])
  })

  it("puts venues needing attention first and keeps name order", () => {
    const rows = parseOverview({ rows: [clean, blocked] })!
    const { attention, rest } = attentionFirst(rows, NOW)
    expect(attention.map((r) => r.name)).toEqual(["The Bell"])
    expect(rest.map((r) => r.name)).toEqual(["Aardvark"])
  })

  it("uses the admin's backlog alert setting, as monitoring does (V21)", () => {
    // Oldest photo waited 5 days.
    const [row] = parseOverview({
      rows: [
        raw({
          ...clean,
          review: { waiting: 1, oldestAt: "2026-11-13T12:00:00Z" },
        }),
      ],
    })!
    expect(rowAttention(row, NOW)).toEqual([])
    expect(rowAttention(row, NOW, 3)).toEqual([{ kind: "review", days: 5 }])
    expect(attentionFirst([row], NOW, 3).attention).toHaveLength(1)
    expect(attentionFirst([row], NOW, 14).attention).toHaveLength(0)
    // Monitoring's rule: more than N days, so exactly N days is not yet.
    expect(rowAttention(row, NOW, 5)).toEqual([])
    expect(
      rowAttention(row, new Date(NOW.getTime() + 1000), 5).map((a) => a.kind)
    ).toEqual(["review"])
  })

  it("shows a switched-off venue as archived whatever its stored status (V22)", () => {
    const [row] = parseOverview({
      rows: [{ ...clean, active: false, operatingStatus: "open" }],
    })!
    expect(row.operatingStatus).toBe("permanently_closed")
  })

  it("does not flag an archived venue's setup", () => {
    const [row] = parseOverview({
      rows: [
        {
          ...clean,
          active: false,
          setup: setup([false, false]),
        },
      ],
    })!
    expect(rowAttention(row, NOW)).toEqual([])
  })
})

describe("numbers", () => {
  it("writes n of N with the percentage second (FA-8)", () => {
    expect(ofWords(4, 10)).toEqual({ main: "4 of 10", pct: "40%" })
    expect(ofWords(0, 0)).toEqual({ main: "0 of 0", pct: "" })
    // F5: one decimal, the same rule as Metrics and the manager Overview.
    expect(ofWords(1, 3)).toEqual({ main: "1 of 3", pct: "33.3%" })
    expect(ofWords(2, 3).pct).toBe(coverageWords(2, 3).percent)
  })

  it("says how long the oldest photo has waited", () => {
    expect(ageWords(null, NOW)).toBeNull()
    expect(ageWords("2026-11-18T06:00:00Z", NOW)).toBe("Under a day")
    expect(ageWords("2026-11-17T11:00:00Z", NOW)).toBe("1 day")
    expect(ageWords("2026-11-08T12:00:00Z", NOW)).toBe("10 days")
  })

  it("totals a category across venues (AC39: the sum of the rows)", () => {
    const rows = parseOverview({
      rows: [raw(), raw({ venueId: V2 })],
    })! as OverviewRow[]
    expect(categoryTotals(rows, "food")).toEqual({ covered: 8, total: 20 })
  })
})

describe("venues model", () => {
  const venue = {
    id: V1,
    name: "The Bell",
    slug: "the-bell",
    locality: "Ely",
    address: null,
    timezone: "Europe/London",
    operatingStatus: "open",
    active: true,
    archivedAt: null,
    revision: 3,
    reviewers: {
      main: { profileId: V2, name: "Sam", eligible: true, revision: 1 },
      backup: null,
    },
    setup: setup([true, false, true, true, true]),
  }

  it("parses the list and the detail's candidates", () => {
    const [v] = parseVenueList({ items: [venue, { id: "x" }] })!
    expect(v).toMatchObject({
      id: V1,
      revision: 3,
      reviewers: { main: { name: "Sam" }, backup: null },
    })
    const detail = parseVenueDetail({
      ...venue,
      candidates: [
        { profileId: V2, name: "Sam", role: "manager" },
        { profileId: V1, name: "Staff", role: "staff" },
        // K8 (S3-R5): admins are never named reviewers.
        { profileId: V1, name: "Alex", role: "admin" },
      ],
    })!
    expect(detail.candidates).toEqual([
      { profileId: V2, name: "Sam", role: "manager" },
    ])
    // K8 (S3-R5): the refusal names the manager-only rule.
    expect(VENUE_ERRORS.reviewer_not_eligible?.message).toBe(
      "Only this venue's managers can be named. Make them a manager here first."
    )
    expect(setupBlocked(v)).toBe(true)
    expect(setupBlocked({ ...v, active: false })).toBe(false)
  })

  it("says what each setup item has or misses, and where it lives", () => {
    expect(setupDetail({ key: "reviewers", done: false, main: true })).toBe(
      "No backup reviewer yet."
    )
    expect(
      setupDetail({ key: "reviewers", done: false, main: true, backup: true })
    ).toBe("A named reviewer no longer reviews here.")
    expect(
      setupDetail({
        key: "spaces",
        done: false,
        checks: 12,
        unanswered: 3,
        places: 2,
      })
    ).toBe("3 of 12 facility questions still to answer.")
    expect(setupDetail({ key: "staff", done: true, members: 1 })).toBe(
      "1 person has access."
    )
    expect(setupHref({ key: "inventory", done: false }, V1)).toBe(
      `/admin/menus/${V1}`
    )
    expect(setupHref({ key: "staff", done: false }, V1)).toBe(
      `/admin/coverage/${V1}/team`
    )
  })

  it("maps operating status onto its chip", () => {
    expect(operatingStatusChip("open")).toBe("venue_open")
    expect(operatingStatusChip("temporarily_closed")).toBe(
      "venue_temporarily_closed"
    )
    expect(operatingStatusChip("permanently_closed")).toBe("venue_archived")
  })

  it("reads a switched-off venue as archived, so Open can be chosen (V22)", () => {
    const [v] = parseVenueList({
      items: [{ ...venue, active: false, operatingStatus: "open" }],
    })!
    expect(v.operatingStatus).toBe("permanently_closed")
    expect(operatingStatusChip(v.operatingStatus)).toBe("venue_archived")
    expect(effectiveOperatingStatus("temporarily_closed", true)).toBe(
      "temporarily_closed"
    )
    expect(effectiveOperatingStatus("nonsense", true)).toBe("open")
  })

  it("validates the venue form before sending", () => {
    const form = {
      name: "  ",
      locality: "x".repeat(121),
      address: "",
      timezone: "London",
      reason: "",
    }
    expect(validateVenueForm(form)).toEqual({
      name: "Give the venue a name.",
      locality: "At most 120 characters.",
      timezone: "Choose a timezone from the list.",
    })
    for (const timezone of ["posix/Europe/London", "right/UTC"])
      expect(
        validateVenueForm({ ...form, name: "The Bell", locality: "", timezone })
      ).toEqual({ timezone: "Choose a timezone from the list." })
    expect(
      validateVenueForm({
        ...form,
        name: "The Bell",
        locality: "",
        timezone: "Europe/London",
      })
    ).toBeNull()
  })
})
