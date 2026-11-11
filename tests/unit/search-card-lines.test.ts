// B05-06 (R12): the card's use and subject lines, in words.
import { describe, expect, it } from "vitest"

// useLines is a plain function (not a hook); renamed so the hooks lint rule
// doesn't read it as one outside a component.
import {
  subjectLines,
  useLines as cardUseLines,
} from "@/components/nabalens/search/search-card"
import { SEARCH_COPY } from "@/components/nabalens/search/search-copy"
import type { AssetSearchItem } from "@/lib/server/media/search/types"

type Use = AssetSearchItem["use"]
type Destination = Use["destinations"][number]

function asset(
  use: Partial<Use> = {},
  subjects: Partial<AssetSearchItem["subjects"]> = {}
): AssetSearchItem {
  return {
    id: "a",
    mediaType: "image",
    thumbnailUrl: null,
    venueName: "Venue A",
    uploaderFirstName: null,
    uploadedAt: "2026-11-10T09:00:00.000Z",
    groupId: null,
    subjects: {
      menuItems: [],
      checks: [],
      tasks: [],
      group: null,
      ...subjects,
    },
    use: {
      state: "not_granted",
      inForce: 0,
      withdrawn: 0,
      destinations: [],
      ...use,
    },
    menuDecisions: [],
  }
}

const place = (
  state: Destination["state"],
  until: string | null = null
): Destination => ({ destinationKey: "web", label: "Website", state, until })

const words = (item: AssetSearchItem) => cardUseLines(item).map((l) => l.text)

describe("useLines", () => {
  it("names the place in use, with no end", () => {
    expect(
      words(
        asset({
          state: "granted",
          inForce: 1,
          destinations: [place("in_force")],
        })
      )
    ).toEqual(["In use on Website"])
  })

  it("names the place in use with its end day", () => {
    const lines = cardUseLines(
      asset({
        state: "granted",
        inForce: 1,
        destinations: [place("in_force", "2026-12-01T00:00:00.000Z")],
      })
    )
    expect(lines.map((l) => l.text)).toEqual([
      "In use on Website until 1 Dec 2026",
    ])
    expect(lines[0]!.tone).toBe("positive")
  })

  it("an ended use keeps the asset word first", () => {
    expect(
      words(
        asset({
          state: "not_granted",
          destinations: [place("expired", "2026-10-01T00:00:00.000Z")],
        })
      )
    ).toEqual(["No use agreed", "Use on Website ended 1 Oct 2026"])
  })

  it("a withdrawn use says so, closed", () => {
    const lines = cardUseLines(asset({ state: "withdrawn", withdrawn: 1 }))
    expect(lines.map((l) => l.text)).toEqual(["Use withdrawn"])
    expect(lines[0]!.tone).toBe("closed")
  })

  it("an upload from before use records says so", () => {
    expect(words(asset({ state: "legacy_unknown" }))).toEqual([
      "Uploaded before use records",
    ])
  })

  it("no use agreed is neutral", () => {
    const lines = cardUseLines(asset())
    expect(lines.map((l) => l.text)).toEqual(["No use agreed"])
    expect(lines[0]!.tone).toBe("neutral")
  })

  it("granted with no in-force place still says In use", () => {
    expect(words(asset({ state: "granted", inForce: 1 }))).toEqual(["In use"])
  })
})

describe("subjectLines", () => {
  it("lists items, checks, tasks and a set in words", () => {
    expect(
      subjectLines(
        asset(
          {},
          {
            menuItems: [
              {
                itemId: "i",
                variantId: null,
                itemName: "Soup",
                variantName: null,
              },
              {
                itemId: "j",
                variantId: "v",
                itemName: "Pie",
                variantName: "Large",
              },
            ],
            checks: [
              { checkId: "c", questionKey: "q", source: "amenity" },
              { checkId: "d", questionKey: "r", source: "knowledge" },
            ],
            tasks: [{ requirementId: null, submissionId: "s" }],
            group: { kind: "task", id: "g" },
          }
        )
      )
    ).toEqual([
      "For Soup",
      "For Pie · Large",
      SEARCH_COPY.amenityCheck,
      SEARCH_COPY.venueQuestion,
      SEARCH_COPY.checklistPhoto,
      SEARCH_COPY.inSet,
    ])
  })

  it("is empty for an asset with no subjects", () => {
    expect(subjectLines(asset())).toEqual([])
  })
})
