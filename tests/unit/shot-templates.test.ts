// FA-52 shot templates (lib/album/brief.ts): the payload parsers for
// public.slot_briefs, public.shot_templates and the example list, and how
// Album takes each slot's resolved brief and example (buildAlbum), falling
// back to the older per-source rule only for a slot the resolver omits.
import { describe, expect, it } from "vitest"

import {
  isShotTemplateText,
  parseExampleChoices,
  parseShotTemplates,
  parseSlotBriefs,
  SHOT_TEMPLATE_MAX,
} from "@/lib/album/brief"
import { buildAlbum, findSlot, type AlbumInput } from "@/lib/album/model"

const BAR = "00000000-0000-4000-8000-00000000b001"
const DRINKS = "00000000-0000-4000-8000-00000000c001"
const D1 = "00000000-0000-4000-8000-0000000d0001"
const D2 = "00000000-0000-4000-8000-0000000d0002"
const EX = "00000000-0000-4000-8000-0000000000e1"

describe("parseSlotBriefs", () => {
  it("keys each resolved brief by Album's slot id", () => {
    const briefs = parseSlotBriefs({
      venueId: "v",
      items: [
        {
          kind: "dish",
          slotId: D1,
          category: "drinks",
          brief: "Pint on the bar",
          source: "manager",
          exampleAssetId: null,
        },
        {
          kind: "area",
          slotId: BAR,
          category: "spaces",
          brief: "The space as guests see it",
          source: "template",
          exampleAssetId: EX,
        },
      ],
    })!
    expect(briefs.get(`dish:${D1}`)).toEqual({
      text: "Pint on the bar",
      source: "manager",
      exampleAssetId: null,
    })
    expect(briefs.get(`area:${BAR}`)?.exampleAssetId).toBe(EX)
  })

  it("drops rows without a brief, a known kind or a known source", () => {
    const briefs = parseSlotBriefs({
      items: [
        { kind: "dish", slotId: D1, brief: null, source: "template" },
        { kind: "menu", slotId: D1, brief: "x", source: "template" },
        { kind: "dish", slotId: D2, brief: "x", source: "guess" },
        null,
      ],
    })!
    expect(briefs.size).toBe(0)
  })

  it("is null for a payload that is not one", () => {
    expect(parseSlotBriefs(null)).toBeNull()
    expect(parseSlotBriefs({ items: "no" })).toBeNull()
  })
})

describe("parseShotTemplates", () => {
  it("returns the categories in the spec's order with admin extras when sent", () => {
    const templates = parseShotTemplates([
      { category: "other", instruction: "O", revision: 1 },
      {
        category: "food",
        instruction: "F",
        exampleAssetId: EX,
        revision: 3,
        storedExampleAssetId: EX,
        exampleUnavailable: false,
        updatedAt: "2026-11-18T10:00:00Z",
        updatedBy: "Ana",
      },
      { category: "nope", instruction: "N", revision: 1 },
      { category: "drinks", instruction: "", revision: 1 },
    ])!
    expect(templates.map((t) => t.category)).toEqual(["food", "other"])
    expect(templates[0]).toMatchObject({
      revision: 3,
      exampleAssetId: EX,
      storedExampleAssetId: EX,
      updatedBy: "Ana",
    })
    expect("storedExampleAssetId" in templates[1]!).toBe(false)
  })

  it("is null when the read is not a list", () => {
    expect(parseShotTemplates({})).toBeNull()
  })
})

describe("parseExampleChoices", () => {
  it("reads the page and its cursor", () => {
    const page = parseExampleChoices({
      items: [
        {
          assetId: EX,
          venueId: "v1",
          venueName: "The Bell",
          uploadedAt: "2026-11-01T09:00:00Z",
        },
        { assetId: null },
      ],
      nextCursor: { at: "2026-11-01T09:00:00Z", id: EX },
    })!
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toEqual({ at: "2026-11-01T09:00:00Z", id: EX })
    expect(
      parseExampleChoices({ items: [], nextCursor: null })!.nextCursor
    ).toBeNull()
  })
})

describe("the template text limit", () => {
  it("is the album brief's one line", () => {
    expect(SHOT_TEMPLATE_MAX).toBe(140)
    expect(isShotTemplateText("a".repeat(140))).toBe(true)
    expect(isShotTemplateText("a".repeat(141))).toBe(false)
    expect(isShotTemplateText("two\nlines")).toBe(false)
  })
})

describe("buildAlbum with resolved briefs", () => {
  const dish = (itemId: string, name: string) => ({
    itemId,
    name,
    sectionId: DRINKS,
    sectionName: "Drinks",
    covered: false,
    needsRecheck: false,
    thumbnailUrl: null,
    myWaiting: 0,
    reviewState: null,
    neededBy: null,
    coverage: "missing" as const,
    coverageCategory: "drinks" as const,
  })
  const base: AlbumInput = {
    places: [{ subjectId: BAR, label: "The bar" }],
    placements: [{ source: "menu_section", key: "drinks", subjectId: BAR }],
    sections: [{ sectionId: DRINKS, slug: "drinks" }],
    dishes: [dish(D1, "Guinness"), dish(D2, "Aperol")],
    amenities: [],
    areas: [
      {
        subjectId: BAR,
        label: "The bar",
        state: "needed",
        coverage: "missing",
        coverageCategory: "spaces",
      },
    ],
    myRetakeItemIds: new Set(),
    briefs: {
      sections: new Map([["drinks", "Section brief"]]),
      items: new Map(),
      amenities: new Map(),
    },
  }

  it("takes the resolver's brief and example, never the older rule's", () => {
    const album = buildAlbum({
      ...base,
      slotBriefs: new Map([
        [
          `dish:${D1}`,
          { text: "Asked: a pint", source: "request", exampleAssetId: EX },
        ],
        [
          `area:${BAR}`,
          { text: "Template words", source: "template", exampleAssetId: null },
        ],
      ]),
    })
    expect(findSlot(album, `dish:${D1}`)!.slot).toMatchObject({
      brief: "Asked: a pint",
      exampleAssetId: EX,
    })
    // Areas had no brief before FA-52; the template gives them one.
    expect(findSlot(album, `area:${BAR}`)!.slot.brief).toBe("Template words")
    // A slot the resolver did not list keeps the older rule.
    expect(findSlot(album, `dish:${D2}`)!.slot).toMatchObject({
      brief: "Section brief",
      exampleAssetId: null,
    })
  })

  it("keeps the older rule when the resolver could not be read", () => {
    const album = buildAlbum(base)
    expect(findSlot(album, `dish:${D1}`)!.slot.brief).toBe("Section brief")
    expect(findSlot(album, `area:${BAR}`)!.slot.brief).toBeNull()
  })
})
