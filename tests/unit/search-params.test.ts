import { describe, expect, it } from "vitest"

import {
  countSearchFilters,
  decodeSubmission,
  EMPTY_SEARCH_FILTERS,
  filtersToSearch,
  searchToFilters,
  toServiceFilters,
} from "@/app/_media/search-params"
import { SEARCH_FILTER_KEYS } from "@/lib/server/media/search/types"

const UUID = "0b5a0f86-1b8e-4d5a-9f53-7d2b7c3c9e11"
const OTHER = "7c1f2a33-5e3b-4b6e-8d62-2f1b9f4c7a20"

describe("asset search URL codec (B05-06)", () => {
  it("reads exactly the service's filter keys", () => {
    expect(Object.keys(EMPTY_SEARCH_FILTERS)).toEqual([...SEARCH_FILTER_KEYS])
    const filters = searchToFilters(
      new URLSearchParams(`item=${UUID}&rights=&nope=1&cursor=abc`)
    )
    expect(filters.item).toBe(UUID)
    expect(filters.rights).toBeNull()
    expect(filters).not.toHaveProperty("nope")
    expect(filters).not.toHaveProperty("cursor")
  })

  it("reads a page's searchParams object, first value only", () => {
    expect(
      searchToFilters({ mediaType: ["video", "image"], item: undefined })
    ).toMatchObject({ mediaType: "video", item: null })
  })

  it("round-trips in one canonical order", () => {
    const qs = `uploadedTo=2026-11-03&item=${UUID}&mediaType=image&venue=${OTHER}`
    const filters = searchToFilters(new URLSearchParams(qs))
    const canonical = filtersToSearch(filters)
    expect(canonical).toBe(
      `venue=${OTHER}&mediaType=image&item=${UUID}&uploadedTo=2026-11-03`
    )
    expect(
      filtersToSearch(searchToFilters(new URLSearchParams(canonical)))
    ).toBe(canonical)
  })

  it("drops a place of use unless the use is in force", () => {
    expect(
      filtersToSearch({ rights: "expired", destination: "test_dest" })
    ).toBe("rights=expired")
    expect(
      filtersToSearch({ rights: "in_force", destination: "test_dest" })
    ).toBe("rights=in_force&destination=test_dest")
  })

  it("drops an answer use without an answer freshness", () => {
    expect(filtersToSearch({ answerUse: "public" })).toBe("")
    expect(
      filtersToSearch({ answerFreshness: "expired", answerUse: "public" })
    ).toBe("answerFreshness=expired&answerUse=public")
  })

  it("never sends a venue for a manager", () => {
    expect(filtersToSearch({ venue: OTHER, item: UUID }, "manager")).toBe(
      `item=${UUID}`
    )
    expect(countSearchFilters({ venue: OTHER, item: UUID }, "manager")).toBe(1)
    expect(countSearchFilters({ venue: OTHER, item: UUID }, "admin")).toBe(2)
  })

  it("decodes a submission at the first colon, else passes it through", () => {
    expect(decodeSubmission(`amenity:${UUID}`)).toEqual({
      source: "amenity",
      id: UUID,
    })
    expect(decodeSubmission("a:b:c")).toEqual({ source: "a", id: "b:c" })
    expect(decodeSubmission("nonsense")).toBe("nonsense")
    expect(decodeSubmission(":x")).toBe(":x")
    expect(decodeSubmission("x:")).toBe("x:")
    expect(
      toServiceFilters({ submission: `coverage:${UUID}`, rights: null })
    ).toEqual({ submission: { source: "coverage", id: UUID } })
  })
})
