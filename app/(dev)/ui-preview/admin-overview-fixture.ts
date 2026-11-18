// DEV FIXTURE: S2-ADMIN Overview rows (spec §8 A1) for /ui-preview: a venue
// needing attention (setup, a publication error, a long wait), a closed one,
// a full one, and an empty one.
import { parseOverview, parseOverviewFilters } from "@/lib/admin/overview"

const done = (keys: string[]) => ({
  items: ["inventory", "reviewers", "staff", "spaces", "collection"].map(
    (key) => ({ key, done: !keys.includes(key) })
  ),
})

const base = {
  operatingStatus: "open",
  active: true,
  facts: { confirmed: 0, total: 0, checkDue: 0, unconfirmed: 0 },
  unlabelled: 0,
  review: { waiting: 0, oldestAt: null },
  checksDue: {
    dishes: 0,
    places: 0,
    facilities: 0,
    slots: 0,
    facts: 0,
    total: 0,
  },
  publication: { failed: 0, withdrawalPending: 0, total: 0 },
  added: 0,
  setup: done([]),
}

export const FAKE_OVERVIEW_NOW = new Date("2026-11-18T12:00:00Z")
export const FAKE_OVERVIEW_FILTERS = parseOverviewFilters({}, "2026-11")

export const FAKE_OVERVIEW_ROWS = parseOverview({
  rows: [
    {
      ...base,
      venueId: "00000000-0000-4000-8000-00000000f001",
      name: "The Bell",
      categories: [
        { category: "food", total: 42, covered: 18, pending: 5, checkDue: 1 },
        { category: "drinks", total: 30, covered: 30 },
        { category: "spaces", total: 6, covered: 4 },
        { category: "facilities", total: 14, covered: 3, pending: 2 },
      ],
      facts: { confirmed: 20, total: 26, checkDue: 2, unconfirmed: 4 },
      unlabelled: 7,
      review: { waiting: 7, oldestAt: "2026-11-06T09:00:00Z" },
      checksDue: {
        dishes: 1,
        places: 0,
        facilities: 0,
        slots: 1,
        facts: 2,
        total: 3,
      },
      publication: { failed: 1, withdrawalPending: 1, total: 2 },
      added: 64,
      setup: done(["reviewers"]),
    },
    {
      ...base,
      venueId: "00000000-0000-4000-8000-00000000f002",
      name: "The Crown",
      operatingStatus: "temporarily_closed",
      categories: [
        { category: "food", total: 20, covered: 20 },
        { category: "drinks", total: 18, covered: 9 },
        { category: "spaces", total: 4, covered: 4 },
        { category: "facilities", total: 10, covered: 10 },
      ],
      facts: { confirmed: 22, total: 22 },
      added: 3,
    },
    {
      ...base,
      venueId: "00000000-0000-4000-8000-00000000f003",
      name: "The White Horse",
      categories: [
        { category: "food", total: 0, covered: 0 },
        { category: "drinks", total: 0, covered: 0 },
        { category: "spaces", total: 0, covered: 0 },
        { category: "facilities", total: 0, covered: 0 },
      ],
      setup: done(["inventory", "reviewers", "spaces", "collection"]),
    },
  ],
})!
