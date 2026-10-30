import { describe, expect, it, vi } from "vitest"

import { CONTENT_TYPES } from "@/lib/menus/types"
import {
  hasLabelPredicates,
  LIBRARY_PARAMS,
  londonDayRange,
  NO_LABEL_FILTERS,
  parseLibraryFilters,
} from "@/lib/server/media/library"

// library.ts loads label summaries from a server-only module.
vi.mock("server-only", () => ({}))

const ITEM = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01"
const VARIANT = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a02"

const NONE = {
  venueId: null,
  staffId: null,
  type: null,
  ...NO_LABEL_FILTERS,
}

describe("parseLibraryFilters", () => {
  it("returns every filter off for empty input", () => {
    expect(parseLibraryFilters({})).toEqual(NONE)
    expect(
      parseLibraryFilters(
        Object.fromEntries(LIBRARY_PARAMS.map((k) => [k, null]))
      )
    ).toEqual(NONE)
  })

  it("accepts each valid label param", () => {
    expect(
      parseLibraryFilters({
        item: ITEM,
        variant: VARIANT.toUpperCase(),
        category: "starters-and-sides-2",
        content: "plating",
        labels: "unlabelled",
        q: "lamb",
        from: "2026-10-01",
        to: "2026-10-31",
      })
    ).toEqual({
      ...NONE,
      itemId: ITEM,
      variantId: VARIANT.toUpperCase(),
      category: "starters-and-sides-2",
      contentType: "plating",
      labelState: "unlabelled",
      query: "lamb",
      from: "2026-10-01",
      to: "2026-10-31",
    })
    for (const code of CONTENT_TYPES) {
      expect(parseLibraryFilters({ content: code }).contentType).toBe(code)
    }
    expect(parseLibraryFilters({ labels: "labelled" }).labelState).toBe(
      "labelled"
    )
  })

  it("ignores invalid values instead of passing them to the query", () => {
    const bad = parseLibraryFilters({
      item: `${ITEM}),or(id.gt.0`,
      variant: "1",
      category: "Curries",
      content: "Dish",
      labels: "needs",
      q: "   ",
      from: "2026-02-30",
      to: "2026-13-01",
    })
    expect(bad).toEqual(NONE)
    for (const category of [
      "curries,or(x)",
      "-curries",
      "curries-",
      "a--b",
      "naïve",
      "a".repeat(81),
      "",
    ]) {
      expect(parseLibraryFilters({ category }).category).toBeNull()
    }
    expect(parseLibraryFilters({ category: "a".repeat(80) }).category).toBe(
      "a".repeat(80)
    )
    for (const day of [
      "2026-1-01",
      "20261001",
      "2026-10-01T00:00",
      " 2026-10-01",
      "1969-12-31",
      "2025-02-29",
      "2026-00-10",
    ]) {
      expect(parseLibraryFilters({ from: day }).from).toBeNull()
    }
    expect(parseLibraryFilters({ from: "2028-02-29" }).from).toBe("2028-02-29")
  })

  it("never throws on odd shapes and uses the first of repeated params", () => {
    const odd = [
      42,
      true,
      { toString: () => ITEM },
      [],
      [[ITEM]],
      Symbol("x"),
      undefined,
    ]
    for (const value of odd) {
      expect(() =>
        parseLibraryFilters(
          Object.fromEntries(LIBRARY_PARAMS.map((k) => [k, value]))
        )
      ).not.toThrow()
    }
    expect(
      parseLibraryFilters({
        item: [ITEM, "x"],
        q: ["first", "second"],
        labels: ["labelled", "unlabelled"],
      })
    ).toMatchObject({ itemId: ITEM, query: "first", labelState: "labelled" })
  })

  it("tidies the search text and limits it to 80 characters", () => {
    expect(parseLibraryFilters({ q: "  lamb \n\t bhuna  " }).query).toBe(
      "lamb bhuna"
    )
    expect(parseLibraryFilters({ q: "x".repeat(80) }).query).toBe(
      "x".repeat(80)
    )
    expect(parseLibraryFilters({ q: "x".repeat(81) }).query).toBeNull()
    // Counted in characters, not UTF-16 units.
    expect(parseLibraryFilters({ q: "🍛".repeat(80) }).query).toBe(
      "🍛".repeat(80)
    )
    // Wildcards are plain text here; library_assets escapes them.
    expect(parseLibraryFilters({ q: "50%_off\\" }).query).toBe("50%_off\\")
  })

  it("swaps a reversed date range", () => {
    expect(
      parseLibraryFilters({ from: "2026-10-31", to: "2026-10-01" })
    ).toMatchObject({ from: "2026-10-01", to: "2026-10-31" })
    expect(
      parseLibraryFilters({ from: "2026-10-31", to: "bad" })
    ).toMatchObject({ from: "2026-10-31", to: null })
  })
})

describe("londonDayRange", () => {
  it("covers the 25-hour day when BST ends (2026-10-25)", () => {
    expect(londonDayRange("2026-10-25", "2026-10-25")).toEqual({
      start: "2026-10-24T23:00:00.000Z",
      end: "2026-10-26T00:00:00.000Z",
    })
    // Spanning the change: BST midnight to GMT midnight.
    expect(londonDayRange("2026-10-24", "2026-10-26")).toEqual({
      start: "2026-10-23T23:00:00.000Z",
      end: "2026-10-27T00:00:00.000Z",
    })
  })

  it("covers the 23-hour day when BST starts (2026-03-29)", () => {
    expect(londonDayRange("2026-03-29", "2026-03-29")).toEqual({
      start: "2026-03-29T00:00:00.000Z",
      end: "2026-03-29T23:00:00.000Z",
    })
  })

  it("uses GMT in winter, BST in summer, and rolls over months and years", () => {
    expect(londonDayRange("2026-01-15", "2026-12-31")).toEqual({
      start: "2026-01-15T00:00:00.000Z",
      end: "2027-01-01T00:00:00.000Z",
    })
    expect(londonDayRange("2026-07-01", "2026-07-31")).toEqual({
      start: "2026-06-30T23:00:00.000Z",
      end: "2026-07-31T23:00:00.000Z",
    })
    expect(londonDayRange("2028-02-28", "2028-02-28").end).toBe(
      "2028-02-29T00:00:00.000Z"
    )
  })

  it("leaves an open end open and ignores invalid days", () => {
    expect(londonDayRange("2026-10-25", null)).toEqual({
      start: "2026-10-24T23:00:00.000Z",
      end: null,
    })
    expect(londonDayRange(null, "2026-10-24")).toEqual({
      start: null,
      end: "2026-10-24T23:00:00.000Z",
    })
    expect(londonDayRange("2026-02-30", "nope")).toEqual({
      start: null,
      end: null,
    })
  })
})

describe("hasLabelPredicates", () => {
  it("is true only for filters that need library_assets", () => {
    expect(hasLabelPredicates(NO_LABEL_FILTERS)).toBe(false)
    expect(hasLabelPredicates({})).toBe(false)
    // Dates are plain created_at filters on either query.
    expect(
      hasLabelPredicates({
        ...NO_LABEL_FILTERS,
        from: "2026-10-01",
        to: "2026-10-02",
      })
    ).toBe(false)
    for (const patch of [
      { itemId: ITEM },
      { variantId: VARIANT },
      { category: "curries" },
      { contentType: "dish" as const },
      { labelState: "unlabelled" as const },
      { query: "lamb" },
    ]) {
      expect(hasLabelPredicates({ ...NO_LABEL_FILTERS, ...patch })).toBe(true)
    }
  })
})
