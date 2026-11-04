import { describe, expect, it } from "vitest"

import {
  activeFilterCount,
  communityFilters,
  filterSummary,
  nothingMatches,
  TEAM_OPTIONS,
  type PhotoFilters,
} from "@/app/staff/community/search"

const VENUE = "0b9c4d6e-1f2a-4b3c-8d9e-0f1a2b3c4d5e"
const none: PhotoFilters = { venueId: null, mediaType: null, department: null }

describe("Photos filters", () => {
  it("counts each filter that is on", () => {
    expect(activeFilterCount(none)).toBe(0)
    expect(
      activeFilterCount({
        venueId: VENUE,
        mediaType: "image",
        department: "boh",
      })
    ).toBe(3)
    expect(activeFilterCount(communityFilters({ type: "video" }))).toBe(1)
  })

  it("reads only the params the sheet submits", () => {
    expect(
      communityFilters({ venue: VENUE, type: "image", department: "foh" })
    ).toEqual({ venueId: VENUE, mediaType: "image", department: "foh" })
    expect(communityFilters({ venue: "", type: "", department: "" })).toEqual(
      none
    )
  })

  it("names the teams without the directory's abbreviations", () => {
    expect(TEAM_OPTIONS).toEqual([
      { id: "foh", name: "Front of house" },
      { id: "boh", name: "Back of house" },
    ])
  })

  it("summarises only a filtered view", () => {
    expect(filterSummary(none, null)).toBeNull()
    expect(
      filterSummary(
        { venueId: VENUE, mediaType: "image", department: "boh" },
        "The Railway"
      )
    ).toBe("Showing photos from Back of house at The Railway, newest first.")
    expect(filterSummary({ ...none, venueId: VENUE }, "The Bell")).toBe(
      "Showing photos and videos from all teams at The Bell, newest first."
    )
    expect(filterSummary({ ...none, department: "foh" }, null)).toBe(
      "Showing photos and videos from Front of house at all venues, newest first."
    )
  })

  it("suggests only the filters that can be widened", () => {
    expect(
      nothingMatches(
        { venueId: VENUE, mediaType: "video", department: "boh" },
        "The Bell"
      )
    ).toBe(
      "Showing videos from Back of house at The Bell. Try all teams, or all venues."
    )
    expect(nothingMatches({ ...none, venueId: VENUE }, "The Bell")).toBe(
      "Showing photos and videos from all teams at The Bell. Try all venues."
    )
    expect(nothingMatches({ ...none, department: "boh" }, null)).toBe(
      "Showing photos and videos from Back of house at all venues. Try all teams."
    )
    expect(nothingMatches({ ...none, mediaType: "video" }, null)).toBe(
      "Showing videos from all teams at all venues. Try photos and videos."
    )
  })
})
